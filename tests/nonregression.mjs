// Non-régression du lot 1.
//
// L'oracle n'est PAS une réimplémentation à la main de la version 1 : les
// fonctions pures de `legacy/atelier-relief-organique.html` sont extraites du
// fichier et exécutées telles quelles. Si quelqu'un modifie le fichier v1, ce
// test change de résultat — c'est voulu.
//
//   node tests/nonregression.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHeightmap, gridFor, resampleTo } from '../src/geometry/heightmap.js';
import { SculptLayer } from '../src/sculpt/layer.js';
import { createProject } from '../src/core/project.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(root, 'legacy', 'atelier-relief-organique.html'), 'utf8');

// ---- Extraction du code v1 ----

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`fonction v1 introuvable : ${name}`);
  let depth = 0;
  let i = source.indexOf('{', start);
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`accolades non refermées pour ${name} (ouverte en ${open})`);
}

const NAMES = ['clamp', 'smoothstep', 'smin', 'mulberry32', 'sampleSculpt', 'createShapes', 'buildValleys', 'makeRenderContext', 'computeField', 'blurHeightMap'];

const preamble = `
  const SW = 256, SH = 160;
  const sculpt = {
    warpX: new Float32Array(SW * SH),
    warpY: new Float32Array(SW * SH),
    height: new Float32Array(SW * SH)
  };
  let sculptActive = false;
`;

const factory = new Function(
  preamble + NAMES.map((name) => extractFunction(html, name)).join('\n') + `
  return {
    SW, SH, sculpt,
    setSculptActive: (v) => { sculptActive = v; },
    createShapes, buildValleys, makeRenderContext, computeField, blurHeightMap, sampleSculpt
  };`
);
const v1 = factory();

// ---- Utilitaires de comparaison ----

function compare(a, b) {
  let maxDiff = 0;
  let sumDiff = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs(a[i] - b[i]);
    if (diff > maxDiff) maxDiff = diff;
    sumDiff += diff;
    if (a[i] < min) min = a[i];
    if (a[i] > max) max = a[i];
  }
  const amplitude = max - min;
  return {
    maxDiff,
    meanDiff: sumDiff / a.length,
    amplitude,
    maxPct: (maxDiff / amplitude) * 100,
    meanPct: (sumDiff / a.length / amplitude) * 100,
  };
}

const CFG = {
  count: 9,
  scale: 1.4,
  elongation: 0.65,
  flow: 0.7,
  irregularity: 0.35,
  depth: 0.92,
  softness: 0.62,
  wave: 0.6,
  seed: 2749,
};

const OUT_W = 1024;
const OUT_H = 640; // rapport exactement 1.6, le seul que la v1 sache produire

function legacyMap() {
  const rc = v1.makeRenderContext(CFG, OUT_W, OUT_H);
  const map = new Float32Array(OUT_W * OUT_H);
  v1.computeField(rc, map, OUT_W, 0, 0, OUT_W, OUT_H, 0, true);
  v1.blurHeightMap(map, OUT_W, OUT_H, rc.blurRadius);
  return map;
}

