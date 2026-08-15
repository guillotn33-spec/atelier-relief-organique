// Variations bornées (§4).
//
// « Nouvelle variation » doit produire une géométrie réellement différente tout
// en restant reconnaissable comme DESCENDANTE du design courant — pas un nouveau
// préréglage sans rapport.
//
// Le moyen : on ne change pas la graine du bruit. On déplace la fenêtre dans le
// champ (le motif reste de la même famille, mais ce n'est plus le même endroit)
// et on secoue modérément les paramètres. Changer la graine donnerait un
// étranger ; ne bouger que les paramètres donnerait le même dessin retouché.
//
// Aucune donnée de lumière, de matière, de caméra ou de présentation n'est
// touchée : la variation ne connaît que le bloc `geometry`.

import { clamp, mulberry32 } from '../core/math.js';
import { GEOMETRY_BOUNDS } from '../core/project.js';

function mixSeed(value) {
  let h = (value | 0) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Variation déterministe : même géométrie de départ et même `variationSeed`
 * donnent toujours exactement le même résultat.
 */
export function nextVariation(geometry) {
  const variationSeed = mixSeed(geometry.variationSeed || 0);
  const rng = mulberry32(variationSeed);
  const signed = () => rng() * 2 - 1;

  // Aux bornes on RÉFLÉCHIT, on n'écrête pas.
  //
  // Écrêter rend les bornes collantes : une suite de variations est une marche
  // aléatoire, elle finit par atteindre une limite et y reste, puisque la moitié
  // des tirages suivants la repoussent contre le mur. Après une dizaine de
  // variations, l'allongement et l'irrégularité se retrouvaient bloqués à 1,00 et
  // 0,00 — le dessin dégénérait au lieu de dériver. La réflexion renvoie la
  // valeur vers l'intérieur et garde la suite vivante.
  const within = (key, value) => {
    const [lo, hi] = GEOMETRY_BOUNDS[key];
    const span = hi - lo;
    if (span <= 0) return lo;
    let v = value;
    for (let guard = 0; guard < 4 && (v < lo || v > hi); guard++) {
      if (v < lo) v = lo + (lo - v);
      if (v > hi) v = hi - (v - hi);
    }
    return clamp(v, lo, hi);
  };
  // Décalage absolu, pour les paramètres normalisés.
  const shift = (key, amount) => within(key, geometry[key] + signed() * amount);
  // Décalage relatif, pour les longueurs.
  const scale = (key, ratio) => within(key, geometry[key] * (1 + signed() * ratio));

  // Le déplacement dans le champ est proportionnel à la taille des cavités :
  // il faut se déplacer d'environ une cavité pour changer la composition.
  const travel = geometry.basinScaleCm * 1.15;

  return {
    ...geometry,
    variationSeed,
    domainOffsetXCm: geometry.domainOffsetXCm + signed() * travel,
    domainOffsetYCm: geometry.domainOffsetYCm + signed() * travel,

    basinScaleCm: scale('basinScaleCm', 0.16), // dimensions
    channelRatio: shift('channelRatio', 0.09), // connexions entre formes
    channelWeight: shift('channelWeight', 0.14),
    density: shift('density', 0.07),
    elongation: shift('elongation', 0.13), // allongement
    orientationDeg: wrapAngle(geometry.orientationDeg + signed() * 20), // orientation
    warpAmount: shift('warpAmount', 0.13), // courbures
    irregularity: shift('irregularity', 0.14), // irrégularité
    depth: shift('depth', 0.07), // profondeur locale
    wave: shift('wave', 0.11), // ondulations
    shoulder: shift('shoulder', 0.09),
    fuse: shift('fuse', 0.11),

    // Intentionnellement inchangés : `seed` (l'identité du bruit, donc la famille),
    // `softness` (une finition, pas une composition) et `negative` (un mode).
  };
}

function wrapAngle(deg) {
  let value = deg % 180;
  if (value < 0) value += 180;
  return value;
}
