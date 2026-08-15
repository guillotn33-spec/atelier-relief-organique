// Calque de sculpture — ancré en CENTIMÈTRES (amendement D).
//
// L'origine du repère est le centre de la toile ; x vers la droite, y vers le bas.
// La toile occupe x ∈ [-W/2, +W/2] et y ∈ [-H/2, +H/2]. La grille de sculpture est
// indépendante de la toile et la déborde : réduire la toile ne détruit rien, et
// ré-agrandir fait réapparaître le relief sculpté à sa place exacte.
//
// `cellCm` est figé à la création du projet et n'est JAMAIS recalculé. C'est ce qui
// garantit qu'aucune donnée sculptée n'est rééchantillonnée au redimensionnement.

import { clamp } from '../core/math.js';

const MARGIN_RATIO = 0.25; // débordement initial de part et d'autre de la toile
const GROW_RATIO = 0.35; // on agrandit large pour ne pas réallouer à chaque cm

export function cellSizeFor(widthCm, heightCm) {
  const longSide = Math.max(widthCm, heightCm);
  return clamp(longSide / 256, 0.15, 2);
}

export class SculptLayer {
  constructor({ cellCm, originXCm, originYCm, cols, rows, warpLimitCm, warpX, warpY, height, active = false }) {
    this.cellCm = cellCm;
    this.originXCm = originXCm;
    this.originYCm = originYCm;
    this.cols = cols;
    this.rows = rows;
    this.warpLimitCm = warpLimitCm;
    const n = cols * rows;
    this.warpX = warpX ?? new Float32Array(n);
    this.warpY = warpY ?? new Float32Array(n);
    this.height = height ?? new Float32Array(n);
    this.active = active;
  }

  static forCanvas(widthCm, heightCm, cellCm = cellSizeFor(widthCm, heightCm)) {
    const marginX = widthCm * MARGIN_RATIO;
    const marginY = heightCm * MARGIN_RATIO;
    const spanX = widthCm + marginX * 2;
    const spanY = heightCm + marginY * 2;
    const cols = Math.max(8, Math.ceil(spanX / cellCm) + 1);
    const rows = Math.max(8, Math.ceil(spanY / cellCm) + 1);
    return new SculptLayer({
      cellCm,
      originXCm: -((cols - 1) * cellCm) / 2,
      originYCm: -((rows - 1) * cellCm) / 2,
      cols,
      rows,
      warpLimitCm: 0.22 * Math.max(widthCm, heightCm),
    });
  }

  /** Agrandit la grille si la toile demandée déborde. Les données sont recopiées à l'identique. */
  ensureCovers(widthCm, heightCm) {
    const needX = widthCm / 2;
    const needY = heightCm / 2;
    const haveX = Math.min(-this.originXCm, this.originXCm + (this.cols - 1) * this.cellCm);
    const haveY = Math.min(-this.originYCm, this.originYCm + (this.rows - 1) * this.cellCm);
    if (needX <= haveX && needY <= haveY) return false;

    const spanX = Math.max((this.cols - 1) * this.cellCm, widthCm * (1 + GROW_RATIO * 2));
    const spanY = Math.max((this.rows - 1) * this.cellCm, heightCm * (1 + GROW_RATIO * 2));
    let cols = Math.max(this.cols, Math.ceil(spanX / this.cellCm) + 1);
    let rows = Math.max(this.rows, Math.ceil(spanY / this.cellCm) + 1);

    // Les deux grilles étant centrées, le décalage vaut (nouveau − ancien) / 2.
    // Si cette différence est IMPAIRE, le décalage est un demi-pas : la sculpture
    // se retrouverait déplacée d'une demi-cellule à chaque agrandissement, sans
    // que rien ne le signale. On force donc une croissance paire — le décalage
    // reste un entier exact et les données sont recopiées à l'identique.
    if ((cols - this.cols) % 2 !== 0) cols += 1;
    if ((rows - this.rows) % 2 !== 0) rows += 1;

    const originXCm = -((cols - 1) * this.cellCm) / 2;
    const originYCm = -((rows - 1) * this.cellCm) / 2;
    const shiftX = (cols - this.cols) / 2;
    const shiftY = (rows - this.rows) / 2;

    const next = { warpX: new Float32Array(cols * rows), warpY: new Float32Array(cols * rows), height: new Float32Array(cols * rows) };
    for (let y = 0; y < this.rows; y++) {
      const dstRow = (y + shiftY) * cols + shiftX;
      const srcRow = y * this.cols;
      if (y + shiftY < 0 || y + shiftY >= rows) continue;
      for (let x = 0; x < this.cols; x++) {
        const dx = x + shiftX;
        if (dx < 0 || dx >= cols) continue;
        next.warpX[dstRow + x] = this.warpX[srcRow + x];
        next.warpY[dstRow + x] = this.warpY[srcRow + x];
        next.height[dstRow + x] = this.height[srcRow + x];
      }
    }

    this.cols = cols;
    this.rows = rows;
    this.originXCm = originXCm;
    this.originYCm = originYCm;
    this.warpX = next.warpX;
    this.warpY = next.warpY;
    this.height = next.height;
    return true;
  }

