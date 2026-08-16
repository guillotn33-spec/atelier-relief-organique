// Heightmap canonique — LA source de vérité du relief (§9).
//
// L'audit du lot 0 a établi que la version 1 n'avait pas de heightmap : elle
// recalculait un champ à la résolution du rendu du moment puis le jetait. Or §4
// (instantané de base), §5 (négatif non destructif) et §17 (export image)
// exigent tous « exactement » le même relief. Cette grille est cet objet.
//
// Elle a aussi servi au maillage 3D et à l'export USDZ/OBJ, retirés du produit :
// l'aperçu et le PNG exporté restent les deux consommateurs, et ils partagent
// toujours cette grille — c'est ce qui garantit qu'ils montrent le même relief.
//
// Propriétés tenues :
//   • cellules CARRÉES en centimètres — c'est ce qui supprime toute notion de
//     rapport d'image dans le calcul du relief et des normales ;
//   • grille centrée sur la toile, débordant légèrement, indépendante de la
//     résolution d'affichage comme de la résolution d'export ;
//   • unités de champ brutes (identiques à la v1) — la conversion vers des
//     centimètres sur l'axe Z se fait chez le consommateur qui en a besoin.

import { blurFraction, evalField as evalLegacyField, makeFieldContext as makeLegacyContext } from './legacyField.js';
import { evalField as evalOrganicField, makeFieldContext as makeOrganicContext } from './field.js';

const LONG_TARGET = 640; // échantillons sur le grand côté
const MIN_SHORT = 40; // plancher sur le petit côté (panneaux très allongés)
const MAX_CELLS = 700000; // plafond mémoire : ~2,8 Mo par Float32Array
const MAX_BLUR_CELLS = 32; // plafond de coût du flou (voir blurRadiusCells)

export function gridFor(widthCm, heightCm, quality = 1) {
  const long = Math.max(widthCm, heightCm);
  const short = Math.min(widthCm, heightCm);
  let cellCm = long / (LONG_TARGET * quality);
  if (short / cellCm < MIN_SHORT * quality) cellCm = short / (MIN_SHORT * quality);

  let cols = Math.ceil(widthCm / cellCm) + 1;
  let rows = Math.ceil(heightCm / cellCm) + 1;
  for (let guard = 0; guard < 4 && cols * rows > MAX_CELLS; guard++) {
    cellCm *= Math.sqrt((cols * rows) / MAX_CELLS) * 1.01;
    cols = Math.ceil(widthCm / cellCm) + 1;
    rows = Math.ceil(heightCm / cellCm) + 1;
  }

  return {
    cols,
    rows,
    cellCm,
    originXCm: -((cols - 1) * cellCm) / 2,
    originYCm: -((rows - 1) * cellCm) / 2,
  };
}

export class Heightmap {
  constructor(grid) {
    Object.assign(this, grid);
    const n = this.cols * this.rows;
    this.h = new Float32Array(n); // relief final, après adoucissement
    this.raw = new Float32Array(n); // avant adoucissement, réutilisé par les patchs
    this.sum = 0;
    this.min = 0;
    this.max = 0;
  }

  get mean() {
    return this.sum / (this.cols * this.rows);
  }

  xCmAt(col) {
    return this.originXCm + col * this.cellCm;
  }

  yCmAt(row) {
    return this.originYCm + row * this.cellCm;
  }

  colAt(xCm) {
    return (xCm - this.originXCm) / this.cellCm;
  }

  rowAt(yCm) {
    return (yCm - this.originYCm) / this.cellCm;
  }
}

/** Flou gaussien séparable sur une tuile autonome (bords répliqués), sémantique v1. */
function blurTile(src, dst, tileW, tileH, radius) {
  const kernelRadius = Math.max(1, Math.round(radius));
  const sigma = Math.max(1, radius / 2);
  const kernel = new Float32Array(kernelRadius * 2 + 1);
  let total = 0;
  for (let i = -kernelRadius; i <= kernelRadius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + kernelRadius] = w;
    total += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;

  const tmp = new Float32Array(tileW * tileH);
  for (let y = 0; y < tileH; y++) {
    const row = y * tileW;
    for (let x = 0; x < tileW; x++) {
      let acc = 0;
      for (let t = -kernelRadius; t <= kernelRadius; t++) {
        const sx = x + t < 0 ? 0 : x + t >= tileW ? tileW - 1 : x + t;
        acc += src[row + sx] * kernel[t + kernelRadius];
      }
      tmp[row + x] = acc;
    }
  }
  for (let x = 0; x < tileW; x++) {
    for (let y = 0; y < tileH; y++) {
      let acc = 0;
      for (let t = -kernelRadius; t <= kernelRadius; t++) {
        const sy = y + t < 0 ? 0 : y + t >= tileH ? tileH - 1 : y + t;
        acc += tmp[sy * tileW + x] * kernel[t + kernelRadius];
      }
      dst[y * tileW + x] = acc;
    }
  }
  return kernelRadius;
}

