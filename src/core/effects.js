// Bibliothèque locale d’effets du lot 9.
//
// Un effet est un correctif typé du projet. Les formes reconstruisent la
// heightmap ; matières et éclairages ne demandent qu’un nouvel ombrage. Aucun
// effet ne possède de moteur parallèle ni d’état caché.

import { PRESETS, defaultGeometry } from './project.js';

// CE QUI APPARTIENT AU DOCUMENT, ET NON À L'EFFET.
//
// La graine, le décalage de domaine et le sens du relief sont l'identité de
// l'exemplaire : deux personnes qui choisissent « Alvéoles » doivent obtenir la
// même ÉCRITURE, pas le même panneau. Tout le reste appartient à l'effet.
const CHAMPS_DU_DOCUMENT = ['seed', 'domainOffsetXCm', 'domainOffsetYCm', 'variationSeed', 'negative'];

/**
 * Les trois signatures de référence, calibrées sur les photos `ref-1/2/3.jpg`.
 *
 * Elles NE SONT PAS RECOPIÉES ici : elles sont lues dans `PRESETS`, qui reste
 * l'unique source. Avant ce lot, la vignette « Dunes » déclarait l'effet « Dunes
 * fluides » — lequel, une fois cliqué, produisait un tout autre relief (famille
 * `dunes` au lieu d'`organic`, bassins de 43 cm au lieu de 38). Archipel
 * déclarait « Relief organique », c'est-à-dire une composition sans aucun
 * rapport avec elle. Le catalogue promettait ce qu'il ne rendait pas.
 *
 * Une référence porte la composition ENTIÈRE — forme, matière, lumière et
 * présentation — parce que la ressemblance mesurée à la photo est celle de
 * l'ensemble, pas de la seule géométrie. C'est aussi pourquoi elle a sa propre
 * catégorie : « forme » veut dire « ne touche QUE la géométrie », et ce contrat
 * vaut mieux que d'être élargi pour trois cas particuliers.
 */
function reference(cle, description) {
  const p = PRESETS[cle];
  return {
    name: p.name,
    category: 'reference',
    scope: 'geometry',
    presetKey: cle,
    description,
    geometry: { ...p.geometry },
    material: { ...p.material },
    lighting: { ...p.lighting },
    presentation: { ...p.presentation },
  };
}

