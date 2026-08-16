// Compilateur de prompt — ce qu'il promet est mesurable, donc mesuré.
//
//   node tests/prompt.mjs
//
// Un générateur de texte ne « passe » pas ou ne « rate » pas à la lecture : il
// faut décider ce qu'il garantit. Quatre garanties ici :
//
//   • il est TOTAL — aucune configuration atteignable ne produit de trou ;
//   • il est DÉTERMINISTE — même projet, même texte, toujours ;
//   • il est MONOTONE — pousser un curseur ne peut pas faire reculer la
//     formule qui le décrit ;
//   • il est LOCAL — bouger un curseur ne réécrit pas les sections qui ne le
//     concernent pas.
//
// Et l'estimation du nombre de cavités est confrontée au COMPTAGE RÉEL, pas à
// elle-même.

import { createProject, defaultGeometry, GEOMETRY_LIMITS } from '../src/core/project.js';
import { compilerPrompt, estimerCavites, nommerCouleur, PRECISIONS } from '../src/core/prompt.js';
import { buildHeightmap } from '../src/geometry/heightmap.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

const FAMILLES = ['organic', 'dunes', 'cells', 'archipelago'];
const FINITIONS = ['mat', 'satine', 'brillant', 'chrome'];
const DECOUPES = ['none', '2x1', '2x2', '3x2'];

function panneau(mod) {
  const p = createProject({ canvasShape: 'rectangle', widthCm: 200, heightCm: 120, depthCm: 6 });
  p.geometry = { ...defaultGeometry() };
  if (mod) mod(p);
  return p;
}

console.log('\nA. Le compilateur est total\n');