export function isLegacyEngine(project) {
  return project.geometry.engine === 'legacy-v1';
}

/**
 * Rayon d'adoucissement, en CELLULES.
 *
 * Pour `organic-v2`, la douceur est une longueur PHYSIQUE en centimètres. C'est
 * la seule définition compatible avec un champ ancré en cm : si le flou restait
 * une fraction de la largeur de la toile, élargir le panneau adoucirait le
 * relief déjà en place, et « agrandir ne déplace rien » serait faux.
 *
 * Le rayon est plafonné : sur un très petit panneau, la cellule est minuscule et
 * un flou de plusieurs centimètres coûterait un noyau de plusieurs centaines de
 * taps. Au-delà du plafond, l'adoucissement physique sature — c'est assumé.
 */
export function blurRadiusCells(project, grid) {
  if (isLegacyEngine(project)) {
    return blurFraction(project.geometry) * (project.widthCm / grid.cellCm);
  }
  const blurCm = 0.3 + project.geometry.softness * 4.0;
  return Math.min(MAX_BLUR_CELLS, blurCm / grid.cellCm);
}

function makeContextFor(project) {
  return isLegacyEngine(project)
    ? makeLegacyContext(project.geometry, project.widthCm / project.heightCm)
    : makeOrganicContext(project.geometry);
}

/** Évalue le champ brut sur un rectangle de cellules [c0,c1[ × [r0,r1[. */
function fillRaw(target, targetCols, hm, project, layer, ctx, c0, r0, c1, r1, options) {
  const useSculpt = !!layer && layer.active;
  const legacy = isLegacyEngine(project);
  const invW = 1 / project.widthCm;
  const invH = 1 / project.heightCm;
  const halfW = project.widthCm / 2;
  const halfH = project.heightCm / 2;
  const tPhase = options.tPhase || 0;
  const withSwell = options.withSwell !== false;

  for (let r = r0; r < r1; r++) {
    const yCm = hm.yCmAt(r);
    const v = (yCm + halfH) * invH;
    const out = (r - r0) * targetCols - c0;
    for (let c = c0; c < c1; c++) {
      const xCm = hm.xCmAt(c);
      let warpXCm = 0;
      let warpYCm = 0;
      let lift = 0;
      if (useSculpt) {
        warpXCm = layer.sample(layer.warpX, xCm, yCm);
        warpYCm = layer.sample(layer.warpY, xCm, yCm);
        lift = layer.sample(layer.height, xCm, yCm);
      }
      if (legacy) {
        // Le moteur v1 raisonne en u/v ; la conversion se fait ici, et nulle part ailleurs.
        const u = (xCm + halfW) * invW;
        target[out + c] = evalLegacyField(ctx, u, v, warpXCm * invW, warpYCm * invH, lift, tPhase, withSwell);
      } else {
        // Le moteur v2 raisonne directement en centimètres absolus.
        target[out + c] = evalOrganicField(ctx, xCm, yCm, warpXCm, warpYCm, lift);
      }
    }
  }
}

