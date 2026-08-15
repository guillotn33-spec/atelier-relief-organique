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

export function defaultGeometry() {
  return {
    engine: 'legacy-v1',
    seed: 2749,
    count: 9,
    scale: 1.4,
    elongation: 0.65,
    flow: 0.7,
    irregularity: 0.35,
    depth: 0.92,
    softness: 0.62,
    wave: 0.6,
    negative: false,
  };
}

export function defaultMaterial() {
  return { color: '#e8e4dc', texture: 0.3, finish: 'mat' };
}

export function defaultLighting() {
  return { angle: 245, height: 42, contrast: 0.8, backlight: 0.58 };
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

export const PRESETS = {
  dunes: {
    name: 'Dunes',
    geometry: { seed: 2749, count: 9, scale: 1.4, elongation: 0.65, flow: 0.7, irregularity: 0.35, depth: 0.92, softness: 0.62, wave: 0.6 },
    material: { color: '#e8e4dc', texture: 0.3 },
    lighting: { angle: 245, height: 42, contrast: 0.8, backlight: 0.58 },
    presentation: { panelLayout: 'none', frame: true, wallColor: '#d8d3c9' },
  },
  cellules: {
    name: 'Cellules',
    geometry: { seed: 8315, count: 17, scale: 1.0, elongation: 0.26, flow: 0.48, irregularity: 0.43, depth: 0.7, softness: 0.68, wave: 0.35 },
    material: { color: '#d8d2c7', texture: 0.34 },
    lighting: { angle: 218, height: 42, contrast: 0.78, backlight: 0.68 },
    presentation: { panelLayout: '2x2', frame: false, wallColor: '#c9c4ba' },
  },
  archipel: {
    name: 'Archipel',
    geometry: { seed: 5172, count: 12, scale: 1.0, elongation: 0.52, flow: 0.79, irregularity: 0.72, depth: 0.84, softness: 0.76, wave: 0.68 },
    material: { color: '#e4dfd6', texture: 0.18 },
    lighting: { angle: 232, height: 38, contrast: 0.83, backlight: 0.48 },
    presentation: { panelLayout: '2x2', frame: false, wallColor: '#d5d0c6' },
  },
};

export function applyPreset(project, key) {
  const preset = PRESETS[key];
  if (!preset) return project;
  return {
    ...project,
    geometry: { ...project.geometry, ...preset.geometry },
    material: { ...project.material, ...preset.material },
    lighting: { ...project.lighting, ...preset.lighting },
    presentation: { ...project.presentation, ...preset.presentation },
    ui: { ...project.ui, presetKey: key, designName: preset.name },
    updatedAt: Date.now(),
  };
}
