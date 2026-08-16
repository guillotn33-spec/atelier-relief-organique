// Robustesse — ce que le moteur fait des données qu'il n'a pas produites.
//
//   node tests/robustesse.mjs
//
// Deux failles avaient en commun de ne se voir qu'à l'usage, jamais à la
// lecture : une géométrie relue d'un enregistrement n'était pas validée, et la
// variation dérivait dans une seule direction dès que l'utilisateur sortait de
// l'intervalle canonique. Les deux sont des propriétés, donc mesurables.

import { createProject, defaultGeometry, validateGeometry, GEOMETRY_BOUNDS, GEOMETRY_LIMITS } from '../src/core/project.js';
import { nextVariation } from '../src/geometry/variation.js';
import { buildHeightmap, negateHeightmap, resoftenHeightmap, scaleHeightmapDepth } from '../src/geometry/heightmap.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

console.log('\nA. Une géométrie relue est validée, pas seulement complétée\n');

// A1. LE CAS QUI ÉTEIGNAIT TOUT. `Math.max(2, NaN)` vaut NaN : la garde de
// `makeFieldContext` ne protège de rien, `invBasin` devient NaN, la heightmap
// entière devient NaN, et l'atelier s'ouvre sur une toile vide — sans exception
// ni message, donc sans le moindre moyen de comprendre.
const corrompue = validateGeometry({ ...defaultGeometry(), basinScaleCm: NaN, density: NaN, depth: 'trois' });
const tousFinis = Object.entries(corrompue).every(([, v]) => typeof v !== 'number' || Number.isFinite(v));
check('A1 — NaN et texte sont remplacés par la valeur par défaut', tousFinis, JSON.stringify({ basinScaleCm: corrompue.basinScaleCm, density: corrompue.density, depth: corrompue.depth }));

const projetCorrompu = createProject();
projetCorrompu.geometry = corrompue;
const hmCorrompue = buildHeightmap(projetCorrompu, null, { quality: 0.35 });
let nanDansLaCarte = 0;
for (let i = 0; i < hmCorrompue.h.length; i++) if (!Number.isFinite(hmCorrompue.h[i])) nanDansLaCarte++;
check('A2 — la heightmap issue d’une géométrie corrompue reste finie', nanDansLaCarte === 0, `${nanDansLaCarte} cellule(s) non finie(s) sur ${hmCorrompue.h.length}`);

// A3. Hors bornes : on ramène dans l'intervalle canonique plutôt que d'accepter.
const hors = validateGeometry({ ...defaultGeometry(), density: 40, depth: -12, basinScaleCm: 1e9 });
const respecte = Object.entries(GEOMETRY_LIMITS).every(([cle, [lo, hi]]) => hors[cle] >= lo && hors[cle] <= hi);
check('A3 — les valeurs hors bornes sont ramenées dans l’intervalle admissible', respecte, `densité ${hors.density}, profondeur ${hors.depth}, cavités ${hors.basinScaleCm} cm`);

// A4. Une géométrie saine traverse sans être touchée : la validation ne doit
// pas être un second jeu de valeurs par défaut.
const saine = defaultGeometry();
const apres = validateGeometry(saine);
const modifies = Object.keys(saine).filter((k) => saine[k] !== apres[k]);
check('A4 — une géométrie saine traverse la validation inchangée', modifies.length === 0, modifies.join(', ') || 'aucun champ modifié');

console.log('\nB. La variation explore, elle ne pousse pas\n');

// B1. LE CLIQUET. Le premier correctif bornait par l'union de l'intervalle
// canonique et du point de départ. Le saut disparaissait, mais l'origine se
// retrouvait SUR le bord de l'intervalle de réflexion : tous les tirages d'un
// côté étaient repliés, aucun ne passait. L'espérance devenait strictement
// supérieure au départ, et la borne remontait à chaque tour.
//
// Mesure : une densité posée à 10 % — hors de la bande canonique [0,18 ; 0,72]
// — puis UNE seule variation, sur trois cents graines. Un seul pas isole le
// cliquet : au-delà, une marche bornée partie près d'un bord dérive vers le
// centre pour des raisons de diffusion, ce qui n'est pas le défaut cherché.
// Ce qu'on exige ici : les deux sens sont tirés, et l'écart moyen d'un pas
// reste petit devant l'amplitude du pas lui-même (0,07).
function derive(cle, depart, tours = 1, graines = 300) {
  let auDessus = 0;
  let auDessous = 0;
  let sommeEcart = 0;
  let compte = 0;
  for (let g = 0; g < graines; g++) {
    let geometry = { ...defaultGeometry(), [cle]: depart, variationSeed: g * 7919 + 13 };
    for (let t = 0; t < tours; t++) {
      geometry = nextVariation(geometry);
      if (geometry[cle] > depart) auDessus++;
      else if (geometry[cle] < depart) auDessous++;
      sommeEcart += geometry[cle] - depart;
      compte++;
    }
  }
  return { auDessus, auDessous, ecartMoyen: sommeEcart / compte };
}

