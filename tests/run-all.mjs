// Lanceur de toutes les suites.
//
//   npm test
//
// POURQUOI CE FICHIER. `npm test` valait `node --test tests/`. Le lanceur
// intégré de Node ne retient que les fichiers dont le NOM suit sa convention
// (`*.test.mjs`, `test-*.mjs`, ou tout fichier sous un dossier `test/` au
// singulier). Nos suites s'appellent `engine.mjs`, `mesh.mjs`… dans un dossier
// `tests/` au pluriel : aucune n'était sélectionnée. La commande sortait en 0
// sans avoir rien exécuté, ce qui est pire que pas de commande du tout.
//
// Portée exacte du défaut : les rapports de lot citent des invocations
// directes — `node tests/export.mjs — 21/21` — qui ont bel et bien tourné.
// Aucun compte publié ne venait de `npm test`. Ce qui manquait, c'était le
// moyen de tout relancer d'un coup, et donc de savoir qu'une correction dans un
// module n'avait rien cassé ailleurs.
//
// Chaque suite est un programme autonome qui sort en code 1 si une vérification
// échoue. On les enchaîne, on additionne, et on sort en échec dès qu'une seule
// tombe.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// `calibrate.mjs` est un outil de mesure, pas une suite : il imprime des
// tableaux et sort toujours en 0. Il n'a rien à faire ici.
//
// Toutes les suites portent sur du code LIVRÉ. Ce n'était plus vrai après le
// retrait du périmètre 3D : trois d'entre elles gardaient des fonctions absentes
// du bundle, et un total unique le masquait. Ces suites sont parties avec le
// code qu'elles éprouvaient.
const SUITES = ['nonregression', 'engine', 'gestures', 'dimensions', 'brush', 'image', 'shading', 'heightmap', 'effects', 'robustesse'];

const verbose = process.argv.includes('--verbose');
const resultats = [];

for (const nom of SUITES) {
  const fichier = join(here, `${nom}.mjs`);
  const t0 = Date.now();
  const run = spawnSync(process.execPath, [fichier], { encoding: 'utf-8' });
  const duree = Date.now() - t0;
  const sortie = `${run.stdout || ''}${run.stderr || ''}`;

  // Le compte est LU dans la sortie de la suite, jamais supposé. Une suite qui
  // n'imprime pas son décompte est traitée comme suspecte, même sortie en 0.
  const bilan = sortie.match(/(\d+)\/(\d+) vérifications passées/);
  const ok = run.status === 0 && bilan && bilan[1] === bilan[2];

  resultats.push({ nom, ok, passees: bilan ? +bilan[1] : 0, total: bilan ? +bilan[2] : 0, code: run.status, duree, sortie });
  if (verbose || !ok) process.stdout.write(sortie);
}

console.log('\n─────────────────────────────────────────────');
let totalPassees = 0;
let totalVerifs = 0;
for (const r of resultats) {
  totalPassees += r.passees;
  totalVerifs += r.total;
  const compte = r.total ? `${r.passees}/${r.total}` : 'AUCUN DÉCOMPTE';
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.nom.padEnd(15)} ${compte.padStart(9)}   ${String(r.duree).padStart(6)} ms`);
}
const echecs = resultats.filter((r) => !r.ok);
console.log('─────────────────────────────────────────────');
console.log(`  ${totalPassees}/${totalVerifs} vérifications sur ${SUITES.length} suites`);
console.log('');
console.log('  ⚠ Aucune de ces suites ne touche au DOM. L’interface est éprouvée');
console.log('    par `npm run fumee` (quinze vérifications, navigateur réel) et');
console.log('    par `src/empreinte.js`.');
console.log('');

if (echecs.length) {
  console.log(`ÉCHEC : ${echecs.map((r) => r.nom).join(', ')}\n`);
  process.exit(1);
}
