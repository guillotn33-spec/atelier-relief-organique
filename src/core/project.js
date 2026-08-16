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
    family: 'organic',
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

/**
 * BORNES ADMISSIBLES — à ne pas confondre avec `GEOMETRY_BOUNDS`.
 *
 * `GEOMETRY_BOUNDS` est la plage que la VARIATION explore d'elle-même ; celle-ci
 * est la plage qu'une valeur a le droit d'occuper, quelle qu'en soit l'origine.
 * Les deux diffèrent largement : le curseur de densité va de 5 à 95 % quand la
 * variation n'explore que 18 à 72 %.
 *
 * La distinction n'est pas théorique. Valider un enregistrement contre
 * `GEOMETRY_BOUNDS` ramènerait une densité réglée à la main à 90 % vers 72 % à
 * la simple réouverture du projet — la validation effacerait le travail qu'elle
 * est censée protéger. Et `defaultGeometry().channelRatio` vaut 0,52, hors de
 * son propre intervalle de variation [0,55 ; 0,90] : la géométrie par défaut
 * elle-même aurait été « corrigée ».
 *
 * Ces bornes-ci sont donc celles des curseurs de l'interface, et pour les deux
 * paramètres sans curseur (`channelRatio`, `fuse`) l'étendue où le moteur reste
 * défini.
 */
export const GEOMETRY_LIMITS = {
  basinScaleCm: [8, 160],
  channelRatio: [0.3, 1],
  channelWeight: [0, 1],
  density: [0.05, 0.95],
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

/**
 * Assainit une géométrie relue d'un enregistrement.
 *
 * LES DIMENSIONS ÉTAIENT VALIDÉES, PAS LA GÉOMÉTRIE. `validateDimension` rejette
 * NaN, le vide et le hors-bornes depuis le lot 1 ; les quatorze paramètres du
 * relief, eux, étaient recopiés tels quels depuis la base. Or un seul NaN suffit
 * à tout éteindre : `Math.max(2, NaN)` vaut NaN — la garde de `makeFieldContext`
 * ne protège de rien — donc `invBasin` est NaN, donc la heightmap entière est
 * NaN, et l'atelier s'ouvre sur une toile vide, sans exception ni message.
 *
 * Chaque champ numérique hors bornes est ramené dans l'intervalle canonique ;
 * chaque champ absent, non fini ou du mauvais type reprend sa valeur par défaut.
 * Les champs libres — graine, décalages de domaine — sont seulement contrôlés en
 * finitude : ils n'ont pas de plage.
 */
export function validateGeometry(raw) {
  const base = defaultGeometry();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };

  for (const [cle, [lo, hi]] of Object.entries(GEOMETRY_LIMITS)) {
    const valeur = Number(raw[cle]);
    if (Number.isFinite(valeur)) out[cle] = Math.max(lo, Math.min(hi, valeur));
  }
  for (const cle of ['seed', 'variationSeed']) {
    const valeur = Number(raw[cle]);
    if (Number.isFinite(valeur)) out[cle] = valeur | 0;
  }
  for (const cle of ['domainOffsetXCm', 'domainOffsetYCm']) {
    const valeur = Number(raw[cle]);
    if (Number.isFinite(valeur)) out[cle] = valeur;
  }
  if (typeof raw.engine === 'string') out.engine = raw.engine;
  if (typeof raw.family === 'string') out.family = raw.family;
  out.negative = !!raw.negative;
  return out;
}

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
    // Brosse directionnelle (§6). `brushElongation` va de 0 — un disque — à 1,
    // soit une ellipse de 5 pour 1 ; `brushAngle` est en degrés dans [0, 180[,
    // une ellipse étant identique à elle-même après un demi-tour.
    brushElongation: 0,
    brushAngle: 0,
    // Quand il est vrai, l'orientation est reprise du GESTE et `brushAngle` est
    // ignoré : la brosse se couche dans le sens du trait.
    brushFollowStroke: false,
    // Symétrie de sculpture : 'none', 'x' (gauche/droite), 'y' (haut/bas) ou
    // 'xy'. Elle ne concerne QUE les gestes ; le relief généré, lui, n'est pas
    // miroité — sans quoi choisir une symétrie changerait la composition.
    symmetry: 'none',
    // UN DOCUMENT NEUF NE PORTE AUCUN PRÉRÉGLAGE.
    //
    // Il déclarait `presetKey: 'dunes'` et `activeEffectKey: 'fluid-dunes'`
    // alors que `defaultGeometry()` n'est ni l'un ni l'autre — famille
    // `organic` à 52 cm, quand « Dunes » est à 38 cm et « Dunes fluides » de la
    // famille `dunes` à 43 cm. Trois désignations pour un seul relief : la
    // vignette allumée, le nom d'effet affiché et l'image rendue se
    // contredisaient dès l'ouverture.
    //
    // La géométrie par défaut EST « Relief organique » — l'article du catalogue
    // ne déclare plus que sa famille et hérite du reste, si bien que les deux
    // ne peuvent plus diverger. Aucune vignette de RÉFÉRENCE n'est allumée,
    // puisqu'aucune des trois n'est chargée.
    presetKey: null,
    designName: 'Relief organique',
    activeEffectKey: 'organic-relief',
    activeEffectName: 'Relief organique',
    // Suite de variation propre aux effets de matière et d'éclairage. Elle est
    // distincte de `geometry.variationSeed` : varier une lumière ne doit pas
    // avancer la suite qui explore les compositions.
    effectVariationSeed: 0,

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
 * Taille admissible sous verrou de rapport.
 *
 * POURQUOI CETTE FONCTION EXISTE. Les bornes du rectangle ne sont pas
 * symétriques — 500 cm de large pour 200 cm de haut. Le redimensionnement
 * plafonnait CHAQUE dimension séparément : un panneau 160 × 100 verrouillé à
 * 1,6 et tiré en largeur sortait en 500 × 200, soit un rapport de 2,5. Le
 * verrou se rompait en silence, exactement quand l'utilisateur s'appuyait
 * dessus. Mesuré aussi sur 160 × 100 réduit à 1 cm (rapport 1,0) et sur
 * 100 × 180 tiré à 400 (rapport 2,0).
 *
 * La correction ne plafonne plus les deux côtés : elle plafonne la LARGEUR dans
 * l'intervalle où la hauteur induite reste elle aussi dans ses bornes. Le
 * rapport est alors conservé par construction, au seul arrondi au centimètre
 * près.
 *
 * @param {string} shape        forme de toile
 * @param {number} ratio        largeur / hauteur à préserver
 * @param {number} widthCm      largeur souhaitée, avant bornage
 * @returns {{widthCm:number, heightCm:number, clamped:boolean}}
 */
