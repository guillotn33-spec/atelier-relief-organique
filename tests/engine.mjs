// Tests du moteur procédural (lot 2).
//
//   node tests/engine.mjs
//
// Les deux tests centraux ne vérifient pas un réglage heureux mais une propriété
// STRUCTURELLE, et chacun est étalonné : le test d'îlot est d'abord exécuté sur
// le moteur v1, qui doit ÉCHOUER. Un test que rien ne fait échouer ne prouve rien.

import { buildHeightmap, sampleHeight } from '../src/geometry/heightmap.js';
import { createProject, captureBase, baseGeometryOf, defaultGeometry, PRESETS } from '../src/core/project.js';
import { nextVariation } from '../src/geometry/variation.js';
import { SculptLayer } from '../src/sculpt/layer.js';
import { stamp } from '../src/sculpt/brush.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

function makeProject(geometryOverrides = {}, dims = {}) {
  const project = createProject({
    canvasShape: 'rectangle',
    widthCm: dims.widthCm ?? 160,
    heightCm: dims.heightCm ?? 100,
    depthCm: 6,
  });
  Object.assign(project.geometry, geometryOverrides);
  return project;
}

// ---- A. Aucun anneau, aucun îlot central ----

const RING_RADIUS = 6;

/**
 * Un ÎLOT est une bosse ENCLAVÉE : un point situé dans une cavité, plus haut que
 * TOUT l'anneau qui l'entoure. Sa proéminence — hauteur au-dessus du plus bas de
 * cet anneau — dit ensuite si l'œil la verrait.
 *
 * Deux définitions plus larges ont été essayées et écartées, chacune parce
 * qu'elle confondait le défaut avec une forme légitime :
 *
 *  • « plus haut que le plus BAS de l'anneau » compte les crêtes entre deux
 *    chenaux, qui sont partout dans les références.
 *  • « la hauteur redescend le long d'un rayon » compte le passage d'une cavité
 *    à sa voisine par-dessus un col — c'est-à-dire exactement la fusion des
 *    formes que ce lot cherche à produire.
 *
 * Le fond plat de la version 1 n'est pas mesuré ici : dans le relief FINAL, sa
 * houle additive incline le fond, si bien qu'il n'est plus plat au sens
 * numérique. Le prétendre serait faux. Ce que ce lot supprime avec certitude,
 * c'est la cause — le creusement ne sature plus jamais.
 */
function analyseRelief(hm) {
  const { cols, rows, h } = hm;
  const sorted = Float64Array.from(h).sort();
  const plateau = sorted[Math.floor(sorted.length * 0.85)];
  const span = plateau - sorted[0];
  if (span <= 0) return { maxProminencePct: 0, islands: 0, inCavity: 0 };

  const cavityLevel = plateau - 0.3 * span;
  const eps = span * 1e-9;
  const margin = RING_RADIUS + 1;

  const ring = (r, c, radius) => {
    let min = Infinity;
    let max = -Infinity;
    for (let a = 0; a < 32; a++) {
      const angle = (a / 32) * Math.PI * 2;
      const rr = Math.min(rows - 1, Math.max(0, r + Math.round(Math.sin(angle) * radius)));
      const cc = Math.min(cols - 1, Math.max(0, c + Math.round(Math.cos(angle) * radius)));
      const value = h[rr * cols + cc];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return { min, max };
  };

  let islands = 0;
  let maxProminence = 0;
  let inCavity = 0;

  for (let r = margin; r < rows - margin; r++) {
    for (let c = margin; c < cols - margin; c++) {
      const value = h[r * cols + c];
      if (value >= cavityLevel) continue;
      inCavity++;

      let isMax = true;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (h[(r + dr) * cols + (c + dc)] >= value - eps) isMax = false;
        }
      }
      if (!isMax) continue;

      const { min, max } = ring(r, c, RING_RADIUS);
      if (max >= value) continue; // pas une enclave : l'anneau remonte quelque part
      islands++;
      maxProminence = Math.max(maxProminence, value - min);
    }
  }

  return { islands, maxProminencePct: (maxProminence / span) * 100, inCavity };
}

console.log('\nA. Anneaux et îlots enclavés au fond des cavités\n');

