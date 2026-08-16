// Moteur procédural « organic-v2 » — le moteur du lot 2.
//
// Il remplace `legacyField.js`, dont l'audit du lot 0 a montré qu'il ne pouvait
// pas produire les références : formes placées pour NE PAS se recouvrir, liaisons
// rejetées au-delà d'un seuil, fond de cavité plat sur ses 45 % centraux, et une
// houle ajoutée APRÈS coup qui fabriquait l'îlot central.
//
// Chaîne de construction :
//   1. repère de composition   — décalage en cm, rotation, étirement anisotrope
//   2. domain warp             — deux niveaux, c'est lui qui fait serpenter les chenaux
//   3. houle porteuse          — basse fréquence, prise en compte AVANT le creusement
//   4. creusement              — rampe monotone à épaulement doux, jamais saturée
//   5. fusion                  — smooth minimum entre bassins et chenaux
//
// Deux propriétés sont structurelles, pas réglées :
//
//   • LE CHAMP EST UNE FONCTION DES CENTIMÈTRES ABSOLUS. La toile n'en est qu'une
//     fenêtre. Agrandir révèle du motif, sans déplacer d'un millimètre ce qui est
//     déjà là. Rien dans ce fichier ne connaît les dimensions de la toile.
//
//   • LE PROFIL DES CREUX EST STRICTEMENT MONOTONE. La hauteur s'écrit
//     h = hBase − (hBase + depth) · carve, avec carve ≥ 0 croissant et
//     hBase + depth > 0 : h décroît strictement quand carve croît. Un anneau ou
//     un îlot central au fond d'une cavité est impossible par construction, pas
//     par réglage prudent.

import { smin } from '../core/math.js';
import { fbm } from './noise.js';

/**
 * Rampe monotone à épaulement doux — « smooth ReLU ».
 * Exactement nulle sous −w (le plateau est un vrai plateau), exactement linéaire
 * au-dessus de +w (le creusement ne sature JAMAIS, donc pas de fond plat),
 * raccordée par une parabole entre les deux (l'épaulement).
 */
export function shoulderRamp(z, w) {
  if (z <= -w) return 0;
  if (z >= w) return z;
  const t = z + w;
  return (t * t) / (4 * w);
}

/** Maximum adouci, écrit à partir du minimum adouci. */
function smax(a, b, k) {
  return -smin(-a, -b, k);
}

