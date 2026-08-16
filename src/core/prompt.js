// Compilateur de prompt — l'état du projet traduit en langage visuel.
//
// AUCUN APPEL RÉSEAU, AUCUN MODÈLE. Traduire « profondeur = 87 % » en une
// phrase ne demande pas d'intelligence : cela demande une table. Une règle
// déterministe est gratuite, instantanée et reproductible ; demander la même
// chose à un modèle coûterait une seconde d'attente à chaque cran de curseur
// pour un résultat qui varierait d'une fois sur l'autre. Le modèle sert à
// produire l'image, pas à convertir des curseurs en phrases.
//
// TROIS SORTIES POUR UN SEUL ÉTAT :
//
//   • `json`      — ce que l'utilisateur a demandé, sous forme structurée.
//                   C'est LA référence : indépendante de tout moteur, elle
//                   survit au changement de fournisseur et se range dans le
//                   fichier de projet.
//   • `sections`  — le prompt découpé en fragments nommés et modifiables.
//   • `text`      — les fragments assemblés, prêts à coller.
//
// Le texte est une TRADUCTION du JSON vers un moteur donné, pas l'inverse. Si
// demain un autre modèle demande une autre formulation, seule la traduction
// change ; le projet, lui, ne bouge pas.
//
// LE TEXTE EST EN ANGLAIS, L'INTERFACE EN FRANÇAIS. Les modèles d'image sont
// entraînés très majoritairement sur de l'anglais et l'interprètent nettement
// mieux, en particulier le vocabulaire de matière et d'éclairage. Une seule
// table de traduction, donc pas de version française à tenir en phase.
//
// ON NE TRADUIT PAS LES NOMBRES, ON TRADUIT L'INTENTION. « shadow = 90 % » n'a
// aucun sens pour un modèle d'image. « Deep cavities fall into near-black
// shadow while raised surfaces stay bright » en a un.

import { hexToRgb } from './math.js';

/**
 * Choisit la formule correspondant à une valeur.
 * La table est une suite de `[borneHaute, formule]` croissante ; la dernière
 * entrée sert de fourre-tout au-delà de toutes les bornes.
 */
function palier(valeur, table) {
  for (const [borne, formule] of table) if (valeur <= borne) return formule;
  return table[table.length - 1][1];
}

// ---------------------------------------------------------------------------
// Nombre de cavités — UNE ESTIMATION, ET ELLE SE DIT COMME TELLE
// ---------------------------------------------------------------------------
//
// Le moteur n'a pas de « nombre de cavités » et n'en aura pas : le paramètre a
// été retiré au lot 2 parce qu'un champ continu ancré en centimètres n'en a
// pas. Ce nombre dépend de la fenêtre par laquelle on regarde le champ —
// agrandir le panneau en révèle davantage sans rien déplacer.
//
// Un modèle d'image, lui, raisonne beaucoup mieux sur un nombre d'objets que
// sur une échelle en centimètres. On le DÉRIVE donc, et le prompt écrit
// « roughly 11 », jamais « 11 ».
//
// CALIBRATION. Comptage des composantes connexes du domaine creusé — même
// définition de « creusé » que l'oracle d'îlots de `tests/engine.mjs`, soit
// 30 % de l'amplitude sous le plateau — sur 1 280 configurations : huit formats
// de 80 × 60 à 400 × 200 cm, huit tailles de cavité de 16 à 120 cm, cinq
// densités de 20 à 72 %, les quatre familles.
//
// Quatre modèles ont été ajustés. La loi d'AIRE (n ∝ surface / taille²), qui
// est l'intuition naturelle, se trompe de 73 à 84 % en médiane : elle est
// fausse. Ce qui marche est une loi de LIGNE, n ∝ (√aire / taille)^p — les
// cavités s'organisent en bandes et en chaînes, pas en pavage, sauf dans la
// famille Cellules où l'exposant remonte vers le pavage (1,35).
//
// La densité N'ENTRE PAS. Elle déplace le compte de moins de 35 % sur toute sa
// course — moins que la dispersion de l'estimateur lui-même. Elle change la
// SURFACE creusée, pas le nombre de creux.
const CAVITES = {
  organic: [2.2, 0.70], // médiane 16 %, 95 % des cas à ±50 %
  dunes: [1.55, 1.05], // médiane  9 %, 96 %
  cells: [1.8, 1.35], // médiane 27 %, 82 % — la famille où les cavités fusionnent
  archipelago: [1.27, 0.95], // médiane 14 %, 95 %
};

