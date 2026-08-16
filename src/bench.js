// Banc de mesure de l'animation — outil de développement, servi uniquement par
// `npm run dev`. Il n'entre pas dans le bundle de production.
//
// Il reproduit EXACTEMENT ce que fait `Atelier.drawAnimFrame` : reconstruction
// de la heightmap avec une phase de houle décalée, rééchantillonnage vers la
// résolution de sortie, ombrage, puis report sur le canvas visible. Chaque étape
// est chronométrée séparément — c'est la décomposition qui décidera du sort de
// l'animation.
//
// Les mesures sont des boucles synchrones, pas des `requestAnimationFrame` :
// elles ne dépendent donc pas de la visibilité de l'onglet.

import { buildHeightmap, gridFor, resampleTo, sampleAo } from './geometry/heightmap.js';
import { shadeParams, shadeRegion } from './render2d/shade.js';
import { createProject, PRESETS, defaultGeometry } from './core/project.js';
import { SculptLayer } from './sculpt/layer.js';

const WIDTH_CM = 200;
const HEIGHT_CM = 120;
const OUT_W = 1020; // résolution de sortie réelle mesurée sur ce panneau
const OUT_H = 612;
const REPS = 7;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timeIt(fn) {
  const samples = [];
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now();
    fn(i);
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

function makeProject(presetKey) {
  const project = createProject({ canvasShape: 'rectangle', widthCm: WIDTH_CM, heightCm: HEIGHT_CM, depthCm: 6 });
  Object.assign(project.geometry, defaultGeometry(), PRESETS[presetKey].geometry);
  Object.assign(project.material, PRESETS[presetKey].material);
  Object.assign(project.lighting, PRESETS[presetKey].lighting);
  return project;
}

function run() {
  const lines = [];
  const project = makeProject('dunes');
  const layer = SculptLayer.forCanvas(WIDTH_CM, HEIGHT_CM);
  const offscreen = document.createElement('canvas');
  const visible = document.getElementById('view');
  const visibleCtx = visible.getContext('2d');

  lines.push(`panneau ${WIDTH_CM} × ${HEIGHT_CM} cm — sortie pleine résolution ${OUT_W} × ${OUT_H}`);
  lines.push(`visibilité de l'onglet : ${document.visibilityState}`);
  lines.push('');
  // La taille de grille figure à côté des temps : un coût par image sans le
  // nombre de cellules qui l'a produit n'est pas interprétable. La colonne
  // ns/cellule sert à vérifier que le coût est bien LINÉAIRE en cellules avant
  // d'extrapoler quoi que ce soit vers une autre machine ou un autre format.
  lines.push('qualité  grille       cellules  heightmap  ns/cell  rééch.   ombrage  report   TOTAL    im/s');

  const results = [];
  for (const quality of [1, 0.45, 0.3, 0.18]) {
    const grid = gridFor(WIDTH_CM, HEIGHT_CM, quality);
    const outW = Math.max(64, Math.round(OUT_W * quality));
    const outH = Math.max(1, Math.round(OUT_H * quality));

    let hm = null;
    const tBuild = timeIt((i) => {
      hm = buildHeightmap(project, layer, { quality, carrierPhase: i * 0.05 });
    });

    const map = new Float32Array(outW * outH);
    const tResample = timeIt(() => {
      resampleTo(hm, project, outW, outH, map);
    });

    offscreen.width = outW;
    offscreen.height = outH;
    const ctx = offscreen.getContext('2d', { alpha: true });
    const sp = shadeParams(project, outW, hm.max - hm.min);
    const image = ctx.createImageData(outW, outH);
    const aoBuf = new Float32Array(outW * outH);
    for (let py = 0; py < outH; py++) {
      const yCm = -HEIGHT_CM / 2 + (py / Math.max(1, outH - 1)) * HEIGHT_CM;
      for (let px = 0; px < outW; px++) {
        const xCm = -WIDTH_CM / 2 + (px / Math.max(1, outW - 1)) * WIDTH_CM;
        aoBuf[py * outW + px] = sampleAo(hm.ao, xCm, yCm);
      }
    }
    const tShade = timeIt(() => {
      shadeRegion(image.data, map, aoBuf, outW, outH, 0, 0, outW, outH, 0, 0, outW, outH, sp);
      ctx.putImageData(image, 0, 0);
    });

    visible.width = OUT_W;
    visible.height = OUT_H;
    const tBlit = timeIt(() => {
      visibleCtx.clearRect(0, 0, OUT_W, OUT_H);
      visibleCtx.imageSmoothingEnabled = true;
      visibleCtx.drawImage(offscreen, 0, 0, OUT_W, OUT_H);
    });

    const total = tBuild + tResample + tShade + tBlit;
    results.push({ quality, total, tBuild, tResample, tShade, tBlit, grid, outW, outH });
    const cells = grid.cols * grid.rows;
    const nsPerCell = (tBuild * 1e6) / cells;
    lines.push(
      `${String(quality).padEnd(8)} ${String(grid.cols + '×' + grid.rows).padEnd(12)} ` +
        `${String(cells).padStart(8)} ${tBuild.toFixed(1).padStart(7)}ms ${nsPerCell.toFixed(0).padStart(7)} ` +
        `${tResample.toFixed(1).padStart(6)}ms ${tShade.toFixed(1).padStart(6)}ms ` +
        `${tBlit.toFixed(1).padStart(5)}ms ${total.toFixed(1).padStart(7)}ms ${(1000 / total).toFixed(1).padStart(6)}`
    );
  }

  const worst = results[results.length - 1];
  lines.push('');
  lines.push(`à qualité minimale (${worst.quality}) : ${(1000 / worst.total).toFixed(1)} images/s`);
  const share = (worst.tBuild / worst.total) * 100;
  lines.push(`part de la reconstruction de heightmap : ${share.toFixed(0)} %`);
  lines.push(`part de l'ombrage + rééchantillonnage : ${(((worst.tShade + worst.tResample) / worst.total) * 100).toFixed(0)} %`);

  // Preuve de mouvement : deux images à des phases différentes doivent différer.
  const phases = [0, 1.4];
  const signatures = phases.map((phase) => {
    const map2 = buildHeightmap(project, layer, { quality: 0.45, carrierPhase: phase });
    let sum = 0;
    for (let i = 0; i < map2.h.length; i += 97) sum += map2.h[i];
    return sum;
  });
  lines.push('');
  lines.push(`signature du relief à phase 0 : ${signatures[0].toFixed(2)}`);
  lines.push(`signature du relief à phase 1,4 : ${signatures[1].toFixed(2)}`);
  lines.push(`le relief bouge réellement avec la phase : ${signatures[0] !== signatures[1]}`);

  const text = lines.join('\n');
  document.getElementById('out').textContent = text;
  window.__benchResult = text;
  return text;
}

window.__runBench = run;
run();
