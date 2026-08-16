// Lot 9 — contrat de la boutique d'effets et signatures des prototypes.

import { EFFECTS, applyEffect, varyEffect } from '../src/core/effects.js';
import { PRESETS, applyPreset, createProject } from '../src/core/project.js';
import { buildHeightmap } from '../src/geometry/heightmap.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

console.log('\nA. Catalogue typé\n');

const entries = Object.entries(EFFECTS);
const counts = entries.reduce((acc, [, effect]) => {
  acc[effect.category] = (acc[effect.category] || 0) + 1;
  return acc;
}, {});
check('A1 — la boutique expose 8 formes, 7 matières et 6 éclairages', counts.form === 8 && counts.material === 7 && counts.lighting === 6, JSON.stringify(counts));

const complete = entries.every(([key, effect]) => {
  const typedPatch = effect.category === 'form' ? effect.geometry : effect.category === 'material' ? effect.material : effect.lighting;
  return key && effect.name && effect.description && ['geometry', 'shading'].includes(effect.scope) && typedPatch;
});
check('A2 — chaque effet possède identité, description, portée et correctif typé', complete);

console.log('\nB. Application sans effet de bord\n');

const base = createProject();
base.geometry.negative = true;
const form = applyEffect(base, 'fluid-dunes');
check('B1 — une forme remplace la famille et conserve le mode négatif', form.geometry.family === 'dunes' && form.geometry.negative === true);
check('B2 — une forme ne touche ni matière ni éclairage', form.material === base.material && form.lighting === base.lighting);

const material = applyEffect(base, 'porcelain');
check('B3 — une matière ne reconstruit pas la géométrie', material.geometry === base.geometry && material.material.finish === 'satine');

const light = applyEffect(base, 'deep-relief');
check('B4 — un éclairage préserve géométrie et matière', light.geometry === base.geometry && light.material === base.material && light.lighting.shadowStrength === 0.88);
check('B5 — une clé inconnue laisse le projet intact', applyEffect(base, 'effet-inconnu') === base);

console.log('\nC. Prototypes réellement distincts\n');

const families = Object.values(PRESETS).map((preset) => preset.geometry.family);
check('C1 — Dunes, Cellules et Archipel utilisent trois familles procédurales', new Set(families).size === 3, families.join(', '));

const maps = Object.keys(PRESETS).map((key) => {
  const project = applyPreset(createProject(), key);
  return { key, map: buildHeightmap(project, null) };
});
let minDistance = Infinity;
let closestPair = '';
for (let a = 0; a < maps.length; a++) {
  for (let b = a + 1; b < maps.length; b++) {
    const ma = maps[a].map;
    const mb = maps[b].map;
    const amplitude = Math.max(ma.max - ma.min, mb.max - mb.min, 1e-6);
    let sum = 0;
    for (let i = 0; i < ma.h.length; i++) sum += Math.abs(ma.h[i] - mb.h[i]);
    const distance = sum / ma.h.length / amplitude;
    if (distance < minDistance) {
      minDistance = distance;
      closestPair = `${maps[a].key}/${maps[b].key}`;
    }
  }
}
check('C2 — aucune paire de prototypes ne converge vers le même relief', minDistance > 0.12, `${closestPair} : distance normalisée ${(minDistance * 100).toFixed(1)} %`);

console.log('\nD. Le catalogue tient ses promesses\n');

// D1. La vignette d'un prototype déclare un effet ; cliquer cet effet doit rendre
// EXACTEMENT ce prototype. Avant ce lot, « Dunes » déclarait « Dunes fluides »,
// qui produit une autre famille et d'autres bassins, et Archipel déclarait
// « Relief organique », sans rapport avec elle.
const blocs = ['geometry', 'material', 'lighting', 'presentation'];
const ecarts = [];
for (const [cle, preset] of Object.entries(PRESETS)) {
  const parPreset = applyPreset(createProject(), cle);
  const parEffet = applyEffect(createProject(), preset.effectKey);
  for (const bloc of blocs) {
    for (const champ of Object.keys(preset[bloc] || {})) {
      if (parEffet[bloc][champ] !== parPreset[bloc][champ]) ecarts.push(`${cle}.${bloc}.${champ}`);
    }
  }
}
check(
  'D1 — l’effet déclaré par un prototype reproduit ce prototype',
  ecarts.length === 0,
  ecarts.length ? ecarts.join(', ') : 'les trois références coïncident sur forme, matière, lumière et présentation'
);

// D2. Un article de catalogue ne doit pas dépendre de ce qui le précède. Quatre
// des huit formes omettaient `channelRatio` : « Vagues douces » rendait 0,58
// après Dunes et 0,62 après Archipel.
const depuisDunes = applyPreset(createProject(), 'dunes');
const depuisArchipel = applyPreset(createProject(), 'archipel');
const dependants = [];
let geometriques = 0;
for (const [cle, effet] of Object.entries(EFFECTS)) {
  if (!effet.geometry) continue;
  geometriques++;
  const a = applyEffect(depuisDunes, cle).geometry;
  const b = applyEffect(depuisArchipel, cle).geometry;
  // Graine, décalage de domaine et sens du relief appartiennent au document :
  // ils DOIVENT différer ici, et les exclure n'affaiblit pas le test.
  const champs = Object.keys(a).filter((k) => !['seed', 'domainOffsetXCm', 'domainOffsetYCm', 'variationSeed', 'negative'].includes(k));
  for (const champ of champs) if (a[champ] !== b[champ]) dependants.push(`${cle}.${champ} : ${a[champ]} vs ${b[champ]}`);
}
check(
  'D2 — un effet rend la même géométrie quel que soit l’état de départ',
  dependants.length === 0,
  dependants.length ? dependants.join(', ') : `${geometriques} effets géométriques éprouvés depuis deux états différents`
);

