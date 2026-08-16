// Animation de l'ondulation — option (b) arbitrée au lot 3.
//
// Le lot 3 a mesuré que 74 % du coût d'une image venait de la reconstruction
// complète de la heightmap. Or le champ se décompose en h = A·houle + B, où A
// et B sont STATIQUES (voir `evalParts` dans field.js) : seule la houle dépend
// du temps. Par image il ne reste donc que deux évaluations de bruit par
// cellule, au lieu d'une quinzaine.
//
// Le flou complique le cache, et c'est le point qui devait être mesuré :
//   • EXACT       — h = flou(A·houle) + flou(B). flou(B) se met en cache une
//                   fois, mais flou(A·houle) doit être refait à chaque image.
//   • APPROCHÉ    — h = houle·flou(A) + flou(B). Plus aucun flou par image, au
//                   prix d'une approximation : elle suppose la houle constante
//                   sur le rayon de flou. La houle étant très basse fréquence
//                   devant ce rayon, l'erreur devrait être faible.
//
// Les deux sont implémentés pour que l'écart et le gain soient MESURÉS, pas
// supposés. Voir `tests/animation.mjs`.

import { Heightmap, aoRadiusCells, blurRadiusCells, buildAoField, gridFor } from './heightmap.js';
import { evalParts, makeFieldContext } from './field.js';
import { fbm } from './noise.js';

export class SwellAnimator {
  constructor(project, layer, quality = 0.45) {
    this.project = project;
    this.quality = quality;
    this.negative = !!project.geometry.negative;

    const grid = gridFor(project.widthCm, project.heightCm, quality);
    this.hm = new Heightmap(grid);
    this.hm.blurRadius = blurRadiusCells(project, grid);
    this.hm.aoRadius = aoRadiusCells(project, grid);
    this.ctx = makeFieldContext(project.geometry);
    this.seed = this.ctx.seed + 523;

    const n = grid.cols * grid.rows;
    this.a = new Float32Array(n);
    this.b = new Float32Array(n);
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.blurA = new Float32Array(n);
    this.blurB = new Float32Array(n);
    this.scratch = new Float32Array(n);
    this.tmp = new Float32Array(n); // tampon du flou, alloué une seule fois

    const useSculpt = !!layer && layer.active;
    for (let r = 0; r < grid.rows; r++) {
      const yCm = this.hm.yCmAt(r);
      for (let c = 0; c < grid.cols; c++) {
        const xCm = this.hm.xCmAt(c);
        let wx = 0;
        let wy = 0;
        let lift = 0;
        if (useSculpt) {
          wx = layer.sample(layer.warpX, xCm, yCm);
          wy = layer.sample(layer.warpY, xCm, yCm);
          lift = layer.sample(layer.height, xCm, yCm);
        }
        const parts = evalParts(this.ctx, xCm, yCm, wx, wy, lift);
        const i = r * grid.cols + c;
        this.a[i] = parts.a;
        this.b[i] = parts.b;
        this.sx[i] = parts.sx;
        this.sy[i] = parts.sy;
      }
    }

    blurInto(this.a, this.blurA, grid.cols, grid.rows, this.hm.blurRadius, this.scratch);
    blurInto(this.b, this.blurB, grid.cols, grid.rows, this.hm.blurRadius, this.scratch);
  }

  /** Produit la heightmap de l'image courante. Retourne `this.hm`. */
  frame(phase, { approximate = false } = {}) {
    const { cols, rows } = this.hm;
    const n = cols * rows;
    const target = this.hm.h;

    if (approximate) {
      for (let i = 0; i < n; i++) {
        const carrier = fbm(this.sx[i] + phase, this.sy[i], this.seed, 2);
        const value = this.blurA[i] * carrier + this.blurB[i];
        target[i] = this.negative ? -value : value;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const carrier = fbm(this.sx[i] + phase, this.sy[i], this.seed, 2);
        this.scratch[i] = this.a[i] * carrier;
      }
      blurInto(this.scratch, target, cols, rows, this.hm.blurRadius, this.tmp);
      for (let i = 0; i < n; i++) {
        const value = target[i] + this.blurB[i];
        target[i] = this.negative ? -value : value;
      }
    }

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = target[i];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    this.hm.sum = sum;
    this.hm.min = min;
    this.hm.max = max;
    this.hm.ao = buildAoField(this.hm, this.hm.aoRadius);
    return this.hm;
  }
}

/** Flou gaussien séparable, avec tampon intermédiaire fourni par l'appelant. */
function blurInto(src, dst, w, h, radius, tmpBuffer) {
  const kernelRadius = Math.max(1, Math.round(radius));
  const sigma = Math.max(1, radius / 2);
  const kernel = new Float32Array(kernelRadius * 2 + 1);
  let total = 0;
  for (let i = -kernelRadius; i <= kernelRadius; i++) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + kernelRadius] = weight;
    total += weight;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;

  const tmp = tmpBuffer && tmpBuffer.length === w * h ? tmpBuffer : new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = -kernelRadius; t <= kernelRadius; t++) {
        const sx = x + t < 0 ? 0 : x + t >= w ? w - 1 : x + t;
        acc += src[row + sx] * kernel[t + kernelRadius];
      }
      tmp[row + x] = acc;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let t = -kernelRadius; t <= kernelRadius; t++) {
        const sy = y + t < 0 ? 0 : y + t >= h ? h - 1 : y + t;
        acc += tmp[sy * w + x] * kernel[t + kernelRadius];
      }
      dst[y * w + x] = acc;
    }
  }
}
