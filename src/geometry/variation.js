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
import { GEOMETRY_BOUNDS, GEOMETRY_LIMITS } from '../core/project.js';

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
  // L'INTERVALLE S'ÉLARGIT AUTOUR DU POINT DE DÉPART, IL NE S'ARRÊTE PAS DESSUS.
  //
  // `GEOMETRY_BOUNDS` décrit la plage que la variation explore d'elle-même ;
  // l'interface, elle, laisse aller plus loin — la densité va de 5 à 95 % au
  // curseur contre 18 à 72 % ici. Une valeur posée à la main hors de cet
  // intervalle était RÉFLÉCHIE, donc renvoyée très loin de son point de départ.
  // Mesuré : une densité réglée à 90 % retombait entre 50 et 57 % à la première
  // variation, et 10 % remontait entre 22 et 29 %. Le réglage de l'utilisateur
  // était effacé par un geste censé l'explorer.
  //
  // PREMIER CORRECTIF, INSUFFISANT : borner par l'union de l'intervalle canonique
  // et du point de départ. Le saut disparaissait, mais l'origine se retrouvait
  // exactement SUR le bord de l'intervalle de réflexion — donc tout tirage
  // descendant était replié vers le haut et aucun ne passait. L'espérance
  // devenait strictement supérieure à l'origine (+0,035 par variation à 0,07
  // d'amplitude), et comme la borne est recalculée depuis la nouvelle valeur au
  // tour suivant, le plancher montait à chaque clic : une densité posée à 10 %
  // rejoignait la bande canonique en deux ou trois variations et n'en ressortait
  // plus. La borne collante avait seulement changé de place.
  //
  // On élargit donc l'intervalle d'une DEMI-LARGEUR canonique de part et
  // d'autre du point de départ. À l'intérieur de la bande, rien ne change ;
  // au-delà, l'origine est strictement intérieure et la réflexion redevient
  // symétrique — la variation secoue autour de la valeur voulue, sans dérive.
  const within = (key, value, origine) => {
    const [borneBasse, borneHaute] = GEOMETRY_BOUNDS[key];
    // Une géométrie relue d'une base corrompue peut porter un NaN. Réfléchir
    // autour de NaN ne rend pas la main : toute comparaison est fausse, la
    // boucle ne corrige rien et `clamp(NaN, NaN, NaN)` ressort NaN, qui
    // contamine ensuite la heightmap entière. On retombe sur la bande canonique.
    if (!Number.isFinite(origine)) return clamp(borneBasse, borneBasse, borneHaute);
    // L'élargissement est PLAFONNÉ par les bornes admissibles.
    //
    // Sans ce plafond, l'intervalle étant recalculé depuis la valeur courante à
    // chaque tour, la suite devenait une marche aléatoire sans limite : le
    // rapport de chenaux, parti de 0,52, descendait à 0,357 en trois cents
    // variations — hors de tout ce qu'un curseur peut montrer. Le plafond rend
    // la marche bornée sans rien changer tant qu'on reste dans la bande.
    const [limiteBasse, limiteHaute] = GEOMETRY_LIMITS[key] || [borneBasse, borneHaute];
    const demiLargeur = (borneHaute - borneBasse) / 2;
    const lo = Math.max(limiteBasse, Math.min(borneBasse, origine - demiLargeur));
    const hi = Math.min(limiteHaute, Math.max(borneHaute, origine + demiLargeur));
    const span = hi - lo;
    if (span <= 0) return lo;
    let v = Number.isFinite(value) ? value : origine;
    for (let guard = 0; guard < 4 && (v < lo || v > hi); guard++) {
      if (v < lo) v = lo + (lo - v);
      if (v > hi) v = hi - (v - hi);
    }
    return clamp(v, lo, hi);
  };
  // Décalage absolu, pour les paramètres normalisés.
  const shift = (key, amount) => within(key, geometry[key] + signed() * amount, geometry[key]);
  // Décalage relatif, pour les longueurs.
  const scale = (key, ratio) => within(key, geometry[key] * (1 + signed() * ratio), geometry[key]);

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
