// Brosse de sculpture — travaille en centimètres sur le calque ancré (§6, amendement D).
//
// La brosse est elliptique et orientable par construction : à `elongation = 0` elle
// est un disque et reproduit exactement le comportement de la version 1.
//
// L'en-tête annonçait jusqu'au lot 7 que l'interface de ces paramètres était
// « branchée au lot 3 ». Elle ne l'a jamais été : `brushElongation` et
// `brushAngle` existaient dans le modèle, `stampAt` les transmettait, et rien
// ne les écrivait — la brosse est restée un disque pendant six lots. Les
// commandes existent depuis le lot 7 (§6), avec un aperçu qui dessine cette
// ellipse-ci et non une illustration.

import { clamp } from '../core/math.js';

const TOOLS = new Set(['warp', 'dig', 'raise', 'smooth', 'erase']);

// Gain de dose du creusement/bombage, repris tel quel de la version 1.
// La v1 l'écrivait en clair sous la forme du littéral `1.6`, au milieu d'un
// fichier où `1.6` désignait partout ailleurs le rapport d'image. Le nommer
// interdit de le confondre avec un rapport lors d'une relecture ou d'un audit.
const DOSE_GAIN = 1.6;

// Rapport long/court de l'ellipse à l'allongement maximal (§6). Cinq contre un
// donne un trait franchement directionnel sans devenir une lame : au-delà, le
// petit axe passe sous la maille du calque sur une brosse fine et le trait se
// met à crénerer.
export const MAX_BRUSH_ASPECT = 5;

/**
 * Demi-axes de l'ellipse, en cm, pour un rayon et un allongement donnés.
 *
 * L'AIRE EST CONSERVÉE : `a × b = radiusCm²` quel que soit l'allongement. La
 * première écriture — `a = r·s`, `b = r/√s` avec `s = 1 + 2,2·e` — faisait
 * croître l'aire de 79 % entre le disque et l'allongement maximal, alors que le
 * commentaire annonçait le contraire. La dose déposée par coup aurait suivi, et
 * allonger la brosse aurait creusé plus fort sans que rien ne le dise.
 *
 * Le rapport vaut exactement `1 + e·(MAX_BRUSH_ASPECT − 1)` : « allongement
 * 50 % » se lit donc « ellipse 3 pour 1 », ce que l'interface affiche.
 *
 * Exporté parce que l'aperçu de l'interface doit dessiner LA MÊME ellipse que
 * celle qui creuse — la redessiner à l'estime serait un mensonge à l'écran.
 */
export function brushAxes(radiusCm, elongation = 0) {
  const aspect = 1 + clamp(elongation, 0, 1) * (MAX_BRUSH_ASPECT - 1);
  const root = Math.sqrt(aspect);
  return { a: radiusCm * root, b: radiusCm / root, aspect };
}

function smoothCell(field, index, cols, rows, factor) {
  const x = index % cols;
  const y = (index / cols) | 0;
  const xl = Math.max(0, x - 1);
  const xr = Math.min(cols - 1, x + 1);
  const yu = Math.max(0, y - 1);
  const yd = Math.min(rows - 1, y + 1);
  const avg = (field[y * cols + xl] + field[y * cols + xr] + field[yu * cols + x] + field[yd * cols + x]) * 0.25;
  field[index] += (avg - field[index]) * factor;
}

/**
 * Applique un coup de brosse. Toutes les longueurs sont en cm.
 * Retourne le rectangle sali en cm, ou null si rien n'a été écrit.
 */
export function stamp(layer, options) {
  const {
    tool,
    xCm,
    yCm,
    dxCm = 0,
    dyCm = 0,
    radiusCm,
    strength: rawStrength,
    pressure = 1,
    elongation = 0,
    angleDeg = 0,
    first = false,
  } = options;

  if (!TOOLS.has(tool) || radiusCm <= 0) return null;

  const strength = rawStrength * pressure;
  const travelCm = Math.hypot(dxCm, dyCm);
  const dose = Math.min(0.12, (travelCm / radiusCm) * 0.96 + (first ? 0.02 : 0));
  if (tool !== 'warp' && dose === 0) return null;

  // Ellipse : `a` s'allonge, `b` se resserre, l'aire est conservée exactement.
  const { a, b } = brushAxes(radiusCm, elongation);
  const theta = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const reach = Math.max(a, b);

  const { cols, rows, cellCm } = layer;
  const gx0 = Math.max(0, Math.floor(layer.colOf(xCm - reach)));
  const gx1 = Math.min(cols - 1, Math.ceil(layer.colOf(xCm + reach)));
  const gy0 = Math.max(0, Math.floor(layer.rowOf(yCm - reach)));
  const gy1 = Math.min(rows - 1, Math.ceil(layer.rowOf(yCm + reach)));
  if (gx1 < gx0 || gy1 < gy0) return null;

  const limit = layer.warpLimitCm;
  let wrote = false;

  for (let gy = gy0; gy <= gy1; gy++) {
    const py = layer.originYCm + gy * cellCm - yCm;
    for (let gx = gx0; gx <= gx1; gx++) {
      const px = layer.originXCm + gx * cellCm - xCm;
      const rx = ca * px + sa * py;
      const ry = -sa * px + ca * py;
      const q = (rx * rx) / (a * a) + (ry * ry) / (b * b);
      if (q >= 1) continue;
      const fall = (1 - q) * (1 - q);
      const i = gy * cols + gx;
      wrote = true;

      if (tool === 'warp') {
        layer.warpX[i] = clamp(layer.warpX[i] - dxCm * strength * 1.5 * fall, -limit, limit);
        layer.warpY[i] = clamp(layer.warpY[i] - dyCm * strength * 1.5 * fall, -limit, limit);
      } else if (tool === 'dig') {
        layer.height[i] = clamp(layer.height[i] - strength * dose * DOSE_GAIN * fall, -1.4, 1.2);
      } else if (tool === 'raise') {
        layer.height[i] = clamp(layer.height[i] + strength * dose * DOSE_GAIN * fall, -1.4, 1.2);
      } else if (tool === 'smooth') {
        const f = Math.min(1, strength * dose * 7 * fall);
        smoothCell(layer.warpX, i, cols, rows, f);
        smoothCell(layer.warpY, i, cols, rows, f);
        smoothCell(layer.height, i, cols, rows, f);
      } else if (tool === 'erase') {
        const f = 1 - Math.min(0.9, strength * dose * 6 * fall);
        layer.warpX[i] *= f;
        layer.warpY[i] *= f;
        layer.height[i] *= f;
      }
    }
  }

  if (!wrote) return null;
  if (tool !== 'erase') layer.active = true;

  return { x0: xCm - reach, y0: yCm - reach, x1: xCm + reach, y1: yCm + reach };
}
