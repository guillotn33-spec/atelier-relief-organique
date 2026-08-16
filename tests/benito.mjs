// Palette flottante — l'arithmétique, éprouvée hors du DOM.
//
//   node tests/benito.mjs
//
// POURQUOI CE FICHIER EXISTE. `src/ui/dock.js` faisait déjà flotter des barres
// et a été supprimé au lot 9 : ses barres finissaient hors de la fenêtre, et
// rien ne pouvait le dire avant qu'un utilisateur ne le constate. Le défaut
// n'était pas dans l'écoute du pointeur mais dans le calcul de position — donc
// dans quelque chose qui se vérifie sans navigateur, à condition de l'écrire
// comme une fonction pure. C'est le même choix que l'arbitre de gestes du lot 3.
//
// Ce que `contraindre` garantit : quelle que soit la position demandée, quelle
// que soit la taille de la fenêtre, la palette reste attrapable.

import { contraindre, positionParDefaut } from '../src/ui/benito.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

const TAILLE = { w: 320, h: 96 };
const MARGE = 8;

console.log('\nA. La palette reste dans la fenêtre\n');

const fenetres = [
  { w: 1920, h: 1080 }, { w: 1440, h: 900 }, { w: 1180, h: 820 },
  { w: 1024, h: 768 }, { w: 820, h: 1180 }, { w: 390, h: 844 }, { w: 320, h: 568 },
];
const demandes = [
  { x: 0, y: 0 }, { x: -500, y: -500 }, { x: 99999, y: 99999 },
  { x: 400, y: 400 }, { x: -1, y: 1000 }, { x: 1000, y: -1 },
];

const hors = [];
for (const f of fenetres) {
  for (const d of demandes) {
    const p = contraindre(d, TAILLE, f, MARGE);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) hors.push(`${f.w}×${f.h} ← ${d.x},${d.y} : non fini`);
    else if (p.x < MARGE - 1e-9 || p.y < MARGE - 1e-9) hors.push(`${f.w}×${f.h} ← ${d.x},${d.y} → ${p.x},${p.y} : sort par le haut ou la gauche`);
    // Le débordement à droite ou en bas n'est fautif que si la palette TIENT.
    else if (TAILLE.w + 2 * MARGE <= f.w && p.x + TAILLE.w > f.w - MARGE + 1e-9) hors.push(`${f.w}×${f.h} ← ${d.x} → ${p.x} : sort par la droite`);
    else if (TAILLE.h + 2 * MARGE <= f.h && p.y + TAILLE.h > f.h - MARGE + 1e-9) hors.push(`${f.w}×${f.h} ← ${d.y} → ${p.y} : sort par le bas`);
  }
}
check('A1 — quarante-deux positions demandées, aucune hors fenêtre', hors.length === 0, hors.slice(0, 3).join(' ; ') || `${fenetres.length * demandes.length} combinaisons`);

// LE CAS QUI FAISAIT PERDRE LA PALETTE : une fenêtre plus étroite que la
// palette. Une simple borne `min(fenetre.w - w - marge, …)` donne alors un
// maximum NÉGATIF, et la palette part par la gauche — invisible et
// inatteignable, exactement ce qui arrivait après un redimensionnement.
const etroite = contraindre({ x: 600, y: 600 }, { w: 900, h: 400 }, { w: 320, h: 300 }, MARGE);
check('A2 — une fenêtre plus petite que la palette la ramène quand même au bord', etroite.x === MARGE && etroite.y === MARGE, `${etroite.x}, ${etroite.y}`);

console.log('\nB. Robustesse aux valeurs absurdes\n');

const sales = [
  ['NaN', contraindre({ x: NaN, y: NaN }, TAILLE, { w: 1440, h: 900 })],
  ['Infini', contraindre({ x: Infinity, y: -Infinity }, TAILLE, { w: 1440, h: 900 })],
  ['taille non finie', contraindre({ x: 100, y: 100 }, { w: NaN, h: NaN }, { w: 1440, h: 900 })],
  ['position absente', contraindre({}, TAILLE, { w: 1440, h: 900 })],
];
const tousFinis = sales.every(([, p]) => Number.isFinite(p.x) && Number.isFinite(p.y));
check('B1 — NaN, Infini et champs absents rendent toujours une position finie', tousFinis, sales.map(([n, p]) => `${n} → ${p.x},${p.y}`).join(' ; '));

console.log('\nC. Idempotence et position de départ\n');

// Contraindre deux fois ne doit pas déplacer : sans cela, chaque
// redimensionnement décalerait la palette un peu plus.
const derives = [];
for (const f of fenetres) {
  const une = contraindre({ x: 5000, y: 5000 }, TAILLE, f, MARGE);
  const deux = contraindre(une, TAILLE, f, MARGE);
  if (une.x !== deux.x || une.y !== deux.y) derives.push(`${f.w}×${f.h}`);
}
check('C1 — recadrer une position déjà recadrée ne la déplace pas', derives.length === 0, derives.join(', ') || 'sept fenêtres');

const departs = fenetres.map((f) => ({ f, p: positionParDefaut(f, TAILLE) }));
const departsValides = departs.every(({ f, p }) => p.x >= MARGE && p.y >= MARGE && p.x <= f.w && p.y <= f.h);
check('C2 — la position de départ est valide sur toutes les tailles d’écran', departsValides, departs.map(({ f, p }) => `${f.w}×${f.h}→${p.x},${p.y}`).join(' '));

// Sur un grand écran la palette part en bas à gauche, là où tombe la main.
const grand = positionParDefaut({ w: 1920, h: 1080 }, TAILLE);
check('C3 — sur un grand écran elle part en bas à gauche', grand.x < 200 && grand.y > 1080 / 2, `${grand.x}, ${grand.y}`);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées\n`);
if (passed !== results.length) process.exit(1);