export const EFFECTS = {
  // ---- Signatures de référence --------------------------------------------
  'dunes-reference': reference('dunes', 'Strates fluides, calibrées sur la première photo de référence.'),
  'cellules-reference': reference('cellules', 'Cavités alvéolaires, calibrées sur la deuxième photo de référence.'),
  'archipel-reference': reference('archipel', 'Masses ouvertes, calibrées sur la troisième photo de référence.'),

  // ---- Formes organiques --------------------------------------------------
  'organic-relief': {
    name: 'Relief organique', category: 'form', scope: 'geometry', description: 'Masses souples et cavités fusionnées.',
    geometry: { family: 'organic', basinScaleCm: 52, channelRatio: 0.58, channelWeight: 0.55, density: 0.48, elongation: 0.42, orientationDeg: 22, warpAmount: 0.62, irregularity: 0.35, depth: 0.92, softness: 0.55, wave: 0.50, shoulder: 0.50, fuse: 0.55 },
  },
  'directional-cavities': {
    name: 'Cavités directionnelles', category: 'form', scope: 'geometry', description: 'Creux allongés dans une direction dominante.',
    geometry: { family: 'organic', basinScaleCm: 42, channelRatio: 0.62, channelWeight: 0.32, density: 0.56, elongation: 0.82, orientationDeg: 18, warpAmount: 0.46, irregularity: 0.24, depth: 0.90, softness: 0.48, wave: 0.28, shoulder: 0.62, fuse: 0.42 },
  },
  'soft-waves': {
    name: 'Vagues douces', category: 'form', scope: 'geometry', description: 'Ondes larges au relief peu profond.',
    geometry: { family: 'dunes', basinScaleCm: 68, channelWeight: 0.20, density: 0.40, elongation: 0.74, orientationDeg: 5, warpAmount: 0.46, irregularity: 0.12, depth: 0.63, softness: 0.76, wave: 0.72, shoulder: 0.68, fuse: 0.72 },
  },
  'fluid-dunes': {
    name: 'Dunes fluides', category: 'form', scope: 'geometry', description: 'Strates continues et mouvement horizontal.',
    geometry: { family: 'dunes', basinScaleCm: 43, channelWeight: 0.30, density: 0.50, elongation: 0.82, orientationDeg: 8, warpAmount: 0.68, irregularity: 0.18, depth: 0.62, softness: 0.46, wave: 0.56, shoulder: 0.58, fuse: 0.72 },
  },
  'progressive-erosion': {
    name: 'Érosion progressive', category: 'form', scope: 'geometry', description: 'Bords minéraux, irréguliers et profonds.',
    geometry: { family: 'organic', basinScaleCm: 40, channelRatio: 0.58, channelWeight: 0.67, density: 0.52, elongation: 0.38, orientationDeg: 32, warpAmount: 0.58, irregularity: 0.74, depth: 0.96, softness: 0.34, wave: 0.38, shoulder: 0.36, fuse: 0.55 },
  },
  'organic-strata': {
    name: 'Strates organiques', category: 'form', scope: 'geometry', description: 'Couches rapprochées et topographiques.',
    geometry: { family: 'dunes', basinScaleCm: 36, channelWeight: 0.38, density: 0.68, elongation: 0.92, orientationDeg: 16, warpAmount: 0.52, irregularity: 0.28, depth: 0.78, softness: 0.43, wave: 0.44, shoulder: 0.45, fuse: 0.65 },
  },
  alveoli: {
    name: 'Alvéoles', category: 'form', scope: 'geometry', description: 'Réseau de cellules rondes et rapprochées.',
    geometry: { family: 'cells', basinScaleCm: 31, channelWeight: 0.08, density: 0.61, elongation: 0.04, orientationDeg: 0, warpAmount: 0.42, irregularity: 0.38, depth: 0.64, softness: 0.24, wave: 0.18, shoulder: 0.36, fuse: 0.30 },
  },
  membrane: {
    name: 'Membrane', category: 'form', scope: 'geometry', description: 'Surface souple, tendue entre de larges creux.',
    geometry: { family: 'cells', basinScaleCm: 54, channelWeight: 0.05, density: 0.42, elongation: 0.18, orientationDeg: 4, warpAmount: 0.38, irregularity: 0.10, depth: 0.67, softness: 0.82, wave: 0.30, shoulder: 0.78, fuse: 0.48 },
  },

  // ---- Matières -----------------------------------------------------------
  limestone: { name: 'Pierre calcaire', category: 'material', scope: 'shading', description: 'Pierre claire au grain fin.', material: { color: '#e5ddcf', texture: 0.30, finish: 'mat' } },
  'mineral-plaster': { name: 'Enduit minéral', category: 'material', scope: 'shading', description: 'Enduit blanc légèrement granuleux.', material: { color: '#e9e7df', texture: 0.46, finish: 'mat' } },
  porcelain: { name: 'Porcelaine', category: 'material', scope: 'shading', description: 'Surface blanche douce et satinée.', material: { color: '#f0f1ee', texture: 0.07, finish: 'satine' } },
  sandstone: { name: 'Grès sable', category: 'material', scope: 'shading', description: 'Teinte sable et grain présent.', material: { color: '#d2b990', texture: 0.54, finish: 'mat' } },
  terracotta: { name: 'Terre cuite', category: 'material', scope: 'shading', description: 'Argile chaude et mate.', material: { color: '#b96f50', texture: 0.42, finish: 'mat' } },
  graphite: { name: 'Graphite', category: 'material', scope: 'shading', description: 'Matière sombre, dense et satinée.', material: { color: '#555954', texture: 0.26, finish: 'satine' } },
  'brushed-metal': { name: 'Métal brossé', category: 'material', scope: 'shading', description: 'Reflets francs et surface froide.', material: { color: '#d5d7d3', texture: 0.18, finish: 'chrome' } },

  // ---- Éclairage ----------------------------------------------------------
  'warm-studio': { name: 'Studio chaud', category: 'lighting', scope: 'shading', description: 'Lumière chaude équilibrée.', lighting: { angle: 232, height: 40, contrast: 0.80, backlight: 0.55, exposureEv: 0.05, shadowStrength: 0.58, cavityOcclusion: 0.52 } },
  'grazing-light': { name: 'Lumière rasante', category: 'lighting', scope: 'shading', description: 'Révèle fortement les bords du relief.', lighting: { angle: 205, height: 19, contrast: 0.88, backlight: 0.32, exposureEv: -0.08, shadowStrength: 0.74, cavityOcclusion: 0.66 } },
  'soft-diffuse': { name: 'Diffuse douce', category: 'lighting', scope: 'shading', description: 'Ombres ouvertes et transitions calmes.', lighting: { angle: 245, height: 61, contrast: 0.56, backlight: 0.45, exposureEv: 0.12, shadowStrength: 0.32, cavityOcclusion: 0.34 } },
  'gallery-white': { name: 'Galerie blanche', category: 'lighting', scope: 'shading', description: 'Présentation neutre et lumineuse.', lighting: { angle: 260, height: 52, contrast: 0.67, backlight: 0.40, exposureEv: 0.20, shadowStrength: 0.40, cavityOcclusion: 0.42 }, presentation: { wallColor: '#d7d5cf' } },
  'deep-relief': { name: 'Relief dramatique', category: 'lighting', scope: 'shading', description: 'Noirs profonds et lumière latérale.', lighting: { angle: 218, height: 26, contrast: 0.96, backlight: 0.24, exposureEv: -0.16, shadowStrength: 0.88, cavityOcclusion: 0.86 } },
  'backlit-halo': { name: 'Halo arrière', category: 'lighting', scope: 'shading', description: 'Panneau détaché du mur par la lumière.', lighting: { angle: 242, height: 46, contrast: 0.74, backlight: 0.92, exposureEv: 0.04, shadowStrength: 0.48, cavityOcclusion: 0.48 } },
};

