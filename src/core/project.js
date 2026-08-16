// Modèle de projet — état central unique (§1).
//
// Deux notions de « profondeur » coexistent et ne doivent jamais être confondues :
//   • project.depthCm       → épaisseur PHYSIQUE du panneau, en centimètres.
//   • project.geometry.depth→ amplitude du relief dans le champ, normalisée 0..1.
// La conversion de l'une vers l'autre est faite au seul endroit qui en a besoin :
// la construction du mesh 3D et les exports (lots 5 et 6). Le rendu 2D travaille
// exclusivement en unités de champ.
//
// Toutes les valeurs de pourcentage sont stockées NORMALISÉES (0..1). L'interface
// les multiplie par 100 pour l'affichage. Les angles sont en degrés.

export const SHAPES = ['rectangle', 'square', 'circle'];

export const BOUNDS = {
  rectangle: {
    widthCm: { min: 1, max: 500, label: 'Largeur' },
    heightCm: { min: 1, max: 200, label: 'Hauteur' },
    depthCm: { min: 0.1, max: 30, label: 'Profondeur' },
  },
  square: {
    widthCm: { min: 1, max: 200, label: 'Côté' },
    depthCm: { min: 0.1, max: 30, label: 'Profondeur' },
  },
  circle: {
    widthCm: { min: 1, max: 200, label: 'Diamètre' },
    depthCm: { min: 0.1, max: 30, label: 'Profondeur' },
  },
};

export const DEFAULT_DIMENSIONS = {
  rectangle: { widthCm: 160, heightCm: 100, depthCm: 6 },
  square: { widthCm: 120, heightCm: 120, depthCm: 6 },
  circle: { widthCm: 110, heightCm: 110, depthCm: 6 },
};

/**
 * Valide une dimension isolée. Retourne { ok, value, error }.
 * La validation est stricte : ni NaN, ni vide, ni hors bornes, ni virgule seule.
 */
export function validateDimension(shape, field, raw) {
  const bound = BOUNDS[shape]?.[field];
  if (!bound) return { ok: false, value: null, error: 'Champ inconnu' };

  const text = String(raw ?? '').trim().replace(',', '.');
  if (text === '') return { ok: false, value: null, error: 'Valeur requise' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, value: null, error: 'Nombre invalide' };

  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, value: null, error: 'Nombre invalide' };
  if (value < bound.min) return { ok: false, value: null, error: `Minimum ${bound.min} cm` };
  if (value > bound.max) return { ok: false, value: null, error: `Maximum ${bound.max} cm` };

  // Un dixième de millimètre suffit largement pour un panneau mural.
  return { ok: true, value: Math.round(value * 100) / 100, error: null };
}

/** Valide un jeu complet de dimensions. Retourne { ok, dimensions, errors }. */
export function validateDimensions(shape, input) {
  const errors = {};
  const dimensions = {};

  const fields = shape === 'rectangle' ? ['widthCm', 'heightCm', 'depthCm'] : ['widthCm', 'depthCm'];
  for (const field of fields) {
    const result = validateDimension(shape, field, input[field]);
    if (result.ok) dimensions[field] = result.value;
    else errors[field] = result.error;
  }

  // Carré et rond : le ratio 1:1 n'est pas une préférence, c'est la définition.
  if (shape !== 'rectangle' && dimensions.widthCm != null) dimensions.heightCm = dimensions.widthCm;

  return { ok: Object.keys(errors).length === 0, dimensions, errors };
}

