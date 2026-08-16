// Export image (§17).
//
// La version 1 exportait un PNG de 1920 × 1200, quel que soit le projet. Sur un
// panneau carré ou rond, l'image sortait déformée ; sur un panneau de 500 cm,
// elle sortait minuscule. Ici la définition est choisie par son GRAND CÔTÉ et le
// rapport vient du projet, jamais l'inverse.
//
// Ce module ne calcule aucun relief : il demande un rendu à la même fonction que
// l'écran, avec la même heightmap. L'image exportée est donc l'œuvre affichée,
// pas une seconde évaluation qui lui ressemble.

import { createRenderCache, renderFull } from '../render2d/renderer.js';

export const LONG_SIDE_CHOICES = [2048, 4096];

// Plafond mémoire. Un canvas de 40 Mpx occupe déjà 160 Mo en RGBA, avant le
// tampon de hauteurs et celui d'occlusion. §17 interdit explicitement les
// définitions délirantes tirées d'un calcul en 300 points par pouce sur
// plusieurs mètres : c'est ce plafond qui le garantit.
export const MAX_PIXELS = 40e6;
export const MAX_LONG_SIDE = 8192;

/**
 * Définition de sortie pour un grand côté demandé.
 * Retourne aussi `clamped` quand le plafond a dû intervenir, pour que
 * l'interface puisse le dire au lieu de le taire.
 */
export function outputSizeFor(project, longSide) {
  const requested = Math.max(64, Math.min(MAX_LONG_SIDE, Math.round(longSide)));
  const aspect = project.widthCm / project.heightCm;
  let width = aspect >= 1 ? requested : Math.max(1, Math.round(requested * aspect));
  let height = aspect >= 1 ? Math.max(1, Math.round(requested / aspect)) : requested;

  let clamped = requested !== Math.round(longSide);
  if (width * height > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (width * height));
    width = Math.max(1, Math.floor(width * k));
    height = Math.max(1, Math.floor(height * k));
    clamped = true;
  }
  return { width, height, clamped, aspect };
}

/**
 * Rend l'œuvre à la définition demandée.
 * `transparent` ne vaut que pour une toile ronde en PNG : le pourtour du disque
 * garde alors son alpha nul. En JPEG le fond est OBLIGATOIRE — le format ne
 * connaît pas la transparence, et sans fond le disque sortirait sur du noir.
 */
export function renderForExport(project, hm, { longSide, format, transparent }) {
  const { width, height, clamped } = outputSizeFor(project, longSide);
  const canvas = document.createElement('canvas');
  renderFull(canvas, project, hm, width, height, createRenderCache());

  const opaque = format === 'jpeg' || !transparent || project.canvasShape !== 'circle';
  if (opaque) {
    // Le fond est peint DERRIÈRE l'œuvre, jamais par-dessus.
    const composed = document.createElement('canvas');
    composed.width = width;
    composed.height = height;
    const ctx = composed.getContext('2d', { alpha: format !== 'jpeg' });
    ctx.fillStyle = project.presentation.wallColor;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0);
    return { canvas: composed, width, height, clamped };
  }

  return { canvas, width, height, clamped };
}

export function encode(canvas, format, quality = 0.92) {
  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new Promise((resolve) => canvas.toBlob(resolve, type, format === 'jpeg' ? quality : undefined));
}

export function fileNameFor(project, format, width, height) {
  const base = (project.name || 'relief').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'relief'}-${width}x${height}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}