// Étalonnage du détecteur sur un relief FABRIQUÉ pour contenir le défaut : une
// cavité en anneau avec une bosse au centre. Un détecteur que rien ne fait
// sonner ne prouve rien.
function syntheticDonut() {
  const cols = 400;
  const rows = 400;
  const h = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = Math.hypot(c - 200, r - 200) * 0.25;
      let value = 0;
      if (d < 40) {
        value = d < 24 ? -1 : -1 * Math.min(1, Math.max(0, (40 - d) / 16));
        if (d < 12) value = -1 + 0.45 * (1 - d / 12); // la bosse centrale
      }
      h[r * cols + c] = value;
    }
  }
  return { cols, rows, cellCm: 0.25, h, min: -1, max: 0 };
}
const donut = analyseRelief(syntheticDonut());
console.log(`   relief témoin (anneau fabriqué) : ${donut.islands} îlot(s), proéminence ${donut.maxProminencePct.toFixed(1)} %`);
check('A0 — le détecteur voit l’îlot du relief témoin', donut.islands > 0 && donut.maxProminencePct > 5, `proéminence ${donut.maxProminencePct.toFixed(1)} % de l’amplitude`);

let worstProminence = 0;
let presetIslands = 0;
for (const [key, preset] of Object.entries(PRESETS)) {
  const a = analyseRelief(buildHeightmap(makeProject(preset.geometry), null));
  console.log(`   ${key.padEnd(9)} : ${a.islands} îlot(s) enclavé(s) sur ${a.inCavity} cellules en cavité`);
  worstProminence = Math.max(worstProminence, a.maxProminencePct);
  presetIslands += a.islands;
}
check('A1 — aucun îlot enclavé dans les trois préréglages', presetIslands === 0, `${presetIslands} îlot(s)`);

// La propriété doit tenir sur tout l'espace atteignable ET sur plusieurs
// formats. Le lot 2 ne mesurait qu'un seul panneau, et concluait à tort que le
// plancher de `channelRatio` réglait la question : le facteur réel est le
// NOMBRE de cavités dans la fenêtre, donc la taille du panneau.
//
// Sur cet espace la garantie est MESURÉE, pas absolue : un minimum local du
// bruit tombant dans sa propre zone creusée produit une bosse enclavée.
// L'éliminer exigerait une transformée de distance, donc une opération globale
// qui détruirait la continuité en centimètres du champ (test B), ou un moteur
// où la bande de chenaux dérive de celle des bassins. Les deux sont hors
// périmètre ici. Ce test enregistre donc l'état réel, format par format.
const SIZES = [
  { widthCm: 160, heightCm: 100, partMax: 2 },
  { widthCm: 200, heightCm: 120, partMax: 4 },
  { widthCm: 300, heightCm: 180, partMax: 6 },
];

// LA STATISTIQUE PORTE SUR LES VARIATIONS, PAS SUR LES ÎLOTS.
//
// La version précédente prenait la médiane de la liste des proéminences des
// îlots TROUVÉS, les variations propres étant absentes de la liste. Cette
// médiane monte donc quand le nombre d'îlots baisse : mesuré sur Archipel,
// six îlots à 16,3 % notaient MIEUX qu'un seul à 18,2 %, et vingt-trois petits
// îlots (19,4 %) notaient presque comme l'unique de la version saine (18,5 %).
// L'oracle récompensait la prolifération et punissait la rareté — l'inverse de
// la propriété visée.
//
// La grandeur retenue est celle que voit l'utilisateur : sur cent variations
// tirées, combien portent une bosse enclavée que l'œil remarque. Le seuil de
// visibilité est 5 %, calibré sur le relief témoin de A0 — sa bosse fabriquée
// pour être vue mesure 5,9 %.
const VISIBLE_PCT = 5;

for (const size of SIZES) {
  const prominences = [];
  for (const preset of Object.values(PRESETS)) {
    let geometry = { ...defaultGeometry(), ...preset.geometry };
    for (let i = 0; i < 16; i++) {
      geometry = nextVariation(geometry);
      const project = makeProject(geometry, size);
      prominences.push(analyseRelief(buildHeightmap(project, null)).maxProminencePct);
    }
  }
  const visibles = prominences.filter((p) => p > VISIBLE_PCT).length;
  const part = (100 * visibles) / prominences.length;
  const max = Math.max(...prominences);
  console.log(`   ${size.widthCm} × ${size.heightCm} cm : ${visibles} variation(s) sur ${prominences.length} portent un îlot visible — ${part.toFixed(1)} %, pire proéminence ${max.toFixed(2)} %`);
  check(
    `A2 — moins de ${size.partMax} % des variations portent un îlot visible sur ${size.widthCm} × ${size.heightCm} cm`,
    part <= size.partMax,
    `${part.toFixed(1)} % des variations, pire proéminence ${max.toFixed(2)} %`
  );
}