const bas = derive('density', 0.10);
check(
  'B1 — une densité posée sous la bande canonique ne remonte pas d’office',
  bas.auDessous > 0 && bas.auDessus > 0 && Math.abs(bas.ecartMoyen) < 0.012,
  `${bas.auDessus} tirages au-dessus, ${bas.auDessous} au-dessous, écart moyen ${(bas.ecartMoyen * 100).toFixed(2)} points`
);

const haut = derive('density', 0.90);
check(
  'B2 — une densité posée au-dessus de la bande ne redescend pas d’office',
  haut.auDessous > 0 && haut.auDessus > 0 && Math.abs(haut.ecartMoyen) < 0.012,
  `${haut.auDessus} tirages au-dessus, ${haut.auDessous} au-dessous, écart moyen ${(haut.ecartMoyen * 100).toFixed(2)} points`
);

// B3. Le premier saut reste petit : c'est le défaut d'origine, il ne doit pas
// revenir. Avant le lot 9, une densité à 10 % remontait entre 22 et 29 % en une
// seule variation.
let sautMax = 0;
for (let g = 0; g < 60; g++) {
  const apresUn = nextVariation({ ...defaultGeometry(), density: 0.10, variationSeed: g * 104729 + 3 });
  sautMax = Math.max(sautMax, Math.abs(apresUn.density - 0.10));
}
check('B3 — le premier saut reste sous 10 points de densité', sautMax < 0.10, `saut maximal ${(sautMax * 100).toFixed(2)} points sur 60 graines`);

// B4. Les bornes de l'interface ne sont jamais franchies, même après une longue
// suite : un curseur ne doit pas afficher une valeur qu'il ne peut pas montrer.
let chaine = { ...defaultGeometry(), density: 0.90, elongation: 1, irregularity: 0 };
let franchie = null;
for (let t = 0; t < 300 && !franchie; t++) {
  chaine = nextVariation(chaine);
  for (const [cle, [lo, hi]] of Object.entries(GEOMETRY_LIMITS)) {
    const v = chaine[cle];
    if (!Number.isFinite(v)) { franchie = `${cle} non fini`; break; }
    // La variation peut sortir de l'intervalle canonique — c'est ce qui lui
    // permet de secouer un réglage manuel extrême — mais jamais des bornes
    // ADMISSIBLES, celles que les curseurs savent montrer.
    if (v < lo - 1e-9 || v > hi + 1e-9) { franchie = `${cle} = ${v} hors [${lo}, ${hi}]`; break; }
  }
}
check('B4 — trois cents variations restent dans les bornes admissibles', franchie === null, franchie || '300 itérations, treize paramètres');

// B5. Une géométrie corrompue ne doit pas contaminer la variation.
const varieeDepuisNaN = nextVariation({ ...defaultGeometry(), density: NaN, elongation: NaN });
const finiApresNaN = Object.entries(varieeDepuisNaN).every(([, v]) => typeof v !== 'number' || Number.isFinite(v));
check('B5 — varier une géométrie corrompue rend des nombres finis', finiApresNaN, `densité ${varieeDepuisNaN.density}, allongement ${varieeDepuisNaN.elongation}`);


console.log('\nC. Les retouches valent une reconstruction\n');

// TROIS CURSEURS NE RECONSTRUISENT PLUS RIEN. Encore faut-il que la retouche
// donne EXACTEMENT ce que la reconstruction aurait donné — sinon on a échangé
// 130 ms contre un relief différent. C'est ce que ces trois mesures exigent :
// l'écart est rapporté à l'amplitude du relief, et doit rester au niveau du
// bruit d'arrondi des flottants.
function panneau(mod) {
  const project = createProject({ canvasShape: 'rectangle', widthCm: 200, heightCm: 120, depthCm: 6 });
  Object.assign(project.geometry, defaultGeometry());
  if (mod) mod(project.geometry);
  return project;
}

