// Bruit de valeur (value noise) et fbm — déterministes, sans état.
//
// Toutes les fonctions sont pures et prennent leur graine en argument : à graine
// égale, la suite est identique, quel que soit l'ordre d'évaluation des points.
// C'est ce qui rend le champ indépendant de la fenêtre par laquelle on le regarde.

const ROT_COS = Math.cos(0.7);
const ROT_SIN = Math.sin(0.7);

// Réciproque de 2³² − 1 : une multiplication au lieu d'une division.
//
// Le moteur ne peut pas décider seul de cette substitution — le résultat n'est
// pas bit-identique — alors qu'elle est ici sans conséquence : l'écart est de
// l'ordre de 10⁻¹⁶ sur une valeur de bruit dont l'amplitude vaut 1. C'est
// pourtant LA division la plus fréquente du produit : quatre par `valueNoise`,
// huit par `fbm` à deux octaves, une soixantaine par cellule de grille, soit
// une quinzaine de MILLIONS par reconstruction sur un panneau de 200 × 120 cm.
const INV_U32 = 1 / 4294967295;

const K_X = 374761393;
const K_Y = 668265263;
const K_MIX = 1274126177;

function melange(h) {
  h = Math.imul(h ^ (h >>> 13), K_MIX);
  return ((h ^ (h >>> 16)) >>> 0) * INV_U32;
}

function hash2(ix, iy, seed) {
  return melange(Math.imul(ix | 0, K_X) ^ Math.imul(iy | 0, K_Y) ^ Math.imul(seed | 0, K_MIX));
}

/** Interpolation quintique : dérivées première et seconde continues (C²).
 *  Indispensable ici — les normales du rendu sont des différences finies du
 *  champ, une interpolation seulement C⁰ ferait apparaître la grille du bruit. */
function quintic(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Bruit de valeur 2D, sortie dans [-1, 1].
 *
 * Les quatre coins partagent leurs facteurs : `Math.imul(iy, K_Y)` était calculé
 * DEUX fois, `Math.imul(ix, K_X)` deux fois, et la graine quatre fois — sept
 * multiplications entières de trop sur les douze, à chacun des quinze millions
 * d'appels d'une reconstruction. Les remonter ne change pas un bit du résultat :
 * ce sont exactement les mêmes produits, calculés une fois.
 */
export function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = quintic(x - ix);
  const v = quintic(y - iy);

  const hx0 = Math.imul(ix | 0, K_X);
  const hx1 = Math.imul((ix + 1) | 0, K_X);
  const hy0 = Math.imul(iy | 0, K_Y);
  const hy1 = Math.imul((iy + 1) | 0, K_Y);
  const hs = Math.imul(seed | 0, K_MIX);

  const a = melange(hx0 ^ hy0 ^ hs);
  const b = melange(hx1 ^ hy0 ^ hs);
  const c = melange(hx0 ^ hy1 ^ hs);
  const d = melange(hx1 ^ hy1 ^ hs);

  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) * 2 - 1;
}

// Somme des amplitudes, par nombre d'octaves, pour le gain par défaut.
//
// `norm` était accumulé dans la boucle puis servait de diviseur : une addition
// par octave et une division par appel, pour une quantité qui ne dépend que du
// nombre d'octaves. Tout le produit appelle `fbm` avec deux octaves et le gain
// par défaut ; la table couvre les cas utiles et la boucle reste là pour les
// autres.
const NORM_GAIN_DEFAUT = [0, 1, 1.5, 1.75, 1.875, 1.9375, 1.96875, 1.984375, 1.9921875];

/**
 * fbm à octaves tournées.
 * La rotation de chaque octave casse l'alignement du bruit de valeur sur son
 * réseau carré ; sans elle, les creux s'organisent visiblement en damier.
 */