// Paramètres du moteur `organic-v2`. Les longueurs sont en CENTIMÈTRES, tout le
// reste est normalisé 0..1 (sauf l'orientation, en degrés).
//
// Deux paramètres du moteur v1 ont disparu et ne peuvent pas revenir :
// « Nombre de cavités » et « Taille des formes ». Un champ continu ancré en cm
// n'a pas de nombre de cavités — ce nombre dépend de la fenêtre par laquelle on
// le regarde. Ils sont remplacés par « Taille des cavités », en centimètres, qui
// est une propriété de l'œuvre et non de son cadrage.
export function defaultGeometry() {
  return {
    engine: 'organic-v2',
    seed: 2749,
    variationSeed: 0,
    domainOffsetXCm: 0,
    domainOffsetYCm: 0,

    basinScaleCm: 52,
    channelRatio: 0.52,
    channelWeight: 0.55,
    density: 0.48,
    elongation: 0.55,
    orientationDeg: 22,
    warpAmount: 0.62,
    irregularity: 0.35,
    depth: 0.92,
    softness: 0.55,
    wave: 0.5,
    shoulder: 0.5,
    fuse: 0.55,

    negative: false,
  };
}

export const GEOMETRY_BOUNDS = {
  basinScaleCm: [8, 160],
  // Plancher à 0,55 : des chenaux beaucoup plus fins que les bassins ne RELIENT
  // pas les bols, ils ondulent dedans. La borne reste justifiée pour cette
  // raison, qui est visible à l'œil.
  //
  // ⚠ CORRECTION DU LOT 4. Le lot 2 justifiait ce plancher par une proéminence
  // d'îlot tombant à 2,8 %. Cette mesure ne valait que pour le panneau de
  // 160 × 100 cm sur lequel elle avait été prise. Mesuré depuis sur trois
  // formats, à 48 variations chacun :
  //
  //     160 × 100 :  6 îlots, max  2,26 %, médiane 0,66 %
  //     200 × 120 : 20 îlots, max  7,52 %, médiane 2,77 %
  //     300 × 180 : 74 îlots, max 16,72 %, médiane 4,88 %
  //
  // Et relever le plancher n'y change rien : à 0,62 le maximum MONTE (9,9 % à
  // 200 × 120). Le facteur n'est pas le rapport des échelles mais le NOMBRE de
  // cavités dans la fenêtre — plus il y en a, plus la probabilité qu'une
  // contienne un minimum local du bruit est grande. C'est un effet de valeur
  // extrême, pas un réglage.
  //
  // Piste de correction, hors périmètre du lot 4 : dériver la bande de chenaux
  // DU champ des bassins (transformée en crête du même bruit) au lieu d'un
  // bruit indépendant. Deux champs corrélés ne peuvent plus produire de minima
  // intérieurs indépendants. C'est une modification de moteur.
  channelRatio: [0.55, 0.9],
  channelWeight: [0, 1],
  // Bornes resserrées après mesure. Sous 0,18 presque rien n'est creusé ; au-delà
  // de 0,72 la quasi-totalité de la surface l'est, le relief s'aplatit faute de
  // plateaux, et les minima locaux du bruit se mettent à ressortir en îlots.
  // Les deux extrêmes sont sans intérêt plastique et hors garantie.
  density: [0.18, 0.72],
  elongation: [0, 1],
  orientationDeg: [0, 180],
  warpAmount: [0, 1],
  irregularity: [0, 1],
  depth: [0.2, 1],
  softness: [0.05, 1],
  wave: [0, 1],
  shoulder: [0.05, 1],
  fuse: [0, 1],
};

export function defaultMaterial() {
  return { color: '#e8e4dc', texture: 0.3, finish: 'mat' };
}

export function defaultLighting() {
  return {
    angle: 245,
    height: 42,
    contrast: 0.8,
    backlight: 0.58,
    // §7 — contrôles séparés. Les valeurs par défaut restent naturelles ; ce
    // sont les extrêmes qui permettent le dramatique.
    exposureEv: 0, // −2 à +2
    shadowStrength: 0.55, // intensité des ombres
    cavityOcclusion: 0.5, // occlusion des cavités
  };
}

export function defaultPresentation() {
  return { panelLayout: 'none', frame: true, wallColor: '#d8d3c9' };
}

export function defaultCamera() {
  // Consommée au lot 5. Déclarée ici pour que le modèle soit complet dès le lot 1.
  return { azimuth: 0, elevation: 0, distance: 1, zoom: 1, panX: 0, panY: 0 };
}

