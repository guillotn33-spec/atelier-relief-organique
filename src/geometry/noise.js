// Bruit de valeur (value noise) et fbm — déterministes, sans état.
//
// Toutes les fonctions sont pures et prennent leur graine en argument : à graine
// égale, la suite est identique, quel que soit l'ordre d'évaluation des points.
// C'est ce qui rend le champ indépendant de la fenêtre par laquelle on le regarde.

const ROT_COS = Math.cos(0.7);
const ROT_SIN = Math.sin(0.7);

function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Interpolation quintique : dérivées première et seconde continues (C²).
 *  Indispensable ici — les normales du rendu sont des différences finies du
 *  champ, une interpolation seulement C⁰ ferait apparaître la grille du bruit. */
function quintic(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bruit de valeur 2D, sortie dans [-1, 1]. */
export function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = quintic(fx);
  const v = quintic(fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) * 2 - 1;
}

/**
 * fbm à octaves tournées.
 * La rotation de chaque octave casse l'alignement du bruit de valeur sur son
 * réseau carré ; sans elle, les creux s'organisent visiblement en damier.
 */
export function fbm(x, y, seed, octaves, gain = 0.5, lacunarity = 2.03) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(px * frequency, py * frequency, seed + i * 1013);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
    const rx = px * ROT_COS - py * ROT_SIN;
    py = px * ROT_SIN + py * ROT_COS;
    px = rx;
  }
  return sum / norm;
}
