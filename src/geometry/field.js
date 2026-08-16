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

// Réciproque de 2³² − 1, pour remplacer une division par une multiplication.
//
// Le compilateur ne peut pas faire la substitution lui-même : le résultat n'est
// pas bit-identique, donc la transformation lui est interdite. À nous de la
// décider. Cette ligne s'exécute vingt-sept fois par cellule en famille
// Cellules — cinq millions et demi de divisions flottantes par reconstruction
// sur un panneau de 200 × 120 cm. L'écart introduit est de l'ordre de 10⁻¹⁶ sur
// une valeur qui sert de gigue de position : il n'a aucune traduction visible.
const INV_U32 = 1 / 4294967295;

/** Hash déterministe local, dans [0, 1]. */
function hash01(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) * INV_U32;
}

/**
 * Union douce de cavités circulaires irrégulières.
 *
 * Chaque case du réseau possède un centre décalé et un rayon déterministes.
 * On retourne le meilleur champ signé `rayon - distance` : positif dans une
 * cellule, négatif sur les plateaux. Contrairement à un bruit de valeur, le
 * fond ne peut pas contenir d’îlot central — la profondeur croît toujours en
 * allant vers le centre de la cavité.
 */
function cellularSignal(x, y, seed, jitter, baseRadius, fusion = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = -Infinity;

  for (let gy = iy - 1; gy <= iy + 1; gy++) {
    for (let gx = ix - 1; gx <= ix + 1; gx++) {
      const ox = 0.5 + (hash01(gx, gy, seed + 17) - 0.5) * jitter;
      const oy = 0.5 + (hash01(gx, gy, seed + 71) - 0.5) * jitter;
      const radius = baseRadius * (0.72 + hash01(gx, gy, seed + 131) * 0.55);
      // `Math.sqrt` et non `Math.hypot` : ce dernier fait une mise à l'échelle
      // anti-débordement inutile ici — 3,6 fois plus lent pour un écart de
      // 4 × 10⁻¹⁶, mesuré. Cette ligne s'exécute neuf fois par cellule de
      // grille, soit plus de deux millions de fois par reconstruction.
      const dxc = x - (gx + ox);
      const dyc = y - (gy + oy);
      const d = radius - Math.sqrt(dxc * dxc + dyc * dyc);
      // UNION DOUCE, et non `Math.max`.
      //
      // Le maximum dur laisse une ARÊTE là où deux cavités se rejoignent : la
      // paroi se pince en pointe, et le relief prend un air de feuillage. Les
      // trois photos de référence ne montrent jamais cela — leurs cavités
      // fusionnent en une seule cuvette continue, sans pli.
      //
      // `smax` arrondit exactement cette jonction, et c'est `fuse` qui règle le
      // rayon de l'arrondi : la molette « fusion des formes », inerte dans cette
      // famille jusqu'ici, y a désormais son sens le plus littéral.
      best = best === -Infinity ? d : (fusion > 0 ? smax(best, d, fusion) : Math.max(best, d));
    }
  }
  return best;
}

/**
 * Quelques bassins elliptiques, espacés et orientés indépendamment.
 * Cette primitive est réservée à Archipel : un Voronoï complet produirait une
 * seconde famille « Cellules » alors que l'intention est un paysage ouvert,
 * ponctué seulement de deux ou trois lagunes à l'échelle d'un panneau.
 */
function sparseEllipticSignal(x, y, seed, keep, jitter) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = -Infinity;

  // BALAYAGE 3 × 3, ET NON 5 × 5.
  //
  // Un centre reste dans [0,07 ; 0,93] de sa case et l'ellipse porte au plus à
  // 0,55. Une case à deux rangs est donc à 1,07 au minimum : sa contribution
  // vaut au mieux 1 − 1,07/0,55 ≈ −0,95, très en deçà de la largeur de rampe
  // (0,10 à 0,17), donc rigoureusement nulle après `shoulderRamp`. Les seize
  // cases extérieures ne coûtaient que du temps — seize hachages par cellule.
  for (let gy = iy - 1; gy <= iy + 1; gy++) {
    for (let gx = ix - 1; gx <= ix + 1; gx++) {
      if (hash01(gx, gy, seed + 11) > keep) continue;
      const ox = 0.5 + (hash01(gx, gy, seed + 37) - 0.5) * jitter;
      const oy = 0.5 + (hash01(gx, gy, seed + 73) - 0.5) * jitter;
      const angle = hash01(gx, gy, seed + 109) * Math.PI;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const dx = x - (gx + ox);
      const dy = y - (gy + oy);
      const rx = dx * ca + dy * sa;
      const ry = -dx * sa + dy * ca;
      const radiusX = 0.28 + hash01(gx, gy, seed + 151) * 0.27;
      // Une seule division au lieu de deux : `ry / radiusY` s'écrit
      // `(ry / radiusX) / (0,60 + …)`, et le facteur de forme se factorise.
      const invRx = 1 / radiusX;
      const nx = rx * invRx;
      const ny = (ry * invRx) / (0.60 + hash01(gx, gy, seed + 197) * 0.30);
      best = Math.max(best, 1 - Math.sqrt(nx * nx + ny * ny));
    }
  }
  return best;
}