/**
 * UN EFFET DE FORME REPART DES VALEURS PAR DÉFAUT, IL NE SE SUPERPOSE PAS.
 *
 * Auparavant le correctif se fondait dans la géométrie courante. Comme quatre
 * des huit formes ne mentionnaient pas `channelRatio`, « Vagues douces » lancé
 * depuis Dunes puis depuis Archipel donnait deux reliefs différents — mesuré :
 * `channelRatio` valait 0,58 dans un cas et 0,62 dans l'autre. Un article de
 * catalogue dont le résultat dépend de ce qu'on regardait avant n'est pas un
 * article de catalogue.
 *
 * Le socle est donc `defaultGeometry()`, sur lequel l'effet écrit tout ce qu'il
 * déclare ; seuls les champs du document sont repris tels quels. Toute forme
 * future hérite de la garantie sans avoir à énumérer quoi que ce soit.
 */
function geometrieDeLEffet(project, effect) {
  if (!effect.geometry) return project.geometry;
  const geometry = { ...defaultGeometry(), ...effect.geometry };
  // Une RÉFÉRENCE emporte sa graine avec elle. C'est la seule catégorie où la
  // graine appartient à l'effet et non au document : la ressemblance aux photos
  // a été mesurée sur CETTE disposition-là, et la relancer avec une autre graine
  // donnerait la même écriture mais pas le panneau calibré. Seul `negative`, qui
  // est un mode d'affichage, reste au document — comme dans `applyPreset`.
  const garder = effect.category === 'reference' ? ['negative'] : CHAMPS_DU_DOCUMENT;
  for (const champ of garder) geometry[champ] = project.geometry[champ];
  return geometry;
}

export function applyEffect(project, key) {
  const effect = EFFECTS[key];
  if (!effect) return project;
  const geometry = geometrieDeLEffet(project, effect);
  return {
    ...project,
    geometry,
    material: effect.material ? { ...project.material, ...effect.material } : project.material,
    lighting: effect.lighting ? { ...project.lighting, ...effect.lighting } : project.lighting,
    presentation: effect.presentation ? { ...project.presentation, ...effect.presentation } : project.presentation,
    ui: {
      ...project.ui,
      activeEffectKey: key,
      activeEffectName: effect.name,
      // Une forme quitte le prototype — le relief n'est plus celui d'aucun des
      // trois. Une RÉFÉRENCE, elle, EST le prototype : elle le réaffirme, ce qui
      // rallume la vignette correspondante.
      presetKey: effect.category === 'form' ? null : (effect.presetKey ?? project.ui.presetKey),
      designName: effect.category === 'form' || effect.category === 'reference' ? effect.name : project.ui.designName,
    },
    updatedAt: Date.now(),
  };
}
