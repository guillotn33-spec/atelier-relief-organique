// Rendu 2D — consomme la heightmap canonique, ne calcule plus jamais de champ.
//
// Différence structurelle avec la version 1 : la boucle de pixels ne contient plus
// aucune évaluation de champ. Elle lit une heightmap déjà construite, la
// rééchantillonne (Catmull-Rom) puis l'ombre. C'est ce qui garantit que la vue 2D,
// le futur mesh 3D et les exports montrent le MÊME relief, et non trois évaluations
// indépendantes qui se ressemblent.

import { resampleTo, sampleAo, sampleHeight } from '../geometry/heightmap.js';
import { shadeParams, shadeRegion } from './shade.js';

export function createRenderCache() {
  return { map: null, ao: null, outW: 0, outH: 0, sp: null };
}

function ensureBuffer(cache, outW, outH) {
  if (cache.outW !== outW || cache.outH !== outH || !cache.map) {
    cache.map = new Float32Array(outW * outH);
    cache.ao = new Float32Array(outW * outH);
    cache.outW = outW;
    cache.outH = outH;
  }
}

/**
 * Reporte la surface de référence locale sur la grille de sortie.
 * Elle est très basse fréquence : un prélèvement bilinéaire suffit, là où la
 * hauteur exige un Catmull-Rom pour ne pas facetter les normales.
 */
function fillAo(cache, hm, project, outW, outH) {
  const halfW = project.widthCm / 2;
  const halfH = project.heightCm / 2;
  for (let py = 0; py < outH; py++) {
    const yCm = -halfH + (outH === 1 ? 0 : (py / (outH - 1)) * project.heightCm);
    const row = py * outW;
    for (let px = 0; px < outW; px++) {
      const xCm = -halfW + (outW === 1 ? 0 : (px / (outW - 1)) * project.widthCm);
      cache.ao[row + px] = sampleAo(hm.ao, xCm, yCm);
    }
  }
}

/** Trace le contour de la toile dans le repère pixel du canvas. */
function shapePath(ctx, project, width, height) {
  ctx.beginPath();
  if (project.canvasShape === 'circle') {
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(0, 0, width, height);
  }
}

function drawPanelLines(ctx, project, width, height) {
  const layout = project.presentation.panelLayout;
  if (layout === 'none') return;
  ctx.save();
  shapePath(ctx, project, width, height);
  ctx.clip();
  ctx.lineWidth = Math.max(1, width / 1400);
  ctx.strokeStyle = 'rgba(34, 31, 27, .34)';
  ctx.shadowColor = 'rgba(255, 255, 255, .22)';
  ctx.shadowBlur = Math.max(1, width / 900);
  const columns = layout === '3x2' ? 3 : 2;
  const rows = layout === '2x1' ? 1 : 2;
  for (let col = 1; col < columns; col++) {
    const x = Math.round((width * col) / columns) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let row = 1; row < rows; row++) {
    const y = Math.round((height * row) / rows) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFrame(ctx, project, width, height) {
  if (!project.presentation.frame) return;
  const frameWidth = Math.max(4, Math.round(width * 0.009));
  ctx.save();
  ctx.strokeStyle = '#151513';
  ctx.lineWidth = frameWidth;
  if (project.canvasShape === 'circle') {
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, (width - frameWidth) / 2, (height - frameWidth) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(frameWidth / 2, frameWidth / 2, width - frameWidth, height - frameWidth);
  }
  ctx.restore();
}

/** Découpe la toile à sa forme réelle. Le rond n'est pas un rectangle masqué en CSS. */
function applyShapeMask(ctx, project, width, height) {
  if (project.canvasShape !== 'circle') return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  shapePath(ctx, project, width, height);
  ctx.fill();
  ctx.restore();
}

export function renderFull(canvas, project, hm, outW, outH, cache = createRenderCache()) {
  canvas.width = outW;
  canvas.height = outH;
  ensureBuffer(cache, outW, outH);
  resampleTo(hm, project, outW, outH, cache.map);
  fillAo(cache, hm, project, outW, outH);

  const sp = shadeParams(project, outW, hm.max - hm.min);
  const ctx = canvas.getContext('2d', { alpha: true });
  const image = ctx.createImageData(outW, outH);
  shadeRegion(image.data, cache.map, cache.ao, outW, outH, 0, 0, outW, outH, 0, 0, outW, outH, sp);
  ctx.putImageData(image, 0, 0);

  applyShapeMask(ctx, project, outW, outH);
  drawPanelLines(ctx, project, outW, outH);
  drawFrame(ctx, project, outW, outH);

  cache.sp = sp;
  return cache;
}

const patchCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/**
 * Repeint une zone rectangulaire du canvas à partir d'un rectangle en cm.
 * Utilisé pendant un trait de sculpture : rien d'autre n'est recalculé.
 */
export function renderPatch(canvas, project, hm, cache, rectCm) {
  if (!cache.map || !cache.sp || !patchCanvas) return false;
  const { outW, outH } = cache;
  const halfW = project.widthCm / 2;
  const halfH = project.heightCm / 2;

  const toPx = (xCm) => ((xCm + halfW) / project.widthCm) * (outW - 1);
  const toPy = (yCm) => ((yCm + halfH) / project.heightCm) * (outH - 1);

  // Marge d'un pixel : les normales sont calculées par différences finies.
  const px0 = Math.max(0, Math.floor(toPx(rectCm.x0)) - 2);
  const py0 = Math.max(0, Math.floor(toPy(rectCm.y0)) - 2);
  const px1 = Math.min(outW, Math.ceil(toPx(rectCm.x1)) + 2);
  const py1 = Math.min(outH, Math.ceil(toPy(rectCm.y1)) + 2);
  if (px1 <= px0 || py1 <= py0) return false;

  for (let py = py0; py < py1; py++) {
    const yCm = -halfH + (outH === 1 ? 0 : (py / (outH - 1)) * project.heightCm);
    const row = py * outW;
    for (let px = px0; px < px1; px++) {
      const xCm = -halfW + (outW === 1 ? 0 : (px / (outW - 1)) * project.widthCm);
      cache.map[row + px] = sampleHeight(hm, xCm, yCm);
      cache.ao[row + px] = sampleAo(hm.ao, xCm, yCm);
    }
  }

  const pw = px1 - px0;
  const ph = py1 - py0;
  patchCanvas.width = pw;
  patchCanvas.height = ph;
  const pctx = patchCanvas.getContext('2d', { alpha: true });
  const image = pctx.createImageData(pw, ph);
  shadeRegion(image.data, cache.map, cache.ao, outW, outH, px0, py0, px1, py1, px0, py0, outW, outH, cache.sp);
  pctx.putImageData(image, 0, 0);

  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.save();
  shapePath(ctx, project, outW, outH);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(px0, py0, pw, ph);
  ctx.clip();
  ctx.drawImage(patchCanvas, px0, py0);
  drawPanelLines(ctx, project, outW, outH);
  drawFrame(ctx, project, outW, outH);
  ctx.restore();
  return true;
}