/**
 * Réseau de chenaux — RÉSERVÉ À LA FAMILLE `organic`.
 *
 * Constat de l'audit : sur Cellules et Archipel, la molette « Chenaux » ne
 * change RIEN. Douze combinaisons de (chenaux, fusion) sur Archipel rendent la
 * même distance à ref-3 — 4,46 % — à trois décimales, et le même compte
 * d'îlots. Une commande offerte à l'utilisateur ne pilotait aucune sortie sur
 * deux préréglages sur trois.
 *
 * L'ÉTENDRE AUX AUTRES FAMILLES A ÉTÉ ESSAYÉ, MESURÉ, ET REJETÉ. Fusionner ce
 * réseau — un fbm, donc un champ à minima intérieurs — avec les silhouettes de
 * Cellules et d'Archipel fait passer les variations portant une bosse enclavée
 * de 2 % à 48 % sur 200 × 120 cm. Le bruit apporte ses propres cuvettes au fond
 * des cavités ; `cellularSignal` est justement construit pour n'en avoir aucune.
 *
 * La molette est donc DÉSACTIVÉE hors de `organic` plutôt que faussement
 * branchée : voir `syncFamilyControls` dans l'atelier. Une commande visible qui
 * n'agit pas est un mensonge ; une commande grisée qui dit pourquoi est un fait.
 */
function channelCarve(ctx, bx, by, bias, rim) {
  const n = fbm(bx * ctx.invChannel, by * ctx.invChannel, ctx.seed + 2, ctx.octavesChannel);
  return ctx.carveGain * shoulderRamp(n + bias + rim - ctx.thresholdChannel, ctx.shoulderChannel) * ctx.channelWeight;
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
    family: g.family || 'organic',
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
    // Rayon d'arrondi de la jonction entre deux cavités voisines, exprimé en
    // fraction d'une case du réseau — l'unité dans laquelle `cellularSignal`
    // travaille. À 0,26 (fusion au maximum), deux cavités qui se touchent ne
    // laissent plus de pli du tout ; à 0, on retrouve l'arête du maximum dur.
    cellFusion: g.fuse * 0.26,
    depth: g.depth,
    basinScaleCm: basin,

    seed: g.seed | 0,

    // ---- Invariants des trois familles ajoutées avec la boutique ------------
    //
    // `makeFieldContext` précalculait déjà les réciproques de la famille
    // `organic` — c'est pourquoi sa branche ne contient AUCUNE division. Les
    // trois familles suivantes ont été écrites sans reprendre la convention :
    // elles divisaient en dur, jusqu'à sept fois par cellule pour Archipel, et
    // recalculaient deux cent mille fois des quantités qui ne dépendent que de
    // la géométrie — longueur d'onde, seuil, largeur d'épaulement, gains.
    //
    // Tout est remonté ici. Ce ne sont pas de nouveaux réglages : chaque ligne
    // est l'expression littérale qui se trouvait dans la boucle.
    familleId: FAMILY_ID[g.family || 'organic'] ?? FAMILY_ID.organic,
    density: g.density,
    irregularity: g.irregularity,
    shoulder: g.shoulder,
    invCarrierCutoff: 1 / CARRIER_CUTOFF,

    // Dunes
    invDuneLargeX: 1 / (basin * 1.55),
    invDuneLargeY: 1 / (basin * 1.25),
    invDuneCrossX: 1 / (basin * 0.72),
    invDuneCrossY: 1 / (basin * 1.8),
    dunePhaseK: (Math.PI * 2) / (basin * (0.92 + (1 - g.density) * 0.54)),
    duneLargeGain: 1.7 + g.warpAmount * 2.4,
    duneThreshold: 0.25 - g.density * 0.42,
    duneShoulder: NOISE_STD * (0.12 + g.shoulder * 0.55) * 1.30,
    duneCarve: CARVE_GAIN * 0.55,

    // Cellules
    invCellScale: 1 / basin,
    cellJitter: 0.30 + g.irregularity * 0.62,
    cellRadius: 0.24 + g.density * 0.33,
    cellWidth: 0.035 + g.shoulder * 0.12,
    cellCarve: CARVE_GAIN * 0.52,

    // Archipel
    invArchLargeX: 1 / (basin * 1.25),
    invArchLargeY: 1 / (basin * 2.10),
    invArchCrossX: 1 / (basin * 0.82),
    invArchCrossY: 1 / (basin * 2.65),
    archPhaseK: (Math.PI * 2) / (basin * 1.82),
    archLargeGain: 2.8 + g.warpAmount * 2.4,
    archShoulder: NOISE_STD * (0.12 + g.shoulder * 0.55) * 1.50,
    archCarve: CARVE_GAIN * 0.50,
    invArchIsland: 1 / (basin * 1.72),
    archIslandKeep: 0.18 + g.density * 0.24,
    archIslandJitter: 0.46 + g.irregularity * 0.40,
    archIslandWidth: 0.10 + g.shoulder * 0.07,
    archIslandCarve: CARVE_GAIN * 0.56,
  };
}

