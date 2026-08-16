// Animation — option (b) : mesure du gain et de l'approximation (lot 4).
//
//   node tests/animation.mjs
//
// Deux questions, deux mesures, aucune supposition :
//   1. l'approximation « houle × flou(A) » est-elle acceptable, ou le flou par
//      image est-il indispensable ?
//   2. le coût par image tient-il l'objectif de 25 im/s à qualité 0,45 ?

import { buildHeightmap } from '../src/geometry/heightmap.js';
import { SwellAnimator } from '../src/geometry/animator.js';
import { createProject, PRESETS, defaultGeometry } from '../src/core/project.js';

const WIDTH_CM = 200;
const HEIGHT_CM = 120;

function makeProject() {
  const project = createProject({ canvasShape: 'rectangle', widthCm: WIDTH_CM, heightCm: HEIGHT_CM, depthCm: 6 });
  Object.assign(project.geometry, defaultGeometry(), PRESETS.dunes.geometry);
  return project;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timeIt(fn, reps = 9) {
  const samples = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn(i);
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

const project = makeProject();
const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

console.log('\nA. Fidélité — l’animation doit repartir du même relief que le rendu fixe\n');

// À phase nulle, l'animateur doit reproduire la heightmap construite normalement.
for (const quality of [0.45, 0.3]) {
  const reference = buildHeightmap(project, null, { quality });
  const animator = new SwellAnimator(project, null, quality);
  const exact = animator.frame(0, { approximate: false });
  let maxDiff = 0;
  for (let i = 0; i < reference.h.length; i++) maxDiff = Math.max(maxDiff, Math.abs(reference.h[i] - exact.h[i]));
  const amplitude = reference.max - reference.min;
  const pct = (maxDiff / amplitude) * 100;
  console.log(`   qualité ${quality} : écart maximal ${maxDiff.toExponential(2)} soit ${pct.toFixed(4)} % de l’amplitude`);
  check(`A — l’animateur exact reproduit le rendu fixe à qualité ${quality}`, pct < 0.01, `${pct.toFixed(4)} %`);
}

console.log('\nB. Approximation « houle × flou(A) » contre flou par image\n');

const animator = new SwellAnimator(project, null, 0.45);
let worstPct = 0;
let worstMean = 0;
for (const phase of [0, 0.7, 1.9, 3.4]) {
  const exact = Float32Array.from(animator.frame(phase, { approximate: false }).h);
  const approx = animator.frame(phase, { approximate: true }).h;
  let maxDiff = 0;
  let sumDiff = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < exact.length; i++) {
    const d = Math.abs(exact[i] - approx[i]);
    if (d > maxDiff) maxDiff = d;
    sumDiff += d;
    if (exact[i] < min) min = exact[i];
    if (exact[i] > max) max = exact[i];
  }
  const amplitude = max - min;
  const pct = (maxDiff / amplitude) * 100;
  const meanPct = (sumDiff / exact.length / amplitude) * 100;
  worstPct = Math.max(worstPct, pct);
  worstMean = Math.max(worstMean, meanPct);
  console.log(`   phase ${phase} : écart max ${pct.toFixed(3)} %   écart moyen ${meanPct.toFixed(4)} %`);
}
check('B — l’approximation reste sous 1 % de l’amplitude', worstPct < 1, `${worstPct.toFixed(3)} % au pire`);

console.log('\nC. Coût par image\n');

for (const quality of [0.45, 0.3]) {
  const anim = new SwellAnimator(project, null, quality);
  const cells = anim.hm.cols * anim.hm.rows;
  const tExact = timeIt((i) => anim.frame(i * 0.3, { approximate: false }));
  const tApprox = timeIt((i) => anim.frame(i * 0.3, { approximate: true }));
  const tFull = timeIt((i) => buildHeightmap(project, null, { quality, carrierPhase: i * 0.3 }), 5);
  console.log(
    `   qualité ${quality}  (${anim.hm.cols}×${anim.hm.rows}, ${cells} cellules)\n` +
      `     reconstruction complète (lot 3) : ${tFull.toFixed(1)} ms\n` +
      `     option (b) exacte               : ${tExact.toFixed(1)} ms   ×${(tFull / tExact).toFixed(1)} plus rapide\n` +
      `     option (b) approchée            : ${tApprox.toFixed(1)} ms   ×${(tFull / tApprox).toFixed(1)} plus rapide`
  );
  if (quality === 0.45) {
    // L'ombrage et le rééchantillonnage coûtent 17,0 ms à cette qualité
    // (mesuré au banc du lot 3 : 4,1 + 12,9). Le budget par image les inclut.
    const RENDER_MS = 17.0;
    const fpsExact = 1000 / (tExact + RENDER_MS);
    const fpsApprox = 1000 / (tApprox + RENDER_MS);
    console.log(`     avec ombrage (${RENDER_MS} ms) : exacte ${fpsExact.toFixed(1)} im/s, approchée ${fpsApprox.toFixed(1)} im/s`);
    check('C — objectif 25 im/s tenu à qualité 0,45 (variante exacte)', fpsExact >= 25, `${fpsExact.toFixed(1)} im/s`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
