// Export image (§17) — définition et rapport.
//
// Ce qui reste de l'ancienne suite `export.mjs` après le retrait du périmètre
// 3D : les vérifications d'export USDZ et OBJ sont parties avec le code
// qu'elles gardaient, celles-ci restent parce que l'export PNG en dépend.
//
//   node tests/image.mjs

import { createProject, PRESETS, defaultGeometry } from '../src/core/project.js';
import { outputSizeFor, MAX_PIXELS } from '../src/export/image.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

function makeProject(shape, widthCm, heightCm, depthCm = 6) {
  const project = createProject({ canvasShape: shape, widthCm, heightCm, depthCm, name: 'Panneau essai' });
  Object.assign(project.geometry, defaultGeometry(), PRESETS.dunes.geometry);
  return project;
}

// ---- A. Définition d'image (§17) ----

console.log('\nA. Définition d’image : le rapport vient du projet\n');
{
  const cases = [
    ['rectangle 200 × 120', makeProject('rectangle', 200, 120), 2048],
    ['portrait 90 × 180', makeProject('rectangle', 90, 180), 2048],
    ['carré 120', makeProject('square', 120, 120), 4096],
    ['rond 130', makeProject('circle', 130, 130), 2048],
    ['bandeau 500 × 60', makeProject('rectangle', 500, 60), 4096],
  ];
  let rapportsOk = true;
  let grandCoteOk = true;
  for (const [label, project, longSide] of cases) {
    const out = outputSizeFor(project, longSide);
    const rapportImage = out.width / out.height;
    const rapportProjet = project.widthCm / project.heightCm;
    const ecart = Math.abs(rapportImage - rapportProjet) / rapportProjet;
    const grand = Math.max(out.width, out.height);
    console.log(`   ${label.padEnd(20)} → ${out.width} × ${out.height}   rapport ${rapportImage.toFixed(4)} contre ${rapportProjet.toFixed(4)}`);
    if (ecart > 0.002) rapportsOk = false;
    if (Math.abs(grand - longSide) > 1) grandCoteOk = false;
  }
  check('A1 — le rapport de l’image est celui du projet', rapportsOk);
  check('A2 — le grand côté est celui demandé', grandCoteOk);

  // Le plafond doit intervenir, et le DIRE.
  const enorme = outputSizeFor(makeProject('square', 200, 200), 40000);
  console.log(`   demande absurde de 40 000 px → ${enorme.width} × ${enorme.height}, signalé : ${enorme.clamped}`);
  check('A3 — une définition délirante est plafonnée', enorme.width * enorme.height <= MAX_PIXELS && enorme.clamped);
  check('A4 — le plafond est signalé, pas silencieux', enorme.clamped === true);
}

const failed = results.filter((r) => !r.ok);
console.log(`
${results.length - failed.length}/${results.length} vérifications passées
`);
process.exit(failed.length ? 1 : 0);