// ---- B. Le champ est en centimètres : agrandir révèle sans déplacer ----

console.log('\nB. Agrandissement de la toile : révéler sans déplacer\n');

const small = makeProject(PRESETS.dunes.geometry, { widthCm: 160, heightCm: 100 });
const large = makeProject(PRESETS.dunes.geometry, { widthCm: 260, heightCm: 170 });
const hmSmall = buildHeightmap(small, null);
const hmLarge = buildHeightmap(large, null);

// B1 — sur la zone commune, le relief doit être le même, au centimètre près.
let maxShift = 0;
let sumShift = 0;
let samples = 0;
for (let i = 0; i <= 60; i++) {
  for (let j = 0; j <= 40; j++) {
    const xCm = -74 + (i / 60) * 148; // marge de 6 cm pour éviter l'effet de bord du flou
    const yCm = -44 + (j / 40) * 88;
    const a = sampleHeight(hmSmall, xCm, yCm);
    const b = sampleHeight(hmLarge, xCm, yCm);
    const diff = Math.abs(a - b);
    maxShift = Math.max(maxShift, diff);
    sumShift += diff;
    samples++;
  }
}
const amplitude = hmSmall.max - hmSmall.min;
console.log(`   amplitude du relief : ${amplitude.toFixed(4)}`);
console.log(`   zone commune, écart maximal : ${maxShift.toFixed(5)} (${((maxShift / amplitude) * 100).toFixed(3)} %)`);
console.log(`   zone commune, écart moyen   : ${(sumShift / samples).toFixed(5)}`);
check('B1 — le motif existant ne bouge pas (écart max < 1 % de l’amplitude)', maxShift / amplitude < 0.01, `${((maxShift / amplitude) * 100).toFixed(3)} %`);