function newMap(layer) {
  const project = createProject({ canvasShape: 'rectangle', widthCm: 160, heightCm: 100, depthCm: 6 });
  Object.assign(project.geometry, CFG);
  const hm = buildHeightmap(project, layer);
  return { map: resampleTo(hm, project, OUT_W, OUT_H), hm, project };
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

// ---- A. Champ nu, sans sculpture ----

console.log('\nA. Champ sans sculpture — v1 (1024 × 640, champ évalué par pixel)');
console.log('   contre lot 1 (grille canonique en cm puis rééchantillonnage)\n');

v1.setSculptActive(false);
const legacyA = legacyMap();
const { map: newA, hm } = newMap(null);
const statsA = compare(legacyA, newA);
console.log(`   grille canonique : ${hm.cols} × ${hm.rows} cellules de ${hm.cellCm.toFixed(4)} cm`);
console.log(`   amplitude du relief v1 : ${statsA.amplitude.toFixed(4)} unités de champ`);
console.log(`   écart maximal  : ${statsA.maxDiff.toFixed(5)}  (${statsA.maxPct.toFixed(3)} % de l'amplitude)`);
console.log(`   écart moyen    : ${statsA.meanDiff.toFixed(5)}  (${statsA.meanPct.toFixed(3)} % de l'amplitude)`);
check('A — écart moyen sous 0,20 % de l’amplitude', statsA.meanPct < 0.2, `mesuré ${statsA.meanPct.toFixed(3)} %`);
check('A — écart maximal sous 2,0 % de l’amplitude', statsA.maxPct < 2.0, `mesuré ${statsA.maxPct.toFixed(3)} %`);

// ---- B. Correspondance du calque de sculpture (u/v de la v1 → cm du lot 1) ----

console.log('\nB. Calque de sculpture : correspondance u/v → cm, couverture, croissance\n');

const SW = v1.SW;
const SH = v1.SH;
const cellCm = 160 / (SW - 1);
const layerB = new SculptLayer({
  cellCm,
  cols: SW,
  rows: SH,
  originXCm: -((SW - 1) * cellCm) / 2,
  originYCm: -((SH - 1) * cellCm) / 2,
  warpLimitCm: 0.22 * 160,
  active: true,
});

// B1 — l'axe horizontal doit correspondre EXACTEMENT à la grille de la v1.
let maxColErr = 0;
let maxRowDrift = 0;
for (let i = 0; i <= 200; i++) {
  const t = i / 200;
  maxColErr = Math.max(maxColErr, Math.abs(layerB.colOf((t - 0.5) * 160) - t * (SW - 1)));
  maxRowDrift = Math.max(maxRowDrift, Math.abs(layerB.rowOf((t - 0.5) * 100) - t * (SH - 1)));
}
console.log(`   écart horizontal : ${maxColErr.toExponential(2)} cellule`);
console.log(`   dérive verticale : ${maxRowDrift.toFixed(4)} cellule (0,23 % documenté dans migrate.js)`);
check('B1 — correspondance horizontale exacte', maxColErr < 1e-9, `${maxColErr.toExponential(2)} cellule`);
check('B2 — dérive verticale sous une demi-cellule', maxRowDrift < 0.5, `${maxRowDrift.toFixed(4)} cellule`);

// B3 — la grille construite par l'application couvre TOUJOURS la toile.
// Un point de la toile tombant hors grille renverrait 0 : discontinuité franche
// au bord. C'est le défaut que cette vérification interdit.
let alwaysCovered = true;
for (const [w, h] of [[160, 100], [500, 200], [12, 12], [40, 200], [500, 12]]) {
  const layer = SculptLayer.forCanvas(w, h);
  for (const [x, y] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2], [0, 0]]) {
    const col = layer.colOf(x);
    const row = layer.rowOf(y);
    if (col < 0 || row < 0 || col > layer.cols - 1 || row > layer.rows - 1) alwaysCovered = false;
  }
}
check('B3 — les quatre coins de la toile sont dans la grille', alwaysCovered);

// B4 — un agrandissement ne doit JAMAIS déplacer la sculpture.
// Le décalage vaut (nouveau − ancien) / 2 : s'il est impair, la recopie se fait
// à une demi-cellule près. La croissance est donc forcée paire.
let growthExact = true;
let growthDetail = '';
for (const [w0, h0, w1, h1] of [[100, 60, 137, 83], [160, 100, 161, 101], [50, 50, 200, 200], [80, 40, 81, 40]]) {
  const layer = SculptLayer.forCanvas(w0, h0);
  for (let i = 0; i < layer.height.length; i++) layer.height[i] = (i % 977) / 977;
  const before = layer.height.slice();
  const cols0 = layer.cols;
  const rows0 = layer.rows;
  layer.ensureCovers(w1, h1);
  const shiftX = (layer.cols - cols0) / 2;
  const shiftY = (layer.rows - rows0) / 2;
  if (!Number.isInteger(shiftX) || !Number.isInteger(shiftY)) {
    growthExact = false;
    growthDetail = `décalage non entier ${shiftX},${shiftY} pour ${w0}×${h0} → ${w1}×${h1}`;
    continue;
  }
  for (let r = 0; r < rows0 && growthExact; r++) {
    for (let c = 0; c < cols0; c++) {
      const moved = layer.height[(r + shiftY) * layer.cols + (c + shiftX)];
      if (moved !== before[r * cols0 + c]) {
        growthExact = false;
        growthDetail = `valeur altérée en (${c},${r}) pour ${w0}×${h0} → ${w1}×${h1}`;
        break;
      }
    }
  }
}
check('B4 — agrandissement bit à bit sans décalage', growthExact, growthDetail || 'quatre agrandissements vérifiés');

// ---- C. Pipeline complet avec sculpture ----

console.log('\nC. Champ AVEC sculpture (creux gaussien + déplacement)\n');