function recomputeStats(hm) {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  const { h } = hm;
  for (let i = 0; i < h.length; i++) {
    const value = h[i];
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  hm.sum = sum;
  hm.min = min;
  hm.max = max;
}

/**
 * Construction complète. Retourne une Heightmap prête à consommer.
 * `quality < 1` échantillonne le MÊME champ sur une grille plus grossière — le
 * relief est identique, seule sa finesse d'échantillonnage baisse (animation).
 * `carrierPhase` fait défiler la houle porteuse (moteur v2 uniquement).
 */
export function buildHeightmap(project, layer, options = {}) {
  const { quality = 1, carrierPhase = 0 } = options;
  const grid = gridFor(project.widthCm, project.heightCm, quality);
  const hm = new Heightmap(grid);
  hm.ctx = makeContextFor(project);
  if (!isLegacyEngine(project)) hm.ctx.carrierPhase = carrierPhase;
  hm.blurRadius = blurRadiusCells(project, grid);

  fillRaw(hm.raw, hm.cols, hm, project, layer, hm.ctx, 0, 0, hm.cols, hm.rows, options);
  blurTile(hm.raw, hm.h, hm.cols, hm.rows, hm.blurRadius);
  recomputeStats(hm);
  hm.aoRadius = aoRadiusCells(project, grid);
  hm.ao = buildAoField(hm, hm.aoRadius);
  return hm;
}

/**
 * Met à jour la heightmap sur un rectangle en cm (trait de sculpture en cours).
 * Retourne le rectangle de cellules réellement réécrit, ou null.
 */
export function updateHeightmapRect(hm, project, layer, rectCm, options = {}) {
  const K = Math.max(1, Math.round(hm.blurRadius)) + 1;
  const c0 = Math.max(0, Math.floor(hm.colAt(rectCm.x0)));
  const r0 = Math.max(0, Math.floor(hm.rowAt(rectCm.y0)));
  const c1 = Math.min(hm.cols, Math.ceil(hm.colAt(rectCm.x1)) + 1);
  const r1 = Math.min(hm.rows, Math.ceil(hm.rowAt(rectCm.y1)) + 1);
  if (c1 <= c0 || r1 <= r0) return null;

  const ec0 = Math.max(0, c0 - K);
  const er0 = Math.max(0, r0 - K);
  const ec1 = Math.min(hm.cols, c1 + K);
  const er1 = Math.min(hm.rows, r1 + K);
  const tileW = ec1 - ec0;
  const tileH = er1 - er0;

  const rawTile = new Float32Array(tileW * tileH);
  const blurTileBuf = new Float32Array(tileW * tileH);
  fillRaw(rawTile, tileW, hm, project, layer, hm.ctx, ec0, er0, ec1, er1, options);
  blurTile(rawTile, blurTileBuf, tileW, tileH, hm.blurRadius);

  // Seule la zone intérieure est exacte : le flou de la tuile y a vu tous ses voisins.
  for (let r = r0; r < r1; r++) {
    const dst = r * hm.cols;
    const src = (r - er0) * tileW - ec0;
    for (let c = c0; c < c1; c++) {
      hm.h[dst + c] = blurTileBuf[src + c];
      hm.raw[dst + c] = rawTile[src + c];
    }
  }
  // Les bornes sont RECALCULÉES sur toute la grille, pas mises à jour au fil de
  // l'eau. `sum` se maintient par différence, `min` et `max` non : un point qui
  // quittait l'extrême obligeait de toute façon à tout relire.
  //
  // Ne pas le faire est un défaut VISIBLE : `shadeParams` reçoit
  // `hm.max − hm.min` comme amplitude, et c'est elle qui règle la profondeur
  // d'occlusion. Après un trait « bomber », les bornes stockées restaient celles
  // de la construction et les fonds de cavité s'éclaircissaient de 8,9 %.
  // (Le défaut a d'abord été trouvé sur le maillage exporté, qui sortait à
  // 6,98 cm pour 6 cm déclarés ; l'export 3D a été retiré du produit depuis,
  // l'invariant est resté.)
  recomputeStats(hm);
  // La surface de référence dépend du relief : la sculpture la déplace aussi.
  // Elle est très basse fréquence, donc peu coûteuse à refaire en entier.
  hm.ao = buildAoField(hm, hm.aoRadius || 24);

  return { c0, r0, c1, r1 };
}


// ---- Surface de référence locale (occlusion) ----
//
// Un flou de très grand rayon donne la surface autour de laquelle le relief
// ondule. L'écart entre la hauteur et cette surface est la PROFONDEUR LOCALE :
// c'est elle qui autorise un fond de cavité presque noir sans toucher aux
// plateaux (§7).
//
// Ce flou est calculé sur une grille DÉCIMÉE. Un rayon de 130 cellules sur la
// grille pleine coûterait un noyau de 261 taps par passe ; décimé d'un facteur
// k, il tombe à ~13 taps sur k² fois moins de cellules. Le champ recherché étant
// par définition très basse fréquence, la décimation ne lui retire rien.

const AO_TARGET_RADIUS = 6; // rayon visé sur la grille décimée

// Nombre minimal de cellules sur chaque axe de la grille décimée.
//
// Sans ce plancher, un panneau étroit avec de grandes cavités produisait une
// décimation telle que la grille tombait à DEUX lignes, dont la seconde ne
// couvrait aucune cellule réelle : le repli `n ? sum / n : 0` la laissait à
// zéro et le flou la mélangeait ensuite à la vraie surface. Mesuré, écart entre
// la moyenne de la référence et celle du relief : 25,9 % de l'amplitude sur un
// 200 × 30 à grandes cavités, 14,6 % sur un 300 × 18. Tout le terme d'occlusion
// de `shade.js` repose sur ce champ.
//
// Exporté pour que `tests/heightmap.mjs` puisse éprouver l'invariant plutôt que
// de recopier la valeur.
export const AO_MIN_CELLS = 6;

export function buildAoField(hm, requestedRadiusCells) {
  // Un rayon de référence plus grand que le panneau n'a pas de sens : la
  // référence doit alors dégénérer vers la moyenne du panneau. Sans ce
  // plafond, le flou à réplication de bord la tirait vers les valeurs de
  // bordure — 12,3 % d'écart mesuré sur un carré de 120 cm à grandes cavités.
  const radiusCells = Math.min(requestedRadiusCells, Math.min(hm.cols, hm.rows) / 2);

  // La décimation est bornée par la taille de la grille, pas seulement par le
  // rayon voulu : mieux vaut un noyau plus large sur une grille correcte qu'une
  // grille dégénérée.
  const kMax = Math.max(1, Math.floor(Math.min(hm.cols, hm.rows) / AO_MIN_CELLS));
  const k = Math.min(kMax, Math.max(1, Math.ceil(radiusCells / AO_TARGET_RADIUS)));
  const cols = Math.ceil(hm.cols / k);
  const rows = Math.ceil(hm.rows / k);
  const small = new Float32Array(cols * rows);

  // Moyenne de bloc plutôt qu'un simple prélèvement : sans elle, le repliement
  // ferait scintiller l'occlusion d'une reconstruction à l'autre.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let n = 0;
      for (let dr = 0; dr < k; dr++) {
        const rr = r * k + dr;
        if (rr >= hm.rows) break;
        for (let dc = 0; dc < k; dc++) {
          const cc = c * k + dc;
          if (cc >= hm.cols) break;
          sum += hm.h[rr * hm.cols + cc];
          n++;
        }
      }
      small[r * cols + c] = n ? sum / n : 0;
    }
  }

  const blurred = new Float32Array(cols * rows);
  blurTile(small, blurred, cols, rows, Math.max(1, radiusCells / k));

  return {
    cols,
    rows,
    cellCm: hm.cellCm * k,
    originXCm: hm.originXCm + ((k - 1) * hm.cellCm) / 2,
    originYCm: hm.originYCm + ((k - 1) * hm.cellCm) / 2,
    data: blurred,
  };
}

