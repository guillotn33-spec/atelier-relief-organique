// Sonde de calibration — sert à régler les préréglages, pas à valider.
// Affiche pour chaque préréglage les mesures qui décrivent l'allure du relief,
// plus un aperçu ASCII grossier (clair = plateau, sombre = creux).
//
//   node tests/calibrate.mjs [nom-du-preset]

import { buildHeightmap } from '../src/geometry/heightmap.js';
import { createProject, PRESETS, defaultGeometry } from '../src/core/project.js';

function analyse(hm) {
  const { cols, rows, h } = hm;
  const sorted = Float64Array.from(h).sort();
  const plateau = sorted[Math.floor(sorted.length * 0.85)];
  const deepest = sorted[0];
  const span = plateau - deepest;
  const cavityLevel = plateau - 0.3 * span;
  const flatEps = span * 0.002;
  const islandEps = span * 1e-6;

  let inCavity = 0;
  let flat = 0;
  let islands = 0;
  let carved = 0;
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      const i = r * cols + c;
      const value = h[i];
      if (value < plateau - 0.12 * span) carved++;
      if (value >= cavityLevel) continue;
      inCavity++;
      let maxDelta = 0;
      let isMax = true;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const other = h[(r + dr) * cols + (c + dc)];
          maxDelta = Math.max(maxDelta, Math.abs(other - value));
          if (other >= value - islandEps) isMax = false;
        }
      }
      if (maxDelta < flatEps) flat++;
      if (isMax) islands++;
    }
  }

  const total = (rows - 4) * (cols - 4);
  return {
    amplitude: hm.max - hm.min,
    span,
    carvedPct: (carved / total) * 100,
    cavityPct: (inCavity / total) * 100,
    flatPct: inCavity ? (flat / inCavity) * 100 : 0,
    islands,
  };
}

const RAMP = '@%#*+=-:. ';
function preview(hm, width = 76) {
  const height = Math.max(1, Math.round((width * hm.rows) / hm.cols / 2.1));
  const lines = [];
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) {
      const c = Math.min(hm.cols - 1, Math.round((x / (width - 1)) * (hm.cols - 1)));
      const r = Math.min(hm.rows - 1, Math.round((y / (height - 1)) * (hm.rows - 1)));
      const t = (hm.h[r * hm.cols + c] - hm.min) / (hm.max - hm.min || 1);
      line += RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
    }
    lines.push('   ' + line);
  }
  return lines.join('\n');
}

const only = process.argv[2];
for (const [key, preset] of Object.entries(PRESETS)) {
  if (only && key !== only) continue;
  const project = createProject({ canvasShape: 'rectangle', widthCm: 160, heightCm: 100, depthCm: 6 });
  Object.assign(project.geometry, defaultGeometry(), preset.geometry);
  const hm = buildHeightmap(project, null);
  const a = analyse(hm);
  console.log(`\n─── ${preset.name} ─────────────────────────────────────────────`);
  console.log(`   amplitude ${a.amplitude.toFixed(3)}   surface creusée ${a.carvedPct.toFixed(1)} %   en cavité ${a.cavityPct.toFixed(1)} %`);
  console.log(`   fond plat ${a.flatPct.toFixed(2)} % des cellules en cavité   îlots ${a.islands}`);
  console.log(preview(hm));
}

// Étalonnage : le moteur v1 sur les mêmes mesures.
const legacy = createProject({ canvasShape: 'rectangle', widthCm: 160, heightCm: 100, depthCm: 6 });
Object.assign(legacy.geometry, {
  engine: 'legacy-v1', seed: 2749, count: 9, scale: 1.4, elongation: 0.65,
  flow: 0.7, irregularity: 0.35, depth: 0.92, softness: 0.62, wave: 0.6,
});
const hmLegacy = buildHeightmap(legacy, null);
const al = analyse(hmLegacy);
console.log(`\n─── moteur v1 (Dunes d'origine) ───────────────────────────────`);
console.log(`   amplitude ${al.amplitude.toFixed(3)}   surface creusée ${al.carvedPct.toFixed(1)} %   en cavité ${al.cavityPct.toFixed(1)} %`);
console.log(`   fond plat ${al.flatPct.toFixed(2)} % des cellules en cavité   îlots ${al.islands}`);
console.log(preview(hmLegacy));
console.log('');