const RATIO_TOLERANCE = 0.02;

export function fitLockedSize(shape, ratio, widthCm) {
  const bounds = BOUNDS[shape] || BOUNDS.rectangle;
  const heightBound = bounds.heightCm || bounds.widthCm;
  if (!(ratio > 0) || !Number.isFinite(ratio)) {
    const w = clampTo(widthCm, bounds.widthCm);
    return { widthCm: Math.round(w), heightCm: Math.round(w), clamped: true };
  }

  // Intervalle de largeur dans lequel la HAUTEUR induite reste légale.
  const minWidth = Math.max(bounds.widthCm.min, heightBound.min * ratio);
  const maxWidth = Math.min(bounds.widthCm.max, heightBound.max * ratio);
  // Un rapport peut rendre l'intervalle vide si les bornes se croisent ; on
  // retombe alors sur la plus petite largeur légale plutôt que d'inventer.
  const w = maxWidth < minWidth ? bounds.widthCm.min : Math.min(maxWidth, Math.max(minWidth, widthCm));

  // Un rapport n'est pas toujours REPRÉSENTABLE en centimètres entiers. À 1 cm
  // de large, 1,6 donnerait 2 × 1, soit 2,0 — 25 % d'écart. À l'autre extrême,
  // un rapport de 143 plafonné à 500 cm donnerait 500 × 3, soit 167. Un verrou
  // doit refuser une taille qu'il ne peut pas tenir, pas la déformer en
  // silence.
  //
  // L'intervalle légal des largeurs compte au plus quelques centaines
  // d'entiers : on les PARCOURT tous plutôt que de chercher à tâtons autour de
  // la valeur visée. Une recherche par pas croissants, dans un sens ou dans les
  // deux, manquait selon les cas le haut ou le bas de l'intervalle. Le balayage
  // complet est à la fois plus simple et optimal par construction, pour un coût
  // sans commune mesure avec le rendu qui suit.
  const vise = Math.max(bounds.widthCm.min, Math.round(w));
  const bas = Math.max(bounds.widthCm.min, Math.ceil(minWidth));
  const haut = Math.max(bas, Math.floor(maxWidth));

  let dansTolerance = null;
  let moindreEcart = null;
  for (let candidat = bas; candidat <= haut; candidat++) {
    const hauteur = Math.round(candidat / ratio);
    if (hauteur < heightBound.min || hauteur > heightBound.max) continue;
    const ecart = Math.abs(candidat / hauteur - ratio) / ratio;
    const distance = Math.abs(candidat - vise);

    if (ecart <= RATIO_TOLERANCE && (!dansTolerance || distance < dansTolerance.distance)) {
      dansTolerance = { widthCm: candidat, heightCm: hauteur, distance };
    }
    // Filet de sécurité : si aucune paire ne tient la tolérance, on rend la
    // moins fausse, jamais un résultat arbitraire.
    if (!moindreEcart || ecart < moindreEcart.ecart - 1e-12 || (Math.abs(ecart - moindreEcart.ecart) < 1e-12 && distance < moindreEcart.distance)) {
      moindreEcart = { widthCm: candidat, heightCm: hauteur, ecart, distance };
    }
  }

  const trouve = dansTolerance || moindreEcart || {
    widthCm: Math.max(bounds.widthCm.min, Math.min(bounds.widthCm.max, vise)),
    heightCm: heightBound.min,
  };

  return { ...trouve, clamped: trouve.widthCm !== Math.round(widthCm) };
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
    effectKey: 'dunes-reference',
    geometry: {
      family: 'organic', seed: 2749, domainOffsetXCm: 0, domainOffsetYCm: 0, variationSeed: 0,
      basinScaleCm: 38, channelRatio: 0.58, channelWeight: 0.30, density: 0.50,
      elongation: 0.82, orientationDeg: 8, warpAmount: 0.68, irregularity: 0.18,
      depth: 0.62, softness: 0.46, wave: 0.56, shoulder: 0.58, fuse: 0.72,
    },
    material: { color: '#e7e5e5', texture: 0.30, finish: 'mat' },
    // LUMIÈRE RASANTE — c'est ce réglage, et non l'exposition, qui donne aux
    // photos leur étendue tonale. Longtemps l'écart s'est joué sur l'exposition
    // et le contraste : baisser l'exposition ramenait bien la médiane, mais
    // éteignait aussi les plateaux, et l'étendue plafonnait à 123 contre 169
    // mesurés sur ref-1. Une lumière basse creuse les cavités SANS toucher aux
    // sommets, qui restent face à la source : à 20° d'élévation, p95 219 pour
    // 221 visés. La hauteur de lumière est le levier de l'étendue ; l'exposition
    // ne fait que translater l'ensemble.
    lighting: { angle: 232, height: 20, contrast: 0.86, backlight: 0.55, exposureEv: 0.05, shadowStrength: 0.60, cavityOcclusion: 0.60 },
    presentation: { panelLayout: '2x2', frame: false, wallColor: '#8e8883' },
  },
  cellules: {
    name: 'Cellules',
    effectKey: 'cellules-reference',
    geometry: {
      family: 'cells', seed: 8315, domainOffsetXCm: 0, domainOffsetYCm: 0, variationSeed: 0,
      basinScaleCm: 22, channelRatio: 0.60, channelWeight: 0.08, density: 0.76,
      elongation: 0.04, orientationDeg: 0, warpAmount: 0.42, irregularity: 0.38,
      depth: 0.64, softness: 0.24, wave: 0.18, shoulder: 0.36, fuse: 0.30,
    },
    material: { color: '#e7e4e3', texture: 0.32, finish: 'mat' },
    // Ref-2 est plus haute en clé que ref-1 : ses ombres ne descendent qu'à 66
    // et un cinquième de l'image seulement est sombre. Cellules garde donc la
    // lumière basse, qui tient les plateaux à 221, mais avec des ombres portées
    // faibles — la densité de cavités, montée à 0,76, suffit à faire descendre
    // la médiane sans creuser de noirs que la photo n'a pas.
    lighting: { angle: 224, height: 22, contrast: 0.90, backlight: 0.56, exposureEv: 0.05, shadowStrength: 0.10, cavityOcclusion: 0.45 },
    presentation: { panelLayout: '2x2', frame: false, wallColor: '#978f88' },
  },
  archipel: {
    name: 'Archipel',
    effectKey: 'archipel-reference',
    geometry: {
      family: 'archipelago', seed: 5172, domainOffsetXCm: 0, domainOffsetYCm: 0, variationSeed: 0,
      basinScaleCm: 12, channelRatio: 0.62, channelWeight: 0.48, density: 0.49,
      elongation: 0.34, orientationDeg: 14, warpAmount: 0.70, irregularity: 0.46,
      depth: 0.70, softness: 0.40, wave: 0.48, shoulder: 0.52, fuse: 0.58,
    },
    material: { color: '#e3e1e2', texture: 0.24, finish: 'mat' },
    // Ref-3 est la plus claire des trois : p5 à 67, 14 % de sombre seulement.
    // C'est un panneau ouvert, éclairé sans dramatisation. Ombres et occlusion
    // restent donc au plus bas ; la lumière rasante et le contraste font tout.
    lighting: { angle: 228, height: 22, contrast: 0.70, backlight: 0.48, exposureEv: 0.05, shadowStrength: 0.10, cavityOcclusion: 0.15 },
    presentation: { panelLayout: 'none', frame: true, wallColor: '#a8a39e' },
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
    ui: {
      ...project.ui,
      presetKey: key,
      designName: preset.name,
      // Le prototype et l'effet qu'il déclare sont désormais la MÊME chose : la
      // signature de référence porte le nom du préréglage et sa géométrie. La
      // table de correspondance qui traduisait ici trois clés en trois libellés
      // pouvait mentir, et mentait — Archipel s'annonçait « Relief organique ».
      activeEffectKey: preset.effectKey,
      activeEffectName: preset.name,
    },
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