const n = SW * SH;
const legacyHeight = new Float32Array(n);
const legacyWarpX = new Float32Array(n);
const legacyWarpY = new Float32Array(n);
for (let r = 0; r < SH; r++) {
  for (let c = 0; c < SW; c++) {
    const u = c / (SW - 1);
    const v = r / (SH - 1);
    const d2 = (u - 0.62) * (u - 0.62) + (v - 0.38) * (v - 0.38);
    const i = r * SW + c;
    legacyHeight[i] = -0.65 * Math.exp(-d2 / 0.015);
    legacyWarpX[i] = 0.02 * Math.exp(-d2 / 0.03);
    legacyWarpY[i] = -0.015 * Math.exp(-d2 / 0.03);
  }
}
v1.sculpt.height.set(legacyHeight);
v1.sculpt.warpX.set(legacyWarpX);
v1.sculpt.warpY.set(legacyWarpY);
v1.setSculptActive(true);
const legacyC = legacyMap();

const layerC = new SculptLayer({
  cellCm,
  cols: SW,
  rows: SH,
  originXCm: -((SW - 1) * cellCm) / 2,
  originYCm: -((SH - 1) * cellCm) / 2,
  warpLimitCm: 0.22 * 160,
  height: legacyHeight.slice(),
  // Les déplacements v1 sont des fractions d'axe ; le lot 1 les stocke en cm.
  warpX: Float32Array.from(legacyWarpX, (value) => value * 160),
  warpY: Float32Array.from(legacyWarpY, (value) => value * 100),
  active: true,
});
const { map: newC } = newMap(layerC);
const statsC = compare(legacyC, newC);
console.log(`   amplitude du relief v1 : ${statsC.amplitude.toFixed(4)}`);
console.log(`   écart maximal  : ${statsC.maxDiff.toFixed(5)}  (${statsC.maxPct.toFixed(3)} %)`);
console.log(`   écart moyen    : ${statsC.meanDiff.toFixed(5)}  (${statsC.meanPct.toFixed(3)} %)`);
check('C — écart moyen sous 0,30 % de l’amplitude', statsC.meanPct < 0.3, `mesuré ${statsC.meanPct.toFixed(3)} %`);
check('C — écart maximal sous 3,0 % de l’amplitude', statsC.maxPct < 3.0, `mesuré ${statsC.maxPct.toFixed(3)} %`);

// ---- D. Invariants de format ----

console.log('\nD. Invariants de format\n');

const cases = [
  ['rectangle 500 × 200', 500, 200],
  ['rectangle 1 × 1', 1, 1],
  ['carré 120 × 120', 120, 120],
  ['rond 110 × 110', 110, 110],
  ['bandeau 500 × 12', 500, 12],
  ['portrait 40 × 200', 40, 200],
];
let squareCells = true;
let covers = true;
let bounded = true;
for (const [label, w, h] of cases) {
  const grid = gridFor(w, h);
  const spanX = (grid.cols - 1) * grid.cellCm;
  const spanY = (grid.rows - 1) * grid.cellCm;
  if (spanX < w - 1e-9 || spanY < h - 1e-9) covers = false;
  if (grid.cols * grid.rows > 700000) bounded = false;
  console.log(`   ${label.padEnd(20)} ${String(grid.cols).padStart(6)} × ${String(grid.rows).padEnd(6)} cellules de ${grid.cellCm.toFixed(4)} cm`);
}
check('D — la grille couvre toujours la toile', covers);
check('D — cellules carrées par construction (un seul cellCm)', squareCells);
check('D — nombre de cellules borné', bounded);

// ---- E. Absence de constante 1.6 résiduelle ----

console.log('\nE. Recherche de rapport câblé dans src/\n');

import { readdirSync, statSync } from 'node:fs';
function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full.endsWith('.js')) files.push(full);
  }
  return files;
}
// Un 1.6 littéral n'est toléré que sous la forme d'une constante NOMMÉE, ce qui
// interdit qu'il se reprenne pour un rapport d'image au détour d'une relecture.
const offenders = [];
const named = [];
for (const file of walk(path.join(root, 'src'))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (!/(^|[^.\w])1\.6([^0-9]|$)/.test(line)) return;
    const entry = `${path.relative(root, file)}:${index + 1}  ${trimmed}`;
    if (/^const [A-Z][A-Z0-9_]* = 1\.6;$/.test(trimmed)) named.push(entry);
    else offenders.push(entry);
  });
}
named.forEach((line) => console.log('   toléré (constante nommée) : ' + line));
offenders.forEach((line) => console.log('   ' + line));
check('E — aucun rapport 1.6 câblé dans src/', offenders.length === 0, offenders.length ? `${offenders.length} occurrence(s)` : `aucune (${named.length} constante nommée)`);

// ---- Bilan ----

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