/** Prélèvement bilinéaire de la surface de référence, en centimètres. */
export function sampleAo(ao, xCm, yCm) {
  const gx = (xCm - ao.originXCm) / ao.cellCm;
  const gy = (yCm - ao.originYCm) / ao.cellCm;
  const x0 = Math.min(ao.cols - 1, Math.max(0, Math.floor(gx)));
  const y0 = Math.min(ao.rows - 1, Math.max(0, Math.floor(gy)));
  const x1 = Math.min(ao.cols - 1, x0 + 1);
  const y1 = Math.min(ao.rows - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, gx - x0));
  const fy = Math.min(1, Math.max(0, gy - y0));
  const top = ao.data[y0 * ao.cols + x0] * (1 - fx) + ao.data[y0 * ao.cols + x1] * fx;
  const bottom = ao.data[y1 * ao.cols + x0] * (1 - fx) + ao.data[y1 * ao.cols + x1] * fx;
  return top + (bottom - top) * fy;
}

/**
 * Rayon d'occlusion, en cellules.
 *
 * Il doit être NETTEMENT plus grand qu'une cavité — 2,5 fois ici. À 0,8 fois, la
 * surface de référence épousait les cavités : l'écart y était le même partout et
 * l'occlusion devenait un masque binaire, l'image tombait en aplats noirs à bords
 * durs. Plus large, la référence donne le niveau général du panneau et l'écart
 * suit la profondeur réelle, en dégradé.
 */