// Familles résolues en ENTIER une fois par reconstruction.
//
// La boucle comparait quatre chaînes par cellule — huit cent mille comparaisons
// par reconstruction. V8 interne les littéraux, donc le coût réel est faible,
// mais un entier le supprime tout à fait et rend le `switch` compilable.
const FAMILY_ID = { organic: 0, dunes: 1, cells: 2, archipelago: 3 };

/**
 * Évalue le relief en un point, en CENTIMÈTRES absolus.
 * `warpXCm`/`warpYCm` sont le déplacement sculpté, `liftValue` la hauteur sculptée.
 *
 * UNE SEULE FONCTION, ET UN SCALAIRE EN SORTIE.
 *
 * Il y en avait deux : `evalParts` rendait un objet `{ a, b, sx, sy, carrier,
 * carve }` que `evalField` recombinait aussitôt. La décomposition servait à
 * animer la houle sans réévaluer le champ — deux évaluations de bruit par image
 * au lieu d'une quinzaine. Mais l'animation a été retirée du produit (« produit
 * statique : aucune boucle d'animation », `atelier.js`), et l'unique appelant
 * de `evalParts` jetait la moitié des champs.
 *
 * Restait le coût : DEUX CENT MILLE objets à six champs et à durée de vie nulle
 * par reconstruction. L'échappement n'était pas éliminable par le moteur — la
 * fonction fait cent dix lignes et onze appels à `fbm`, très au-dessus du budget
 * d'inlining. Fusionner supprime l'allocation entière.
 *
 * Si l'animation revient, elle reviendra avec sa propre fonction : une
 * décomposition qui coûte tous les jours pour une fonctionnalité qui n'existe
 * plus n'est pas une provision, c'est une dette.
 */
