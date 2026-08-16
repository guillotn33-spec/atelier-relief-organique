// Lot 9 — contrat de la boutique d'effets et signatures des prototypes.

import { EFFECTS, applyEffect } from '../src/core/effects.js';
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

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées\n`);
if (passed !== results.length) process.exit(1);