export function aoRadiusCells(project, grid) {
  const basin = project.geometry.basinScaleCm || 40;
  const aoCm = Math.min(220, Math.max(12, basin * 2.5));
  return aoCm / grid.cellCm;
}

// ---- Rééchantillonnage vers la résolution de sortie ----
// Catmull-Rom séparable : C1, donc pas de facettes dans les normales calculées
// ensuite par différences finies. 8 prélèvements par pixel, contre ~10⁸ appels
// transcendantaux par rendu dans la version 1 : le champ n'est plus jamais évalué
// dans une boucle de pixels.

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Prélèvement ponctuel bicubique, en cm. Même interpolant que `resampleTo`. */
export function sampleHeight(hm, xCm, yCm) {
  const gc = hm.colAt(xCm);
  const gr = hm.rowAt(yCm);
  const bc = Math.floor(gc);
  const br = Math.floor(gr);
  const tc = gc - bc;
  const tr = gr - br;
  const maxCol = hm.cols - 1;
  const maxRow = hm.rows - 1;
  const cx = [
    Math.min(maxCol, Math.max(0, bc - 1)),
    Math.min(maxCol, Math.max(0, bc)),
    Math.min(maxCol, Math.max(0, bc + 1)),
    Math.min(maxCol, Math.max(0, bc + 2)),
  ];
  let p0 = 0;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let n = 0; n < 4; n++) {
    const row = Math.min(maxRow, Math.max(0, br - 1 + n)) * hm.cols;
    const value = catmull(hm.h[row + cx[0]], hm.h[row + cx[1]], hm.h[row + cx[2]], hm.h[row + cx[3]], tc);
    if (n === 0) p0 = value;
    else if (n === 1) p1 = value;
    else if (n === 2) p2 = value;
    else p3 = value;
  }
  return catmull(p0, p1, p2, p3, tr);
}

/**
 * Projette la heightmap sur une grille de sortie couvrant EXACTEMENT la toile.
 * out[py * outW + px] correspond au pixel (px, py) du rendu.
 */
export function resampleTo(hm, project, outW, outH, out = new Float32Array(outW * outH)) {
  const halfW = project.widthCm / 2;
  const halfH = project.heightCm / 2;
  const maxCol = hm.cols - 1;
  const maxRow = hm.rows - 1;

  // Poids horizontaux précalculés une fois par colonne de sortie.
  const colBase = new Int32Array(outW);
  const colFrac = new Float32Array(outW);
  for (let px = 0; px < outW; px++) {
    const xCm = -halfW + (outW === 1 ? 0 : (px / (outW - 1)) * project.widthCm);
    const g = hm.colAt(xCm);
    const base = Math.floor(g);
    colBase[px] = base;
    colFrac[px] = g - base;
  }

  const intermediate = new Float32Array(outW * hm.rows);
  for (let r = 0; r < hm.rows; r++) {
    const row = r * hm.cols;
    const dst = r * outW;
    for (let px = 0; px < outW; px++) {
      const b = colBase[px];
      const i0 = row + Math.min(maxCol, Math.max(0, b - 1));
      const i1 = row + Math.min(maxCol, Math.max(0, b));
      const i2 = row + Math.min(maxCol, Math.max(0, b + 1));
      const i3 = row + Math.min(maxCol, Math.max(0, b + 2));
      intermediate[dst + px] = catmull(hm.h[i0], hm.h[i1], hm.h[i2], hm.h[i3], colFrac[px]);
    }
  }

  for (let py = 0; py < outH; py++) {
    const yCm = -halfH + (outH === 1 ? 0 : (py / (outH - 1)) * project.heightCm);
    const g = hm.rowAt(yCm);
    const base = Math.floor(g);
    const t = g - base;
    const r0 = Math.min(maxRow, Math.max(0, base - 1)) * outW;
    const r1 = Math.min(maxRow, Math.max(0, base)) * outW;
    const r2 = Math.min(maxRow, Math.max(0, base + 1)) * outW;
    const r3 = Math.min(maxRow, Math.max(0, base + 2)) * outW;
    const dst = py * outW;
    for (let px = 0; px < outW; px++) {
      out[dst + px] = catmull(intermediate[r0 + px], intermediate[r1 + px], intermediate[r2 + px], intermediate[r3 + px], t);
    }
  }

  return out;
}