// Balayage : chaque paramètre poussé à ses deux bornes et au milieu, croisé
// avec les familles, les finitions, les découpes et les trois fidélités.
const trous = [];
let configurations = 0;
for (const famille of FAMILLES) {
  for (const [cle, [lo, hi]] of Object.entries(GEOMETRY_LIMITS)) {
    for (const v of [lo, (lo + hi) / 2, hi]) {
      for (const forme of ['rectangle', 'square', 'circle']) {
        const p = panneau((q) => { q.geometry.family = famille; q.geometry[cle] = v; q.canvasShape = forme; });
        const r = compilerPrompt(p, { precision: 'strict' });
        configurations++;
        for (const [nom, texte] of Object.entries(r.sections)) {
          if (typeof texte !== 'string' || texte.length < 8 || /undefined|NaN|\[object/.test(texte)) {
            trous.push(`${famille}/${cle}=${v}/${forme} → ${nom} : ${texte}`);
          }
        }
      }
    }
  }
}
for (const finish of FINITIONS) {
  for (const layout of DECOUPES) {
    for (const precision of Object.keys(PRECISIONS)) {
      const p = panneau((q) => { q.material.finish = finish; q.presentation.panelLayout = layout; });
      const r = compilerPrompt(p, { precision });
      configurations++;
      if (/undefined|NaN/.test(r.text + r.negative)) trous.push(`${finish}/${layout}/${precision}`);
    }
  }
}
check('A1 — aucune section vide ni « undefined » sur tout le balayage', trous.length === 0, trous.length ? trous.slice(0, 3).join(' ; ') : `${configurations} configurations`);

// Les couleurs sont nommées, jamais rendues en hexadécimal dans le texte.
const hexDansLeTexte = [];
for (let i = 0; i < 512; i++) {
  const hex = '#' + ((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6);
  const nom = nommerCouleur(hex);
  if (!nom || /#|undefined|NaN/.test(nom)) hexDansLeTexte.push(`${hex} → ${nom}`);
}
check('A2 — cinq cents couleurs prises au hasard reçoivent toutes un nom', hexDansLeTexte.length === 0, hexDansLeTexte.slice(0, 3).join(', ') || '512 couleurs nommées');

console.log('\nB. Déterminisme et localité\n');

const base = panneau();
check('B1 — même projet, même texte', compilerPrompt(base).text === compilerPrompt(base).text);

// LOCALITÉ. Bouger un curseur de géométrie ne doit pas réécrire la section
// « matière » ni la section « lumière ». C'est ce qui rend les sections
// modifiables une par une sans que l'application les écrase.
const fuites = [];
const CIBLES = {
  depth: 'geometrie', softness: 'geometrie', wave: 'geometrie', irregularity: 'geometrie',
  elongation: 'geometrie', channelWeight: 'geometrie', basinScaleCm: 'geometrie',
};
for (const [cle, section] of Object.entries(CIBLES)) {
  const [lo, hi] = GEOMETRY_LIMITS[cle];
  const a = compilerPrompt(panneau((q) => { q.geometry[cle] = lo; })).sections;
  const b = compilerPrompt(panneau((q) => { q.geometry[cle] = hi; })).sections;
  for (const nom of Object.keys(a)) {
    const change = a[nom] !== b[nom];
    if (change && nom !== section) fuites.push(`${cle} modifie « ${nom} »`);
    if (!change && nom === section) fuites.push(`${cle} ne modifie PAS « ${section} »`);
  }
}
check('B2 — un curseur de géométrie n’écrit que dans la section géométrie', fuites.length === 0, fuites.join(' ; ') || `${Object.keys(CIBLES).length} curseurs`);

const avantLumiere = compilerPrompt(panneau()).sections;
const apresLumiere = compilerPrompt(panneau((q) => { q.lighting.angle = 90; q.lighting.height = 70; })).sections;
check(
  'B3 — un curseur de lumière n’écrit que dans la section lumière',
  avantLumiere.geometrie === apresLumiere.geometrie && avantLumiere.surface === apresLumiere.surface && avantLumiere.lumiere !== apresLumiere.lumiere
);

console.log('\nC. Les traductions sont monotones\n');

// Un palier doit avancer quand la valeur avance. Si deux valeurs croissantes
// rendent la même formule c'est normal — un palier est large ; ce qui ne l'est
// pas, c'est de REVENIR à une formule déjà quittée.
const nonMonotones = [];
for (const cle of ['depth', 'softness', 'wave', 'irregularity', 'elongation']) {
  const [lo, hi] = GEOMETRY_LIMITS[cle];
  const vues = [];
  for (let i = 0; i <= 40; i++) {
    const v = lo + ((hi - lo) * i) / 40;
    const phrase = compilerPrompt(panneau((q) => { q.geometry[cle] = v; })).sections.geometrie;
    if (phrase !== vues[vues.length - 1]) {
      if (vues.includes(phrase)) nonMonotones.push(`${cle} revient à une formule quittée`);
      vues.push(phrase);
    }
  }
  if (vues.length < 3) nonMonotones.push(`${cle} ne produit que ${vues.length} formule(s) sur toute sa course`);
}
check('C1 — chaque curseur traverse au moins trois formules, sans retour en arrière', nonMonotones.length === 0, nonMonotones.join(' ; ') || 'cinq curseurs balayés en 41 points');

// Les chenaux n'existent que dans la famille `organic` : les décrire ailleurs
// serait promettre ce que le moteur ne rend pas — le même mensonge que la
// molette « Chenaux » active hors de sa famille.
const chenauxHorsOrganic = FAMILLES.filter((f) => f !== 'organic')
  .some((f) => /channel/i.test(compilerPrompt(panneau((q) => { q.geometry.family = f; })).sections.geometrie));
check('C2 — les chenaux ne sont décrits que dans la famille organique', !chenauxHorsOrganic);

const familleDecrite = FAMILLES.every((f) => {
  const t = compilerPrompt(panneau((q) => { q.geometry.family = f; })).sections.geometrie;
  return /strata|alveolar|archipelago|organic masses/.test(t);
});
check('C3 — chaque famille est décrite par sa propre morphologie', familleDecrite);

console.log('\nD. Le JSON est la référence\n');

const r = compilerPrompt(panneau(), { precision: 'interpretation' });
const rejoue = JSON.parse(JSON.stringify(r.json));
check('D1 — le JSON survit à un aller-retour de sérialisation', JSON.stringify(rejoue) === JSON.stringify(r.json));
check('D2 — le nombre de cavités est marqué comme dérivé', r.json.geometry.cavities.estimated === true && typeof r.json.geometry.cavities.basin_scale_cm === 'number');
check('D3 — la fidélité choisie apparaît dans le JSON et dans le texte', r.json.fidelity === 'interpretation' && r.text.includes(PRECISIONS.interpretation.phrase));
check('D4 — le negative prompt ne répète pas le relief négatif', !/inverted|negative relief/i.test(r.negative) && r.negative.includes('furniture'));

console.log('\nE. L’estimation de cavités face au comptage réel\n');

// Même définition de « creusé » que l'oracle d'îlots de `tests/engine.mjs` :
// 30 % de l'amplitude sous le plateau du 85e centile.
function compterCavites(hm) {
  const { cols, rows, h } = hm;
  const trie = Float64Array.from(h).sort();
  const plateau = trie[Math.floor(trie.length * 0.85)];
  const span = plateau - trie[0];
  if (span <= 0) return 0;
  const niveau = plateau - 0.3 * span;
  const vu = new Uint8Array(cols * rows);
  const pile = new Int32Array(cols * rows);
  const minimum = Math.max(12, Math.round(cols * rows * 0.003));
  let n = 0;
  for (let d = 0; d < cols * rows; d++) {
    if (vu[d] || h[d] >= niveau) continue;
    let sommet = 0;
    let taille = 0;
    pile[sommet++] = d;
    vu[d] = 1;
    while (sommet) {
      const i = pile[--sommet];
      taille++;
      const c = i % cols;
      const rr = (i / cols) | 0;
      if (c > 0 && !vu[i - 1] && h[i - 1] < niveau) { vu[i - 1] = 1; pile[sommet++] = i - 1; }
      if (c < cols - 1 && !vu[i + 1] && h[i + 1] < niveau) { vu[i + 1] = 1; pile[sommet++] = i + 1; }
      if (rr > 0 && !vu[i - cols] && h[i - cols] < niveau) { vu[i - cols] = 1; pile[sommet++] = i - cols; }
      if (rr < rows - 1 && !vu[i + cols] && h[i + cols] < niveau) { vu[i + cols] = 1; pile[sommet++] = i + cols; }
    }
    if (taille >= minimum) n++;
  }
  return n;
}

const echantillon = [];
for (const famille of FAMILLES) {
  for (const [w, hh] of [[160, 100], [300, 160], [110, 110]]) {
    for (const b of [24, 43, 68]) {
      const p = createProject({ canvasShape: 'rectangle', widthCm: w, heightCm: hh, depthCm: 6 });
      p.geometry = { ...defaultGeometry(), family: famille, basinScaleCm: b };
      const reel = compterCavites(buildHeightmap(p, null, { quality: 0.4 }));
      echantillon.push({ famille, w, hh, b, reel, estime: estimerCavites(p) });
    }
  }
}
const ecarts = echantillon.filter((e) => e.reel > 0).map((e) => Math.abs(e.estime - e.reel) / e.reel).sort((a, b) => a - b);
const median = ecarts[ecarts.length >> 1];
const dansLeDouble = ecarts.filter((x) => x <= 1).length / ecarts.length;
check(
  'E1 — l’estimation reste dans un facteur deux du comptage réel',
  dansLeDouble >= 0.9,
  `${(dansLeDouble * 100).toFixed(0)} % des cas, écart médian ${(median * 100).toFixed(0)} % sur ${ecarts.length} panneaux`
);
const pires = [...echantillon].sort((a, b) => Math.abs(b.estime - b.reel) - Math.abs(a.estime - a.reel)).slice(0, 3);
console.log(`        pires écarts : ${pires.map((e) => `${e.famille} ${e.w}×${e.hh} @${e.b}cm : ${e.estime} contre ${e.reel}`).join(' ; ')}`);

// Le compte doit augmenter quand les cavités rapetissent : c'est la seule
// propriété dont un utilisateur se servira pour se repérer.
const croissant = FAMILLES.every((f) => {
  const n = [90, 68, 52, 43, 32, 24, 16].map((b) => estimerCavites(panneau((q) => { q.geometry.family = f; q.geometry.basinScaleCm = b; })));
  return n.every((v, i) => i === 0 || v >= n[i - 1]);
});
check('E2 — réduire la taille des cavités ne peut pas réduire leur nombre', croissant);

// Et le texte dit toujours que c'est approximatif.
const tousApproximatifs = FAMILLES.every((f) => /roughly \d+ main hollow/.test(compilerPrompt(panneau((q) => { q.geometry.family = f; })).sections.geometrie));
check('E3 — le prompt écrit toujours « roughly N », jamais un compte sec', tousApproximatifs);

const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées\n`);
if (passed !== results.length) process.exit(1);