/** smoothstep sur [0, 1], borné. */
function smoothstep01(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// Écart-type mesuré du fbm employé ici (80 000 tirages) : 0,300, moyenne nulle,
// extrêmes à ±0,9. Les seuils sont exprimés en multiples de cet écart-type, ce
// qui rend « densité » lisible : à 0,5 le seuil vaut la médiane du bruit, donc
// environ la moitié de la surface est creusée.
const NOISE_STD = 0.3;

// Gain de creusement : un point à un écart-type au-dessus du seuil atteint une
// profondeur proche de la profondeur nominale.
const CARVE_GAIN = 3.3;

// Extinction de la houle : au-delà de ce creusement, le plateau ne contribue
// plus du tout et la hauteur ne dépend plus que du creusement.
const CARRIER_CUTOFF = 0.3;

// Amplitude de houle admissible, en fraction de la profondeur.
//
// Ce n'est pas un réglage esthétique mais la condition de stricte monotonie.
// Avec une extinction en smoothstep sur [0, CARRIER_CUTOFF], la pente maximale
// de l'extinction vaut 1,5 / CARRIER_CUTOFF = 5. Il faut donc
// SWELL_RATIO × 5 < 1 pour que dh/dcarve reste strictement négatif partout.
// 0,16 × 5 = 0,80 : la marge est de 20 %.
const SWELL_RATIO = 0.16;

export function makeFieldContext(geometry) {
  const g = geometry;
  const orientation = ((g.orientationDeg || 0) * Math.PI) / 180;
  // Étirement à AIRE CONSTANTE : un axe s'allonge d'un facteur √s, l'autre se
  // resserre d'autant. Diviser un seul axe rétrécirait le domaine de bruit
  // réellement échantillonné, et l'œuvre entière se retrouverait sur une poignée
  // de mailles — relief mou et sans amplitude.
  const stretch = Math.sqrt(1 + g.elongation * 3.2);
  const basin = Math.max(2, g.basinScaleCm);
  const channel = basin * g.channelRatio;

  return {
    geometry: g,
    negative: !!g.negative,
    cosA: Math.cos(orientation),
    sinA: Math.sin(orientation),
    invStretch: 1 / stretch,
    crossStretch: stretch,

    invBasin: 1 / basin,
    invChannel: 1 / Math.max(1.5, channel),
    invWarp: 1 / (basin * 1.55),
    invWarpFine: 1 / (basin * 0.5),
    // Longueur d'onde de la houle porteuse : 2,8 fois la taille des cavités.
    // À 5,5 fois, elle dépassait la largeur du panneau et ne modulait plus rien —
    // elle le coupait en deux, une moitié creusée, une moitié en plateau nu.
    invSwell: 1 / (basin * 2.8),

    warpAmpCm: g.warpAmount * basin * 0.62,
    warpFineAmpCm: g.warpAmount * basin * 0.10,

    offsetX: g.domainOffsetXCm || 0,
    offsetY: g.domainOffsetYCm || 0,

    // Amplitude de la houle qui porte la composition, et influence de cette même
    // houle sur l'endroit où ça creuse : c'est le « avant le creusement ».
    //
    // L'amplitude est proportionnelle à la profondeur. Ce n'est pas une commodité
    // de réglage : c'est ce qui garantit |houle| < profondeur, donc la stricte
    // décroissance de la hauteur quand le creusement augmente (voir `evalField`).
    swellAmp: g.wave * SWELL_RATIO * g.depth,
    carrierBias: 0.08 + g.wave * 0.22,
    // Décalage du domaine de la houle : c'est lui, et lui seul, qui bouge quand
    // l'ondulation est animée. La structure des creux, elle, ne se déplace pas.
    carrierPhase: 0,

    // Le champ qui pilote la PROFONDEUR est délibérément pauvre en octaves.
    //
    // Un creux est un ensemble de niveau supérieur du bruit ; les minima locaux
    // du bruit qui tombent DEDANS deviennent des bosses enclavées — des îlots.
    // Leur densité suit celle des points critiques, donc le contenu haute
    // fréquence. Mesuré : passer l'irrégularité au maximum faisait grimper les
    // îlots de 115 à 171 sur 48 variations.
    //
    // L'irrégularité ne modifie donc plus la profondeur : elle perturbe le SEUIL,
    // c'est-à-dire la position du bord. C'est aussi ce que montrent les
    // références — contours très découpés, intérieurs de cavité lisses.
    octavesBasin: 2,
    octavesChannel: 2,
    invRim: 1 / (basin * 0.34),
    rimJitter: g.irregularity * NOISE_STD * 0.85,

    // Densité forte = seuil bas = surface creusée plus large.
    thresholdBasin: NOISE_STD * (1.2 - g.density * 2.4),
    thresholdChannel: NOISE_STD * (1.5 - g.density * 2.4),

    carveGain: CARVE_GAIN,
    shoulderBasin: NOISE_STD * (0.12 + g.shoulder * 0.55),
    shoulderChannel: NOISE_STD * (0.12 + g.shoulder * 0.55) * 0.6,
    channelWeight: g.channelWeight,
    fuseK: 0.08 + g.fuse * 0.42,
    depth: g.depth,

    seed: g.seed | 0,
  };
}

/**
 * Évalue le relief en un point, en CENTIMÈTRES absolus.
 * `warpXCm`/`warpYCm` sont le déplacement sculpté, `liftValue` la hauteur sculptée.
 */
/**
 * Décompose le relief en ses parties STATIQUE et VARIABLE.
 *
 * La hauteur s'écrit h = A·houle + B, où seule la houle dépend du temps :
 *   A = amplitude × extinction(creusement)   — statique
 *   B = −profondeur × creusement + sculpture — statique
 * Les coordonnées d'échantillonnage de la houle (sx, sy) sont statiques elles
 * aussi. C'est cette décomposition qui permet d'animer l'ondulation sans
 * réévaluer tout le champ : par image il ne reste que la houle, soit deux
 * évaluations de bruit au lieu d'une quinzaine.
 */
export function evalParts(ctx, xCm, yCm, warpXCm = 0, warpYCm = 0, liftValue = 0) {
  const px = xCm + ctx.offsetX + warpXCm;
  const py = yCm + ctx.offsetY + warpYCm;

  // 1. Repère de composition : orientation puis étirement.
  const ax = (ctx.cosA * px + ctx.sinA * py) * ctx.invStretch;
  const ay = (-ctx.sinA * px + ctx.cosA * py) * ctx.crossStretch;

  // 2. Domain warp — deux niveaux. Le grossier déplace les masses, le fin
  //    dentelle les bords ; ensemble ils transforment des taches rondes en
  //    chenaux continus.
  const wu = ax * ctx.invWarp;
  const wv = ay * ctx.invWarp;
  let bx = ax + ctx.warpAmpCm * fbm(wu, wv, ctx.seed + 101, 2);
  let by = ay + ctx.warpAmpCm * fbm(wu + 5.27, wv - 3.71, ctx.seed + 211, 2);
  const fu = bx * ctx.invWarpFine;
  const fv = by * ctx.invWarpFine;
  bx += ctx.warpFineAmpCm * fbm(fu + 1.73, fv + 9.11, ctx.seed + 307, 2);
  by += ctx.warpFineAmpCm * fbm(fu - 6.19, fv + 2.53, ctx.seed + 419, 2);

  // 3. Houle porteuse — sur le repère NON déformé : elle porte la composition
  //    entière au lieu de suivre ses accidents.
  const sx = ax * ctx.invSwell;
  const sy = ay * ctx.invSwell;
  const carrier = fbm(sx + ctx.carrierPhase, sy, ctx.seed + 523, 2);
  const bias = ctx.carrierBias * carrier;

  // 4. Creusement — découpe du bord au SEUIL, profondeur pilotée par un champ
  //    délibérément pauvre en octaves (voir `octavesBasin`).
  const rim = ctx.rimJitter > 0 ? ctx.rimJitter * fbm(bx * ctx.invRim, by * ctx.invRim, ctx.seed + 3, 2) : 0;
  const nBasin = fbm(bx * ctx.invBasin, by * ctx.invBasin, ctx.seed + 1, ctx.octavesBasin);
  const carveBasin = ctx.carveGain * shoulderRamp(nBasin + bias + rim - ctx.thresholdBasin, ctx.shoulderBasin);

  let carve = carveBasin;
  if (ctx.channelWeight > 0) {
    const nChannel = fbm(bx * ctx.invChannel, by * ctx.invChannel, ctx.seed + 2, ctx.octavesChannel);
    const carveChannel = ctx.carveGain * shoulderRamp(nChannel + bias + rim - ctx.thresholdChannel, ctx.shoulderChannel) * ctx.channelWeight;
    // 5. Fusion : le plus profond l'emporte, sans arête au raccord.
    carve = smax(carveBasin, carveChannel, ctx.fuseK);
  }

  // La houle est le plateau. Elle s'ÉTEINT dès que le creusement dépasse
  // CARRIER_CUTOFF : passé ce point, plus rien ne peut relever le fond d'une
  // cavité. Une atténuation en (1 − carve) changerait de signe au-delà de 1 et
  // ferait remonter les fonds profonds — c'est le mécanisme des îlots.
  //
  // Stricte monotonie : dh/dcarve = houle × extinction′ − profondeur, avec
  // |houle| ≤ SWELL_RATIO × profondeur et |extinction′| ≤ 1,5 / CARRIER_CUTOFF,
  // donc dh/dcarve ≤ (0,16 × 5 − 1) × profondeur = −0,20 × profondeur < 0.
  const attenuation = 1 - smoothstep01(carve / CARRIER_CUTOFF);

  return {
    a: ctx.swellAmp * attenuation,
    b: -ctx.depth * carve + liftValue,
    sx,
    sy,
    carrier,
    carve,
  };
}

/**
 * Évalue le relief en un point, en CENTIMÈTRES absolus.
 * `warpXCm`/`warpYCm` sont le déplacement sculpté, `liftValue` la hauteur sculptée.
 */
export function evalField(ctx, xCm, yCm, warpXCm = 0, warpYCm = 0, liftValue = 0) {
  const parts = evalParts(ctx, xCm, yCm, warpXCm, warpYCm, liftValue);
  const h = parts.a * parts.carrier + parts.b;
  return ctx.negative ? -h : h;
}