// B2 — la zone révélée doit contenir du motif, pas un prolongement plat.
function stdDevInBand(hm, project, insideOnly) {
  const halfW = project.widthCm / 2;
  const halfH = project.heightCm / 2;
  const values = [];
  for (let i = 0; i <= 80; i++) {
    for (let j = 0; j <= 60; j++) {
      const xCm = -halfW + (i / 80) * project.widthCm * 0.98 + halfW * 0.01;
      const yCm = -halfH + (j / 60) * project.heightCm * 0.98 + halfH * 0.01;
      const insideSmall = Math.abs(xCm) <= 80 && Math.abs(yCm) <= 50;
      if (insideOnly !== insideSmall) continue;
      values.push(sampleHeight(hm, xCm, yCm));
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}
const sdInside = stdDevInBand(hmLarge, large, true);
const sdRevealed = stdDevInBand(hmLarge, large, false);
console.log(`   écart-type au centre (zone déjà visible) : ${sdInside.toFixed(4)}`);
console.log(`   écart-type dans la bande révélée         : ${sdRevealed.toFixed(4)}`);
// Le seuil était à 0,55 sous une étiquette qui promettait « autant de motif » :
// une bande deux fois moins texturée l'aurait satisfait. Mesuré, le rapport
// vaut 1,10 — la bande révélée porte même un peu plus de motif que le centre.
// Le seuil est ramené à 0,85, ce que l'étiquette affirme réellement.
check(
  'B2 — la bande révélée porte autant de motif que le centre',
  sdRevealed > sdInside * 0.85,
  `rapport ${(sdRevealed / sdInside).toFixed(2)}`
);

// ---- C. Négatif géométrique, non destructif ----

console.log('\nC. Mode négatif\n');

const posProject = makeProject(PRESETS.archipel.geometry);
const h1 = buildHeightmap(posProject, null).h.slice();
posProject.geometry.negative = true;
const h2 = buildHeightmap(posProject, null).h.slice();
posProject.geometry.negative = false;
const h3 = buildHeightmap(posProject, null).h.slice();

let exactReturn = true;
let exactMirror = true;
for (let i = 0; i < h1.length; i++) {
  if (h1[i] !== h3[i]) exactReturn = false;
  if (h2[i] !== -h1[i]) exactMirror = false;
}
check('C1 — désactiver le négatif restitue le relief bit à bit', exactReturn);
check('C2 — le négatif est le miroir exact autour du plan neutre', exactMirror);

// ---- D. Définir comme base / Retour base ----

console.log('\nD. Instantané de base\n');

const baseProject = makeProject(PRESETS.dunes.geometry);
const layer = SculptLayer.forCanvas(baseProject.widthCm, baseProject.heightCm);
for (let i = 0; i < 6; i++) {
  stamp(layer, { tool: 'dig', xCm: -30 + i * 12, yCm: 8, dxCm: 12, dyCm: 0, radiusCm: 14, strength: 0.6, pressure: 1, first: i === 0 });
}
const reference = buildHeightmap(baseProject, layer).h.slice();
const snapshot = captureBase(baseProject, layer);

// On dérive franchement : nouvelle variation ET sculpture supplémentaire.
baseProject.geometry = nextVariation(nextVariation(baseProject.geometry));
for (let i = 0; i < 6; i++) {
  stamp(layer, { tool: 'raise', xCm: 20 - i * 9, yCm: -22, dxCm: -9, dyCm: 0, radiusCm: 11, strength: 0.7, pressure: 1, first: i === 0 });
}
const drifted = buildHeightmap(baseProject, layer).h.slice();
let driftMax = 0;
for (let i = 0; i < reference.length; i++) driftMax = Math.max(driftMax, Math.abs(reference[i] - drifted[i]));

baseProject.geometry = baseGeometryOf(snapshot, baseProject.geometry);
layer.adopt(snapshot.sculpt);
const restored = buildHeightmap(baseProject, layer).h.slice();

let exactRestore = true;
for (let i = 0; i < reference.length; i++) {
  if (reference[i] !== restored[i]) {
    exactRestore = false;
    break;
  }
}
console.log(`   écart après dérive : ${driftMax.toFixed(4)} (le design a bien changé)`);
check('D1 — la dérive est réelle', driftMax > 0.05, `${driftMax.toFixed(4)}`);
check('D2 — Retour base restitue géométrie ET sculpture bit à bit', exactRestore);

// ---- E. Déterminisme ----

console.log('\nE. Déterminisme\n');

const detA = buildHeightmap(makeProject(PRESETS.cellules.geometry), null).h;
const detB = buildHeightmap(makeProject(PRESETS.cellules.geometry), null).h;
let identical = detA.length === detB.length;
for (let i = 0; identical && i < detA.length; i++) if (detA[i] !== detB[i]) identical = false;
check('E1 — à graine identique, relief identique', identical);

const varA = nextVariation({ ...defaultGeometry(), ...PRESETS.dunes.geometry });
const varB = nextVariation({ ...defaultGeometry(), ...PRESETS.dunes.geometry });
const sameVariation = Object.keys(varA).every((k) => varA[k] === varB[k]);
check('E2 — la variation est déterministe', sameVariation);

const chain = nextVariation(varA);
const changed = Object.keys(chain).filter((k) => chain[k] !== varA[k]);
// Compter les paramètres modifiés ne prouve rien : huit champs bougés de 1e-9
// auraient satisfait l'ancien oracle en laissant le relief identique à l'œil.
// On mesure donc le RELIEF, sur la grandeur qui compte — l'écart rapporté à
// l'amplitude.
const reliefA = buildHeightmap(makeProject(varA), null);
const reliefB = buildHeightmap(makeProject(chain), null);
let ecartMax = 0;
let ecartSomme = 0;
for (let i = 0; i < reliefA.h.length; i++) {
  const d = Math.abs(reliefA.h[i] - reliefB.h[i]);
  ecartSomme += d;
  if (d > ecartMax) ecartMax = d;
}
const amplitudeA = reliefA.max - reliefA.min;
const ecartMoyenPct = (100 * ecartSomme) / reliefA.h.length / amplitudeA;
console.log(`   variation : ${changed.length} paramètres, écart moyen ${ecartMoyenPct.toFixed(1)} % de l’amplitude, maximal ${((100 * ecartMax) / amplitudeA).toFixed(1)} %`);
check('E3a — une variation touche plusieurs paramètres', changed.length >= 8, `${changed.length} paramètres modifiés`);
check(
  'E3b — et le relief en sort visiblement différent',
  ecartMoyenPct > 5,
  `écart moyen ${ecartMoyenPct.toFixed(1)} % de l’amplitude`
);
check('E4 — la variation ne touche ni la graine ni la douceur', chain.seed === varA.seed && chain.softness === varA.softness);

// ---- Bilan ----

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