console.log('\nE. Chaque catégorie reste dans son bloc\n');

// LE CONTRAT DE CATÉGORIE, ÉPROUVÉ STRUCTURELLEMENT PLUTÔT QU'À LA LECTURE.
//
// « Galerie blanche » était un ÉCLAIRAGE qui écrivait aussi dans
// `presentation.wallColor` — le seul des six. La couleur de mur choisie à la
// main était donc perdue au premier clic, et repasser à un autre éclairage ne
// la rendait pas, puisque aucun autre ne déclare ce champ. Relire la table ne
// l'avait pas montré ; le compter le montre.
const BLOCS_AUTORISES = {
  form: ['geometry'],
  material: ['material'],
  lighting: ['lighting'],
  // Une référence porte la composition entière : c'est sa définition.
  reference: ['geometry', 'material', 'lighting', 'presentation'],
};
const debordements = [];
for (const [cle, effet] of Object.entries(EFFECTS)) {
  const autorises = BLOCS_AUTORISES[effet.category] || [];
  for (const bloc of ['geometry', 'material', 'lighting', 'presentation']) {
    if (effet[bloc] && !autorises.includes(bloc)) debordements.push(`${cle} (${effet.category}) écrit dans ${bloc}`);
  }
}
check(
  'E1 — aucun effet n’écrit hors des blocs de sa catégorie',
  debordements.length === 0,
  debordements.length ? debordements.join(' ; ') : `${Object.keys(EFFECTS).length} effets vérifiés sur quatre blocs`
);

// La géométrie par défaut EST « Relief organique » : l'article ne déclare plus
// que sa famille et hérite du reste, donc les deux ne peuvent plus diverger.
// Auparavant l'article recopiait des valeurs qui avaient dérivé — channelRatio
// 0,58 contre 0,52 — et un document neuf ne correspondait à aucun article.
const neuf = createProject();
const commeArticle = applyEffect(neuf, 'organic-relief').geometry;
const ecartsArticle = Object.keys(commeArticle).filter((k) => commeArticle[k] !== neuf.geometry[k]);
check(
  'E2 — un document neuf EST « Relief organique »',
  ecartsArticle.length === 0,
  ecartsArticle.length ? ecartsArticle.map((k) => `${k} : ${neuf.geometry[k]} vs ${commeArticle[k]}`).join(', ') : 'les quatorze paramètres coïncident'
);

console.log('\nF. Variation de l’effet actif\n');

// `varyEffect` rend `null` là où la variation est GÉOMÉTRIQUE : c'est
// `nextVariation` qui la porte, et deux moteurs pour un même geste finissent
// toujours par diverger.
const formesRendentNull = Object.entries(EFFECTS)
  .filter(([, e]) => e.category === 'form' || e.category === 'reference')
  .every(([cle]) => varyEffect(applyEffect(neuf, cle)) === null);
check('F1 — une forme ou une référence ne varie pas hors de sa géométrie', formesRendentNull);

const surMatiere = applyEffect(neuf, 'terracotta');
const matiereVariee = varyEffect(surMatiere);
check(
  'F2 — varier une matière ne touche QUE la matière',
  matiereVariee !== null
    && matiereVariee.geometry === surMatiere.geometry
    && matiereVariee.lighting === surMatiere.lighting
    && matiereVariee.presentation === surMatiere.presentation
    && matiereVariee.material.color !== surMatiere.material.color,
  matiereVariee ? `${surMatiere.material.color} → ${matiereVariee.material.color}` : 'aucune variation rendue'
);

const surLumiere = applyEffect(neuf, 'grazing-light');
const lumiereVariee = varyEffect(surLumiere);
check(
  'F3 — varier un éclairage ne touche QUE l’éclairage',
  lumiereVariee !== null
    && lumiereVariee.geometry === surLumiere.geometry
    && lumiereVariee.material === surLumiere.material
    && lumiereVariee.lighting.angle !== surLumiere.lighting.angle,
  lumiereVariee ? `angle ${surLumiere.lighting.angle}° → ${lumiereVariee.lighting.angle}°` : 'aucune variation rendue'
);

// Déterminisme, même exigence que pour la variation géométrique.
const a1 = varyEffect(surLumiere);
const a2 = varyEffect(surLumiere);
check('F4 — la variation d’effet est déterministe', JSON.stringify(a1.lighting) === JSON.stringify(a2.lighting));

// Et elle AVANCE : deux clics successifs ne rendent pas deux fois la même chose.
const b1 = varyEffect(surLumiere);
const b2 = varyEffect(b1);
check(
  'F5 — deux variations successives diffèrent',
  JSON.stringify(b1.lighting) !== JSON.stringify(b2.lighting),
  `graines ${b1.ui.effectVariationSeed} puis ${b2.ui.effectVariationSeed}`
);

// Les bornes des curseurs sont tenues, même après une longue suite.
let chaine = surLumiere;
let horsBornes = null;
for (let i = 0; i < 200 && !horsBornes; i++) {
  chaine = varyEffect(chaine);
  const l = chaine.lighting;
  if (!(l.angle >= 0 && l.angle < 360)) horsBornes = `angle ${l.angle}`;
  else if (!(l.height >= 15 && l.height <= 80)) horsBornes = `hauteur ${l.height}`;
  else if (!(l.contrast >= 0.2 && l.contrast <= 1)) horsBornes = `contraste ${l.contrast}`;
  else if (!(l.backlight >= 0 && l.backlight <= 1)) horsBornes = `halo ${l.backlight}`;
}
check('F6 — deux cents variations d’éclairage restent dans les bornes des curseurs', horsBornes === null, horsBornes || '200 itérations');

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées\n`);
if (passed !== results.length) process.exit(1);