  colOf(xCm) {
    return (xCm - this.originXCm) / this.cellCm;
  }

  rowOf(yCm) {
    return (yCm - this.originYCm) / this.cellCm;
  }

  /** Échantillonnage bilinéaire ; zéro hors grille (le calque y est vierge par construction). */
  sample(field, xCm, yCm) {
    const gx = this.colOf(xCm);
    const gy = this.rowOf(yCm);
    if (gx < 0 || gy < 0 || gx > this.cols - 1 || gy > this.rows - 1) return 0;
    const x0 = gx | 0;
    const y0 = gy | 0;
    const x1 = Math.min(this.cols - 1, x0 + 1);
    const y1 = Math.min(this.rows - 1, y0 + 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const top = field[y0 * this.cols + x0] * (1 - fx) + field[y0 * this.cols + x1] * fx;
    const bottom = field[y1 * this.cols + x0] * (1 - fx) + field[y1 * this.cols + x1] * fx;
    return top + (bottom - top) * fy;
  }

  clear() {
    this.warpX.fill(0);
    this.warpY.fill(0);
    this.height.fill(0);
    this.active = false;
  }

  snapshot() {
    return {
      warpX: this.warpX.slice(),
      warpY: this.warpY.slice(),
      height: this.height.slice(),
      cols: this.cols,
      rows: this.rows,
      originXCm: this.originXCm,
      originYCm: this.originYCm,
      active: this.active,
    };
  }

  restore(snap) {
    this.cols = snap.cols;
    this.rows = snap.rows;
    this.originXCm = snap.originXCm;
    this.originYCm = snap.originYCm;
    this.warpX = snap.warpX.slice();
    this.warpY = snap.warpY.slice();
    this.height = snap.height.slice();
    this.active = snap.active;
  }

  /**
   * Forme sérialisable — IndexedDB stocke les tableaux typés nativement.
   * Les tableaux sont COPIÉS : le résultat sert aussi d'instantané de base (§4),
   * et rendre les tableaux vivants ferait qu'une sculpture ultérieure modifierait
   * l'instantané censé la précéder.
   */
  serialize() {
    return {
      cellCm: this.cellCm,
      originXCm: this.originXCm,
      originYCm: this.originYCm,
      cols: this.cols,
      rows: this.rows,
      warpLimitCm: this.warpLimitCm,
      active: this.active,
      warpX: this.warpX.slice(),
      warpY: this.warpY.slice(),
      height: this.height.slice(),
    };
  }

  /** Reprend l'état exact d'une forme sérialisée, géométrie de grille comprise. */
  adopt(data) {
    if (!data) {
      this.clear();
      return;
    }
    this.cellCm = data.cellCm;
    this.originXCm = data.originXCm;
    this.originYCm = data.originYCm;
    this.cols = data.cols;
    this.rows = data.rows;
    this.warpLimitCm = data.warpLimitCm;
    this.warpX = new Float32Array(data.warpX);
    this.warpY = new Float32Array(data.warpY);
    this.height = new Float32Array(data.height);
    this.active = !!data.active;
  }

  static deserialize(data) {
    if (!data) return null;
    return new SculptLayer({
      cellCm: data.cellCm,
      originXCm: data.originXCm,
      originYCm: data.originYCm,
      cols: data.cols,
      rows: data.rows,
      warpLimitCm: data.warpLimitCm,
      active: !!data.active,
      warpX: new Float32Array(data.warpX),
      warpY: new Float32Array(data.warpY),
      height: new Float32Array(data.height),
    });
  }
}