export function defaultUi() {
  return {
    activeTool: 'light',
    brushSizeCm: 12,
    brushStrength: 0.55,
    brushElongation: 0,
    brushAngle: 0,
    animate: false,
    presetKey: 'dunes',
    designName: 'Dunes',

    // Verrou du rapport largeur/hauteur (§3). Le carré et le rond l'imposent
    // par définition ; ce réglage ne concerne donc que le rectangle.
    ratioLocked: false,
    // Vue : zoom et déplacement. Aucune incidence sur les dimensions physiques.
    viewport: { zoom: 1, panX: 0, panY: 0 },
    // Position mémorisée des barres (§14, §15).
    docks: {
      toolbar: { mode: 'snap', edge: 'canvas-bottom', x: 0, y: 0, collapsed: false, visible: true },
      mini: { mode: 'float', edge: 'screen-left', x: 24, y: 160, collapsed: false, visible: false },
    },
  };
}

let idCounter = 0;
function makeId() {
  idCounter += 1;
  return `p${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function createProject({ canvasShape = 'rectangle', widthCm, heightCm, depthCm, name } = {}) {
  if (!SHAPES.includes(canvasShape)) throw new Error(`Forme inconnue : ${canvasShape}`);

  const fallback = DEFAULT_DIMENSIONS[canvasShape];
  const dims = {
    widthCm: widthCm ?? fallback.widthCm,
    heightCm: canvasShape === 'rectangle' ? (heightCm ?? fallback.heightCm) : (widthCm ?? fallback.widthCm),
    depthCm: depthCm ?? fallback.depthCm,
  };

  const now = Date.now();
  return {
    version: 1,
    id: makeId(),
    name: name || 'Sans titre',
    createdAt: now,
    updatedAt: now,

    canvasShape,
    widthCm: dims.widthCm,
    heightCm: dims.heightCm,
    depthCm: dims.depthCm,

    geometry: defaultGeometry(),
    sculpt: null, // rempli par SculptLayer.serialize(), stocké à part en base
    material: defaultMaterial(),
    lighting: defaultLighting(),
    presentation: defaultPresentation(),
    camera: defaultCamera(),
    ui: defaultUi(),

    baseDesignSnapshot: null, // lot 2
    history: { undo: [], redo: [] }, // en mémoire seulement, non persisté
  };
}

/** Rapport largeur/hauteur réel du projet. Aucune constante nulle part. */
export function aspectOf(project) {
  return project.widthCm / project.heightCm;
}

export function isRatioLocked(project) {
  return project.canvasShape !== 'rectangle';
}

/**
 * Applique de nouvelles dimensions physiques en respectant les bornes et le
 * verrou de ratio de la forme. Ne touche ni à la géométrie ni à la sculpture :
 * la toile est une fenêtre, pas un cadre déformant (amendement D).
 */
export function resizeProject(project, { widthCm, heightCm }) {
  const bounds = BOUNDS[project.canvasShape];
  const next = { ...project };

  if (widthCm != null) {
    next.widthCm = clampTo(widthCm, bounds.widthCm);
  }
  if (project.canvasShape === 'rectangle') {
    if (heightCm != null) next.heightCm = clampTo(heightCm, bounds.heightCm);
  } else {
    next.heightCm = next.widthCm;
  }

  next.updatedAt = Date.now();
  return next;
}

function clampTo(value, bound) {
  return Math.max(bound.min, Math.min(bound.max, value));
}

// ---- Préréglages ----
// La séparation géométrie / lumière / présentation exigée par §4 est structurelle :
// « Nouvelle variation » ne mutera QUE le bloc geometry.

// Les trois préréglages sont recalibrés pour `organic-v2`. Ils gardent leur
// intention — Dunes coule, Cellules se resserre, Archipel se disperse — mais
// exploitent la fusion des formes, que le moteur v1 ne savait pas produire.
export const PRESETS = {
  dunes: {
    name: 'Dunes',
    geometry: {
      seed: 2749, domainOffsetXCm: 0, domainOffsetYCm: 0, variationSeed: 0,
      basinScaleCm: 44, channelRatio: 0.55, channelWeight: 0.58, density: 0.50,
      elongation: 0.38, orientationDeg: 16, warpAmount: 0.50, irregularity: 0.30,
      depth: 0.95, softness: 0.50, wave: 0.55, shoulder: 0.58, fuse: 0.60,
    },
    material: { color: '#e8e4dc', texture: 0.3 },
    lighting: { angle: 245, height: 42, contrast: 0.8, backlight: 0.58, exposureEv: 0, shadowStrength: 0.55, cavityOcclusion: 0.5 },
    presentation: { panelLayout: 'none', frame: true, wallColor: '#d8d3c9' },
  },
  cellules: {
    name: 'Cellules',
    geometry: {
      seed: 8315, domainOffsetXCm: 0, domainOffsetYCm: 0, variationSeed: 0,
      basinScaleCm: 38, channelRatio: 0.64, channelWeight: 0.20, density: 0.60,
      elongation: 0.10, orientationDeg: 0, warpAmount: 0.28, irregularity: 0.30,
      depth: 0.86, softness: 0.50, wave: 0.26, shoulder: 0.56, fuse: 0.30,
    },
    material: { color: '#d8d2c7', texture: 0.34 },
    lighting: { angle: 218, height: 42, contrast: 0.78, backlight: 0.68, exposureEv: 0, shadowStrength: 0.5, cavityOcclusion: 0.45 },
    presentation: { panelLayout: '2x2', frame: false, wallColor: '#c9c4ba' },
  },
  archipel: {
    name: 'Archipel',
    geometry: {
      seed: 5172, domainOffsetXCm: 0, domainOffsetYCm: 0, variationSeed: 0,
      basinScaleCm: 44, channelRatio: 0.58, channelWeight: 0.72, density: 0.56,
      elongation: 0.26, orientationDeg: 42, warpAmount: 0.62, irregularity: 0.48,
      depth: 0.88, softness: 0.52, wave: 0.58, shoulder: 0.50, fuse: 0.70,
    },
    material: { color: '#e4dfd6', texture: 0.18 },
    lighting: { angle: 232, height: 38, contrast: 0.83, backlight: 0.48, exposureEv: 0, shadowStrength: 0.6, cavityOcclusion: 0.55 },
    presentation: { panelLayout: '2x2', frame: false, wallColor: '#d5d0c6' },
  },
};

export function applyPreset(project, key) {
  const preset = PRESETS[key];
  if (!preset) return project;
  return {
    ...project,
    // `negative` est un MODE d'affichage du relief, pas une donnée de composition :
    // changer de préréglage ne doit pas le remettre à zéro en douce.
    geometry: { ...project.geometry, ...preset.geometry, negative: project.geometry.negative },
    material: { ...project.material, ...preset.material },
    lighting: { ...project.lighting, ...preset.lighting },
    presentation: { ...project.presentation, ...preset.presentation },
    ui: { ...project.ui, presetKey: key, designName: preset.name },
    updatedAt: Date.now(),
  };
}

// ---- Instantané de base (§4) ----
// « Définir comme base » mémorise l'état géométrique EXACT, sculpture comprise.
// « Retour base » restaure ces données, pas une approximation visuelle.

export function captureBase(project, layer) {
  return {
    geometry: { ...project.geometry },
    sculpt: layer && layer.active ? layer.serialize() : null,
    takenAt: Date.now(),
  };
}

export function baseGeometryOf(snapshot, currentGeometry) {
  // Le mode négatif reste sous la main de l'utilisateur : revenir à la base
  // restitue la composition, pas l'état du bouton Négatif.
  return { ...snapshot.geometry, negative: currentGeometry.negative };
}