export function estimerCavites(project) {
  const g = project.geometry;
  const [k, p] = CAVITES[g.family] || CAVITES.organic;
  const taille = Math.max(2, g.basinScaleCm);
  const n = k * Math.pow(Math.sqrt(project.widthCm * project.heightCm) / taille, p);
  return Math.max(1, Math.round(n));
}

// ---------------------------------------------------------------------------
// Matière
// ---------------------------------------------------------------------------

/** Teinte, saturation, clarté dans [0, 1] — pour nommer une couleur. */
function versTsl(hex) {
  const [r, v, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, v, b);
  const min = Math.min(r, v, b);
  const l = (max + min) / 2;
  if (max === min) return { t: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let t;
  if (max === r) t = ((v - b) / d + (v < b ? 6 : 0)) / 6;
  else if (max === v) t = ((b - r) / d + 2) / 6;
  else t = ((r - v) / d + 4) / 6;
  return { t: t * 360, s, l };
}

const CLARTE = [
  [0.10, 'near-black'],
  [0.26, 'very dark'],
  [0.42, 'dark'],
  [0.60, 'mid-tone'],
  [0.76, 'light'],
  [0.90, 'pale'],
  [1.00, 'near-white'],
];

/**
 * Nom de teinte, CLARTÉ COMPRISE.
 *
 * Une bande de teinte seule ne suffit pas : 38° nomme aussi bien un grès pâle
 * qu'une terre d'ombre, et écrire « pale terracotta » pour une pierre calcaire
 * envoie le modèle vers une couleur que la matière n'a pas. Les terres — la
 * gamme que ce produit emploie le plus — se nomment donc par leur clarté
 * autant que par leur teinte.
 */
function nomDeTeinte(t, l) {
  if (t < 15 || t >= 345) return l < 0.35 ? 'deep red' : 'red';
  if (t < 33) return l > 0.78 ? 'sand' : l < 0.30 ? 'deep rust' : 'terracotta';
  if (t < 60) return l > 0.65 ? 'sand' : l > 0.42 ? 'ochre' : 'umber';
  if (t < 95) return l > 0.70 ? 'pale yellow' : 'olive';
  if (t < 160) return 'green';
  if (t < 200) return 'teal';
  if (t < 255) return 'blue';
  if (t < 300) return 'violet';
  return l < 0.40 ? 'burgundy' : 'pink';
}

/**
 * Nomme une couleur au lieu d'écrire son code hexadécimal.
 *
 * `#e5ddcf` ne dit rien à un modèle d'image ; « pale warm off-white » lui dit
 * tout. Le nom est construit, pas cherché dans une liste : une liste de douze
 * couleurs se trompe dès que l'utilisateur en choisit une treizième.
 */
export function nommerCouleur(hex) {
  const { t, s, l } = versTsl(hex);
  const clarte = palier(l, CLARTE);
  const chaud = t < 95 || t > 300;
  const temperature = chaud ? 'warm' : 'cool';

  // Gris strictement neutres.
  if (s < 0.08) {
    if (l > 0.88) return 'neutral white';
    if (l < 0.12) return 'near-black neutral';
    return `${clarte} neutral grey`;
  }
  // TEINTÉ MAIS PAS COLORÉ — et le seuil compte.
  //
  // Le mur par défaut, `#d8d3c9`, a une saturation de 0,16 : sous un seuil trop
  // serré il ressortait en « pale terracotta », c'est-à-dire une couleur qu'il
  // n'a pas. C'est un blanc cassé chaud, et c'est ce que doit lire le modèle.
  // Au-delà de 0,28 en revanche, la teinte est bien la caractéristique
  // dominante : `#b96f50` est une terre cuite, pas un blanc cassé.
  if (s < 0.28) {
    if (l > 0.72) return `${temperature} off-white`;
    if (l < 0.30) return `${clarte} ${temperature} grey`;
    return `${clarte} ${temperature} grey`;
  }
  const nom = nomDeTeinte(t, l);
  // Ne pas empiler deux mots de clarté : « pale sand » se lit, « pale pale
  // sand » non, et « light deep rust » se contredit.
  const porteDejaLaClarte = /^(sand|pale|deep|umber|olive|burgundy)/.test(nom);
  return porteDejaLaClarte ? nom : `${clarte} ${nom}`;
}

const FINITIONS = {
  mat: 'a completely matte surface with no specular highlights, like fine plaster or unpolished stone',
  satine: 'a satin surface with soft, diffuse sheen and gentle broad highlights',
  brillant: 'a glossy surface with tight, bright specular highlights',
  chrome: 'a polished chrome surface, strongly mirror-reflective, picking up a neutral studio environment',
};

const GRAIN = [
  [0.05, 'perfectly smooth, with no visible surface grain'],
  [0.22, 'an almost imperceptible fine grain'],
  [0.45, 'a fine, even mineral grain'],
  [0.70, 'a clearly visible granular texture'],
  [1.00, 'a coarse, heavily granular texture'],
];

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

const FAMILLES = {
  organic: 'soft irregular organic masses separated by fused, continuous hollows',
  dunes: 'long continuous flowing strata, like wind-formed dunes, running across the panel',
  cells: 'a network of rounded alveolar cells packed against one another',
  archipelago: 'wide open bands punctuated by a few isolated elliptical basins, like an archipelago',
};

const PROFONDEUR = [
  [0.32, 'a very shallow relief, barely lifted from the panel'],
  [0.48, 'a shallow relief with subtle elevation changes'],
  [0.66, 'a moderate relief with clearly readable hollows'],
  [0.84, 'a deep relief with pronounced hollows'],
  [1.00, 'a very deep sculptural relief with strongly carved cavities'],
];

const DOUCEUR = [
  [0.18, 'sharp, crisply defined edges'],
  [0.38, 'firm edges with only slight softening'],
  [0.62, 'soft, rounded transitions between surfaces'],
  [0.82, 'very soft, melted transitions'],
  [1.00, 'edges fully dissolved into continuous flowing surfaces'],
];

const ONDULATION = [
  [0.12, 'a calm, still surface'],
  [0.34, 'a slight undulation across the surface'],
  [0.58, 'a clear sense of movement running through the composition'],
  [0.80, 'strong undulation carrying the whole surface'],
  [1.00, 'a very pronounced flowing movement'],
];

const IRREGULARITE = [
  [0.14, 'regular, almost geometric contours'],
  [0.34, 'gently varied contours'],
  [0.58, 'organic, naturally irregular contours'],
  [0.80, 'markedly asymmetric and eroded contours'],
  [1.00, 'highly irregular, heavily eroded mineral edges'],
];

const ALLONGEMENT = [
  [0.16, 'shapes with no dominant direction'],
  [0.40, 'shapes slightly stretched along one axis'],
  [0.70, 'clearly elongated shapes'],
  [1.00, 'strongly stretched, almost linear shapes'],
];

const CHENAUX = [
  [0.10, 'with no connecting channels between hollows'],
  [0.35, 'with faint channels linking a few hollows'],
  [0.65, 'with visible channels connecting the hollows into a network'],
  [1.00, 'with strong continuous channels weaving the hollows together'],
];

// ---------------------------------------------------------------------------
// Lumière
// ---------------------------------------------------------------------------

const HAUTEUR_LUMIERE = [
  [24, 'very low raking light that rakes across the surface and maximises edge shadow'],
  [38, 'low, grazing light'],
  [55, 'moderately angled light'],
  [90, 'high, near-frontal light that flattens the relief'],
];

const OMBRES = [
  [0.22, 'shadows stay open and light, keeping every transition readable'],
  [0.45, 'shadows are present but soft, preserving surface detail throughout'],
  [0.70, 'shadows are deep and give the relief strong separation'],
  [1.00, 'the deepest cavities fall into near-black shadow while raised surfaces stay bright, producing strong depth separation without crushing the intermediate surface detail'],
];

const OCCLUSION = [
  [0.25, 'narrow recesses stay open'],
  [0.55, 'narrow recesses darken naturally'],
  [1.00, 'narrow recesses darken sharply, deepening the sense of carved volume'],
];

const CONTRASTE = [
  [0.40, 'a low-contrast, even tonal range'],
  [0.70, 'a balanced tonal range'],
  [1.00, 'a high-contrast tonal range'],
];

const HALO = [
  [0.20, 'the panel sits flat against the wall'],
  [0.55, 'a faint glow separates the panel from the wall'],
  [1.00, 'a pronounced backlit halo detaches the panel from the wall'],
];

/** Direction cardinale de la lumière, en langage d'atelier. */
function directionLumiere(deg) {
  const a = ((deg % 360) + 360) % 360;
  const secteurs = [
    [22.5, 'from the right'], [67.5, 'from the lower right'], [112.5, 'from below'],
    [157.5, 'from the lower left'], [202.5, 'from the left'], [247.5, 'from the upper left'],
    [292.5, 'from above'], [337.5, 'from the upper right'], [360, 'from the right'],
  ];
  return palier(a, secteurs);
}

// ---------------------------------------------------------------------------
// Cadrage
// ---------------------------------------------------------------------------

const DECOUPES = {
  none: 'a single continuous panel',
  '2x1': 'split into two vertical panels with a visible gap between them',
  '2x2': 'split into four panels in a two-by-two grid',
  '3x2': 'split into six panels in a three-by-two grid',
};

const FORMES = { rectangle: 'rectangular', square: 'square', circle: 'circular' };

// ---------------------------------------------------------------------------
// Fidélité à la géométrie
// ---------------------------------------------------------------------------
//
// La distinction est plus utile qu'elle n'en a l'air. « Strict » sert quand on
// fournit la heightmap ou l'export en référence et qu'on veut un rendu de CETTE
// pièce ; « créatif » sert quand on cherche encore la forme.
export const PRECISIONS = {
  strict: {
    nom: 'Géométrie stricte',
    phrase: 'Preserve exactly the number, position, size and topology of every cavity and raised region from the supplied geometry reference. Do not invent, remove or relocate structural features.',
  },
  interpretation: {
    nom: 'Interprétation',
    phrase: 'Follow the supplied composition closely; small local reinterpretation of the surface is acceptable, but the overall layout of hollows and masses must remain recognisable.',
  },
  creatif: {
    nom: 'Créatif',
    phrase: 'Treat the described composition as a starting point; a free reinterpretation is welcome as long as the material, lighting and format are respected.',
  },
};

// ---------------------------------------------------------------------------
// Ce que l'on refuse
// ---------------------------------------------------------------------------
//
// À ne pas confondre avec le RELIEF NÉGATIF, qui est un mode de géométrie.
// Celui-ci empêche le modèle de transformer un panneau sculpté en photo de
// décoration : c'est le défaut vers lequel tous glissent, faute d'instruction
// contraire.
const REFUS_TOUJOURS = [
  'furniture', 'people', 'plants', 'decorative objects', 'text', 'watermark',
  'distorted panel proportions', 'duplicated or tiled relief pattern',
  'excessive surface noise', 'coloured or theatrical lighting',
  'perspective distortion', 'vignetting', 'depth of field blur',
];

/**
 * Compile l'état du projet.
 * @param {object} project
 * @param {object} options  `precision` : clé de `PRECISIONS`
 */
export function compilerPrompt(project, options = {}) {
  const precision = PRECISIONS[options.precision] ? options.precision : 'strict';
  const g = project.geometry;
  const m = project.material;
  const l = project.lighting;
  const pr = project.presentation;

  const cavites = estimerCavites(project);
  const epaisseur = project.depthCm;
  const forme = FORMES[project.canvasShape] || 'rectangular';
  const dimensions = project.canvasShape === 'circle'
    ? `${arrondi(project.widthCm)} cm in diameter`
    : `${arrondi(project.widthCm)} × ${arrondi(project.heightCm)} cm`;

  // ---- Sujet
  const sujet = `A sculptural organic wall relief panel, ${forme}, ${dimensions}, with a maximum relief depth of ${arrondi(epaisseur)} cm.`;

  // ---- Géométrie
  const morceaux = [
    `The composition is built from ${FAMILLES[g.family] || FAMILLES.organic}`,
    `roughly ${cavites} main hollow${cavites > 1 ? 's' : ''} across the panel`,
  ];
  // Les chenaux n'existent que dans la famille `organic` — voir `channelCarve`
  // dans `field.js`. Les mentionner ailleurs serait décrire ce que le moteur ne
  // rend pas, exactement le mensonge que la molette grisée évite dans l'atelier.
  if (g.family === 'organic') morceaux.push(palier(g.channelWeight, CHENAUX));
  const geometrie = `${morceaux.join(', ')}. It has ${palier(g.depth, PROFONDEUR)}, ${palier(g.softness, DOUCEUR)}, and ${palier(g.wave, ONDULATION)}. The forms show ${palier(g.irregularity, IRREGULARITE)}, ${palier(g.elongation, ALLONGEMENT)}${g.elongation > 0.16 ? ` oriented at about ${Math.round(g.orientationDeg)}° from horizontal` : ''}.${g.negative ? ' The relief is inverted: what would normally be raised is hollowed and vice versa.' : ''}`;

  // ---- Matière
  const surface = `The material is ${nommerCouleur(m.color)}, with ${FINITIONS[m.finish] || FINITIONS.mat}, and ${palier(m.texture, GRAIN)}.`;

  // ---- Lumière
  const lumiere = `Lit by a single architectural light source ${directionLumiere(l.angle)} at roughly ${Math.round(l.angle)}°, ${palier(l.height, HAUTEUR_LUMIERE)}. ${capitale(palier(l.shadowStrength, OMBRES))}; ${palier(l.cavityOcclusion, OCCLUSION)}. The image has ${palier(l.contrast, CONTRASTE)} at ${signe(l.exposureEv || 0)} EV exposure, and ${palier(l.backlight, HALO)}.`;

  // ---- Cadrage
  const cadrage = `Shown as ${DECOUPES[pr.panelLayout] || DECOUPES.none}${pr.frame ? ', in a thin black frame' : ', unframed'}, mounted on a ${nommerCouleur(pr.wallColor)} wall. Straight-on frontal view, panel centred and filling the frame, no perspective, proportions strictly preserved.`;

  const sections = { sujet, geometrie, surface, lumiere, cadrage, fidelite: PRECISIONS[precision].phrase };
  const text = Object.values(sections).join(' ');

  const refus = [...REFUS_TOUJOURS];
  if (!pr.frame) refus.push('frame', 'border');
  if (m.finish === 'mat') refus.push('specular highlights', 'glossy reflections');
  if (pr.panelLayout === 'none') refus.push('panel seams', 'visible joints');

  return {
    cavites,
    precision,
    sections,
    text,
    negative: refus.join(', '),
    json: {
      object: 'organic_wall_relief',
      shape: project.canvasShape,
      dimensions_cm: { width: arrondi(project.widthCm), height: arrondi(project.heightCm), depth: arrondi(project.depthCm) },
      geometry: {
        family: g.family,
        // `estimated: true` n'est pas une politesse : ce champ est DÉRIVÉ, et
        // celui qui relira ce JSON dans six mois doit pouvoir le distinguer
        // d'un réglage. La grandeur réglée, elle, est `basin_scale_cm`.
        cavities: { estimated: true, count: cavites, basin_scale_cm: arrondi(g.basinScaleCm) },
        depth: r2(g.depth),
        softness: r2(g.softness),
        wave: r2(g.wave),
        irregularity: r2(g.irregularity),
        elongation: r2(g.elongation),
        orientation_deg: Math.round(g.orientationDeg),
        channel_weight: g.family === 'organic' ? r2(g.channelWeight) : null,
        density: r2(g.density),
        inverted: !!g.negative,
        seed: g.seed,
      },
      material: { color_hex: m.color, color_name: nommerCouleur(m.color), finish: m.finish, grain: r2(m.texture) },
      lighting: {
        azimuth_deg: Math.round(l.angle),
        elevation_deg: Math.round(l.height),
        shadow_strength: r2(l.shadowStrength),
        cavity_occlusion: r2(l.cavityOcclusion),
        contrast: r2(l.contrast),
        exposure_ev: r2(l.exposureEv || 0),
        backlight: r2(l.backlight),
      },
      presentation: { layout: pr.panelLayout, framed: !!pr.frame, wall_color_hex: pr.wallColor },
      camera: { view: 'front', perspective: false },
      fidelity: precision,
    },
  };
}

function arrondi(v) {
  return Math.round(v * 10) / 10;
}
function r2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}
function signe(v) {
  const x = Math.round(v * 10) / 10;
  return x > 0 ? `+${x}` : String(x);
}
function capitale(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