export function evalField(ctx, xCm, yCm, warpXCm = 0, warpYCm = 0, liftValue = 0) {
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

  // 4. Creusement. Les trois familles partagent repère, déformation, houle,
  //    profil monotone et sculpture, mais pas le champ qui dessine leurs
  //    silhouettes : changer seulement les paramètres d’un même bruit faisait
  //    converger Dunes, Cellules et Archipel vers le même langage visuel.
  //
  // `rim` N'EST PLUS CALCULÉ QUE LÀ OÙ IL EST LU. Il l'était inconditionnellement,
  // alors que ni Cellules ni Archipel ne le consultent — un `fbm` complet jeté
  // sur deux familles sur trois, soit un sixième du budget de bruit en Cellules
  // et un huitième en Archipel, et ce sur des préréglages dont l'irrégularité
  // n'est jamais nulle (0,38 et 0,46).
  const famille = ctx.familleId;
  let carve;

  if (famille === 1) {
    // Strates continues : une phase périodique serpente sous deux bruits très
    // larges. Les lignes restent longues et lisibles ; le second terme varie
    // leur largeur sans les casser en taches indépendantes.
    const rim = ctx.rimJitter > 0 ? ctx.rimJitter * fbm(bx * ctx.invRim, by * ctx.invRim, ctx.seed + 3, 2) : 0;
    const large = fbm(ax * ctx.invDuneLargeX, ay * ctx.invDuneLargeY, ctx.seed + 811, 2);
    const cross = fbm(ax * ctx.invDuneCrossX, ay * ctx.invDuneCrossY, ctx.seed + 907, 2);
    const phase = by * ctx.dunePhaseK + large * ctx.duneLargeGain + cross * 0.62;
    const bands = Math.cos(phase) * 0.50 + large * 0.23 + cross * 0.09 + bias * 0.42 + rim * 0.28;
    carve = ctx.duneCarve * shoulderRamp(bands - ctx.duneThreshold, ctx.duneShoulder);
  } else if (famille === 2) {
    const signal = cellularSignal(
      bx * ctx.invCellScale,
      by * ctx.invCellScale,
      ctx.seed + 1201,
      ctx.cellJitter,
      ctx.cellRadius,
      ctx.cellFusion
    );
    carve = ctx.cellCarve * shoulderRamp(signal + bias * 0.08, ctx.cellWidth);
  } else if (famille === 3) {
    // Grandes strates ouvertes + quelques bassins. Les deux composantes sont
    // des champs de distance monotones ; leur union conserve des fonds propres
    // là où deux formes se rejoignent.
    const large = fbm(ax * ctx.invArchLargeX, ay * ctx.invArchLargeY, ctx.seed + 1433, 2);
    const cross = fbm(ax * ctx.invArchCrossX, ay * ctx.invArchCrossY, ctx.seed + 1499, 2);
    const phase = by * ctx.archPhaseK + large * ctx.archLargeGain + cross * 0.72;
    const bands = Math.cos(phase) * 0.49 + large * 0.28 + bias * 0.22;
    const bandCarve = ctx.archCarve * shoulderRamp(bands - 0.14, ctx.archShoulder);
    const islands = sparseEllipticSignal(
      bx * ctx.invArchIsland,
      by * ctx.invArchIsland,
      ctx.seed + 1601,
      ctx.archIslandKeep,
      ctx.archIslandJitter
    );
    const islandCarve = ctx.archIslandCarve * shoulderRamp(islands, ctx.archIslandWidth);
    // `smax` et non `Math.max` : la jonction de deux formes est un point anguleux
    // du creusement, donc un minimum local — exactement la bosse enclavée que le
    // test A2 compte. L'union douce arrondit la jonction et la comble.
    carve = smax(bandCarve, islandCarve, ctx.fuseK);
  } else {
    // Silhouette bruitée — la famille `organic`, seule à posséder des chenaux.
    const rim = ctx.rimJitter > 0 ? ctx.rimJitter * fbm(bx * ctx.invRim, by * ctx.invRim, ctx.seed + 3, 2) : 0;
    const nBasin = fbm(bx * ctx.invBasin, by * ctx.invBasin, ctx.seed + 1, ctx.octavesBasin);
    carve = ctx.carveGain * shoulderRamp(nBasin + bias + rim - ctx.thresholdBasin, ctx.shoulderBasin);
    if (ctx.channelWeight > 0) carve = smax(carve, channelCarve(ctx, bx, by, bias, rim), ctx.fuseK);
  }

  // La houle est le plateau. Elle s'ÉTEINT dès que le creusement dépasse
  // CARRIER_CUTOFF : passé ce point, plus rien ne peut relever le fond d'une
  // cavité. Une atténuation en (1 − carve) changerait de signe au-delà de 1 et
  // ferait remonter les fonds profonds — c'est le mécanisme des îlots.
  //
  // Stricte monotonie : dh/dcarve = houle × extinction′ − profondeur, avec
  // |houle| ≤ SWELL_RATIO × profondeur et |extinction′| ≤ 1,5 / CARRIER_CUTOFF,
  // donc dh/dcarve ≤ (0,16 × 5 − 1) × profondeur = −0,20 × profondeur < 0.
  // Dunes et Archipel tirent déjà leur grande modulation de leur champ de
  // silhouettes. Leur réinjecter la houle comme HAUTEUR créait, sur certaines
  // variations, une petite bosse isolée au fond d'une vallée. Le bruit reste
  // utilisé en amont pour courber les formes, mais pas pour relever leur fond.
  // L'extinction ne sert alors à rien : on ne la calcule pas.
  const carrierHeight = famille === 1 || famille === 3
    ? 0
    : ctx.swellAmp * (1 - smoothstep01(carve * ctx.invCarrierCutoff));

  const h = carrierHeight * carrier + (liftValue - ctx.depth * carve);
  // LE MODE NÉGATIF N'EST PAS ÉVALUÉ ICI PAR PARESSE.
  //
  // Il l'est parce que `heightmap.js` sait le retourner après coup, sur le
  // tampon déjà construit : le flou et le champ d'occlusion étant linéaires,
  // nier la hauteur revient à nier son flou. Basculer la case ne coûte donc plus
  // une reconstruction complète. Voir `negateHeightmap`.
  return ctx.negative ? -h : h;
}