function ecartRelatif(a, b) {
  const amplitude = Math.max(b.max - b.min, 1e-9);
  let pire = 0;
  for (let i = 0; i < a.h.length; i++) pire = Math.max(pire, Math.abs(a.h[i] - b.h[i]));
  return pire / amplitude;
}

// C1 — le mode négatif.
const positif = buildHeightmap(panneau(), null, { quality: 0.5 });
const negatifAttendu = buildHeightmap(panneau((g) => { g.negative = true; }), null, { quality: 0.5 });
negateHeightmap(positif);
const e1 = ecartRelatif(positif, negatifAttendu);
check('C1 — retourner le relief vaut une reconstruction en négatif', e1 < 1e-6, `écart maximal ${(e1 * 100).toExponential(2)} % de l’amplitude`);
check('C1b — les bornes suivent le retournement', Math.abs(positif.min - negatifAttendu.min) < 1e-6 && Math.abs(positif.max - negatifAttendu.max) < 1e-6, `min ${positif.min.toFixed(4)} vs ${negatifAttendu.min.toFixed(4)}`);

// C2 — la profondeur, sans sculpture. La hauteur est affine en profondeur :
// h = depth · (houle·extinction·porteuse − creusement) + sculpture.
const misAEchelle = buildHeightmap(panneau((g) => { g.depth = 0.92; }), null, { quality: 0.5 });
const depthAttendu = buildHeightmap(panneau((g) => { g.depth = 0.41; }), null, { quality: 0.5 });
scaleHeightmapDepth(misAEchelle, 0.92, 0.41);
const e2 = ecartRelatif(misAEchelle, depthAttendu);
check('C2 — mettre la profondeur à l’échelle vaut une reconstruction', e2 < 1e-6, `0,92 → 0,41, écart maximal ${(e2 * 100).toExponential(2)} % de l’amplitude`);

// L'occlusion aussi : c'est elle qui règle la profondeur du noir, et la fausser
// ne se verrait pas sur les hauteurs mais sur l'image.
let ecartAo = 0;
for (let i = 0; i < misAEchelle.ao.data.length; i++) ecartAo = Math.max(ecartAo, Math.abs(misAEchelle.ao.data[i] - depthAttendu.ao.data[i]));
check('C2b — le champ d’occlusion suit la mise à l’échelle', ecartAo / Math.max(depthAttendu.max - depthAttendu.min, 1e-9) < 1e-6, `écart maximal ${ecartAo.toExponential(2)}`);

// C3 — l'adoucissement. `softness` n'apparaît nulle part dans `field.js` : il ne
// règle que le rayon du flou, donc refaire le flou depuis `raw` suffit.
const projetDoux = panneau((g) => { g.softness = 0.20; });
const adouci = buildHeightmap(projetDoux, null, { quality: 0.5 });
projetDoux.geometry.softness = 0.85;
const douxAttendu = buildHeightmap(projetDoux, null, { quality: 0.5 });
resoftenHeightmap(adouci, projetDoux);
const e3 = ecartRelatif(adouci, douxAttendu);
check('C3 — refaire l’adoucissement vaut une reconstruction', e3 < 1e-6, `0,20 → 0,85, écart maximal ${(e3 * 100).toExponential(2)} % de l’amplitude`);

// C4 — le gain. On ne mesure pas un temps absolu (il dépend de la machine) mais
// un RAPPORT, qui, lui, est une propriété du code.
const projetMesure = panneau();
const chrono = (fn) => { fn(); let m = Infinity; for (let i = 0; i < 5; i++) { const t = performance.now(); fn(); m = Math.min(m, performance.now() - t); } return m; };
const coutReconstruction = chrono(() => buildHeightmap(projetMesure, null, {}));
const carte = buildHeightmap(projetMesure, null, {});
const coutRetouche = chrono(() => { negateHeightmap(carte); });
const rapport = coutReconstruction / Math.max(coutRetouche, 1e-6);
check('C4 — retourner le relief est au moins vingt fois moins cher que reconstruire', rapport > 20, `${coutReconstruction.toFixed(1)} ms contre ${coutRetouche.toFixed(2)} ms, soit ${rapport.toFixed(0)}×`);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées\n`);
if (passed !== results.length) process.exit(1);