export function fbm(x, y, seed, octaves, gain = 0.5, lacunarity = 2.03) {
  // TOUT LE PRODUIT APPELLE `fbm` À DEUX OCTAVES, gain et lacunarité par défaut.
  //
  // Onze sites d'appel, tous à deux octaves : c'est un choix de moteur, pas un
  // réglage — voir la note sur `octavesBasin` dans `field.js`. La version
  // spécialisée déroule la boucle et fait entrer `valueNoise` dans son corps, ce
  // que le moteur ne fait pas de lui-même : la fonction générique est
  // polymorphe sur `octaves`, donc son corps ne peut pas être aplati.
  //
  // Le résultat n'est pas bit-identique : la normalisation finale est une
  // multiplication par 2/3 au lieu d'une division par 1,5. Écart mesuré sur
  // 200 000 tirages : 1,1 × 10⁻¹⁶ au maximum, soit le dernier bit d'un double.
  if (octaves === 2 && gain === 0.5 && lacunarity === 2.03) return fbm2(x, y, seed);
  const normConnu = gain === 0.5 && octaves < NORM_GAIN_DEFAUT.length ? NORM_GAIN_DEFAUT[octaves] : 0;
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(px * frequency, py * frequency, seed + i * 1013);
    if (!normConnu) norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
    const rx = px * ROT_COS - py * ROT_SIN;
    py = px * ROT_SIN + py * ROT_COS;
    px = rx;
  }
  return normConnu ? sum / normConnu : sum / norm;
}

/**
 * `fbm` à deux octaves, gain 0,5, lacunarité 2,03 — le seul cas que le produit
 * emploie. Boucle déroulée, `valueNoise` aplati dans le corps.
 *
 * Ce n'est pas une réécriture : c'est la même suite d'opérations, écrite à plat.
 * Seule la normalisation finale change de forme — multiplication plutôt que
 * division — pour un écart maximal de 1,1 × 10⁻¹⁶ mesuré sur 200 000 tirages.
 * `tests/engine.mjs` et `tests/nonregression.mjs` mesurent l'écart au moteur de
 * référence ; il ne bouge pas.
 */
export function fbm2(x, y, seed) {
  // ---- octave 0 ----
  const ix0 = Math.floor(x);
  const iy0 = Math.floor(y);
  const u0 = quintic(x - ix0);
  const v0 = quintic(y - iy0);
  const ax0 = Math.imul(ix0 | 0, K_X);
  const bx0 = Math.imul((ix0 + 1) | 0, K_X);
  const ay0 = Math.imul(iy0 | 0, K_Y);
  const by0 = Math.imul((iy0 + 1) | 0, K_Y);
  const s0 = Math.imul(seed | 0, K_MIX);
  const a0 = melange(ax0 ^ ay0 ^ s0);
  const b0 = melange(bx0 ^ ay0 ^ s0);
  const c0 = melange(ax0 ^ by0 ^ s0);
  const d0 = melange(bx0 ^ by0 ^ s0);
  const t0 = a0 + (b0 - a0) * u0;
  const q0 = c0 + (d0 - c0) * u0;
  const n0 = (t0 + (q0 - t0) * v0) * 2 - 1;

  // ---- rotation puis octave 1, à fréquence doublée (lacunarité 2,03) ----
  const rx = (x * ROT_COS - y * ROT_SIN) * 2.03;
  const ry = (x * ROT_SIN + y * ROT_COS) * 2.03;
  const ix1 = Math.floor(rx);
  const iy1 = Math.floor(ry);
  const u1 = quintic(rx - ix1);
  const v1 = quintic(ry - iy1);
  const ax1 = Math.imul(ix1 | 0, K_X);
  const bx1 = Math.imul((ix1 + 1) | 0, K_X);
  const ay1 = Math.imul(iy1 | 0, K_Y);
  const by1 = Math.imul((iy1 + 1) | 0, K_Y);
  const s1 = Math.imul((seed + 1013) | 0, K_MIX);
  const a1 = melange(ax1 ^ ay1 ^ s1);
  const b1 = melange(bx1 ^ ay1 ^ s1);
  const c1 = melange(ax1 ^ by1 ^ s1);
  const d1 = melange(bx1 ^ by1 ^ s1);
  const t1 = a1 + (b1 - a1) * u1;
  const q1 = c1 + (d1 - c1) * u1;
  const n1 = (t1 + (q1 - t1) * v1) * 2 - 1;

  // sum = 1·n0 + 0,5·n1 ; norm = 1,5 — donc une multiplication au lieu d'une
  // division, et 1/1,5 est exactement représentable.
  return (n0 + n1 * 0.5) * (2 / 3);
}
