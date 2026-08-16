// Banc de mesure hors navigateur — sert à chiffrer les lots de performance.
//
// Ce n'est PAS une suite de vérification : il ne dit ni vrai ni faux, il donne
// des millisecondes. `run-all.mjs` ne le lance pas. On l'appelle à la main :
//
//     node tests/mesure.mjs
//     node tests/mesure.mjs --json          (pour comparer deux révisions)
//
// Les temps sont médians sur plusieurs passes, précédés d'une passe de chauffe :
// la première construction paie la compilation JIT et fausserait la comparaison.

import { createProject, PRESETS, applyPreset } from '../src/core/project.js';
import { buildHeightmap, gridFor, negateHeightmap, resoftenHeightmap, scaleHeightmapDepth } from '../src/geometry/heightmap.js';
import { shadeParams, shadeRegion } from '../src/render2d/shade.js';
import { resampleTo } from '../src/geometry/heightmap.js';

const PANNEAU = { canvasShape: 'rectangle', widthCm: 200, heightCm: 120, depthCm: 6 };
const PASSES = 9;

// LE MINIMUM, PAS LA MÉDIANE.
//
// Le bruit de mesure d'une machine partagée est à SENS UNIQUE : une passe peut
// être ralentie par un autre processus, jamais accélérée. La médiane le laisse
// donc passer — deux exécutions du même code ont donné 133 puis 144 ms — alors
// que le minimum est l'estimateur le moins biaisé du coût réel du code.
function minimum(valeurs) {
  return Math.min(...valeurs);
}

function chronometrer(fn, passes = PASSES) {
  fn(); // chauffe
  const temps = [];
  for (let i = 0; i < passes; i++) {
    const t0 = performance.now();
    fn();
    temps.push(performance.now() - t0);
  }
  return minimum(temps);
}

const projets = {};
for (const cle of Object.keys(PRESETS)) {
  projets[cle] = applyPreset(createProject(PANNEAU), cle);
}
// Une par famille procédurale, pour que le tableau ne cache pas un cas coûteux.
const familles = { organic: 'dunes', cells: 'cellules', archipelago: 'archipel' };

const resultats = {};

const grille = gridFor(PANNEAU.widthCm, PANNEAU.heightCm, 1);
resultats.cellules = grille.cols * grille.rows;

for (const [famille, preset] of Object.entries(familles)) {
  const project = projets[preset];
  resultats[`construction:${famille}`] = chronometrer(() => buildHeightmap(project, null, {}));
  resultats[`construction:${famille}@0.5`] = chronometrer(() => buildHeightmap(project, null, { quality: 0.5 }));
}

// Retouches sans réévaluation du champ — ce que coûtent désormais les trois
// curseurs qui reconstruisaient tout (`negative`, `depth`, `softness`).
{
  const project = projets.dunes;
  const carte = buildHeightmap(project, null, {});
  resultats['retouche:negative'] = chronometrer(() => negateHeightmap(carte));
  let sens = 1;
  resultats['retouche:depth'] = chronometrer(() => {
    scaleHeightmapDepth(carte, sens === 1 ? 0.92 : 0.41, sens === 1 ? 0.41 : 0.92);
    sens = -sens;
  });
  resultats['retouche:softness'] = chronometrer(() => resoftenHeightmap(carte, project));
}

// Ombrage : coût d'un réombrage seul, celui que paie chaque cran d'un curseur
// de lumière. La heightmap est construite une fois hors chronomètre.
{
  const project = projets.dunes;
  const hm = buildHeightmap(project, null, {});
  const outW = 1020;
  const outH = 612;
  const map = resampleTo(hm, project, outW, outH);
  const ao = new Float32Array(outW * outH);
  for (let i = 0; i < ao.length; i++) ao[i] = map[i] * 0.5;
  const data = new Uint8ClampedArray(outW * outH * 4);
  const sp = shadeParams(project, outW, hm.max - hm.min);
  resultats['ombrage:1020x612'] = chronometrer(() => {
    shadeRegion(data, map, ao, outW, outH, 0, 0, outW, outH, 0, 0, outW, outH, sp);
  });
  resultats['reechantillonnage:1020x612'] = chronometrer(() => resampleTo(hm, project, outW, outH));
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(resultats, null, 2));
} else {
  const large = Math.max(...Object.keys(resultats).map((k) => k.length));
  console.log('');
  for (const [cle, valeur] of Object.entries(resultats)) {
    const v = cle === 'cellules' ? String(valeur) : `${valeur.toFixed(1)} ms`;
    console.log(`  ${cle.padEnd(large)}   ${v.padStart(10)}`);
  }
  console.log('');
}
