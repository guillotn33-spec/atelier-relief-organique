// Reprise des données de la version 1 (amendement E).
//
// La v1 ne connaissait pas les centimètres : son unique format était le rapport
// 1.6 et sa grille de sculpture faisait 256 × 160 nœuds en u/v. On lui attribue
// un panneau de 160 × 100 cm, qui conserve exactement ce rapport, et une taille
// de cellule de 160/255 cm — soit le pas horizontal réel de l'ancienne grille.
//
// Écart assumé et mesuré : 159 pas verticaux de 160/255 cm couvrent 99,76 cm au
// lieu de 100. La sculpture reprise est donc comprimée de 0,23 % en hauteur,
// très en dessous d'une cellule. Aucune donnée n'est perdue.

import { createProject } from '../core/project.js';
import { SculptLayer } from '../sculpt/layer.js';
import { readLegacyLocalStorage } from './db.js';

const LEGACY_WIDTH_CM = 160;
const LEGACY_HEIGHT_CM = 100;
const LEGACY_SW = 256;
const LEGACY_SH = 160;

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildProjectFromLegacy() {
  const legacy = readLegacyLocalStorage();
  if (!legacy) return null;

  const s = legacy.state || {};
  const project = createProject({
    canvasShape: 'rectangle',
    widthCm: LEGACY_WIDTH_CM,
    heightCm: LEGACY_HEIGHT_CM,
    depthCm: 6,
    name: 'Projet repris de la version 1',
  });

  project.geometry.seed = num(s.seed, project.geometry.seed);
  project.geometry.count = num(s.count, project.geometry.count);
  project.geometry.scale = num(s.scale, 140) / 100;
  project.geometry.elongation = num(s.elongation, 65) / 100;
  project.geometry.flow = num(s.flow, 70) / 100;
  project.geometry.irregularity = num(s.irregularity, 35) / 100;
  project.geometry.depth = num(s.depth, 92) / 100;
  project.geometry.softness = num(s.softness, 62) / 100;
  project.geometry.wave = num(s.wave, 60) / 100;

  project.material.texture = num(s.texture, 30) / 100;
  if (typeof s.materialColor === 'string') project.material.color = s.materialColor;

  project.lighting.angle = num(s.lightAngle, 245);
  project.lighting.height = num(s.lightHeight, 42);
  project.lighting.contrast = num(s.contrast, 80) / 100;
  project.lighting.backlight = num(s.backlight, 58) / 100;

  if (typeof s.panelLayout === 'string') project.presentation.panelLayout = s.panelLayout;
  project.presentation.frame = s.frame !== undefined ? !!s.frame : project.presentation.frame;
  if (typeof s.wallColor === 'string') project.presentation.wallColor = s.wallColor;

  project.ui.presetKey = null;
  project.ui.designName = s.name || 'Création libre';
  // La v1 exprimait la taille de brosse en fraction de largeur ; on la ramène en cm.
  project.ui.brushSizeCm = Math.round(0.12 * LEGACY_WIDTH_CM);

  let layer = null;
  if (legacy.sculpt) {
    const cellCm = LEGACY_WIDTH_CM / (LEGACY_SW - 1);
    const n = LEGACY_SW * LEGACY_SH;
    const warpX = new Float32Array(n);
    const warpY = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Les déplacements v1 étaient en fractions d'axe : x de la largeur, y de la hauteur.
      warpX[i] = legacy.sculpt.warpX[i] * LEGACY_WIDTH_CM;
      warpY[i] = legacy.sculpt.warpY[i] * LEGACY_HEIGHT_CM;
    }
    layer = new SculptLayer({
      cellCm,
      cols: LEGACY_SW,
      rows: LEGACY_SH,
      originXCm: -((LEGACY_SW - 1) * cellCm) / 2,
      originYCm: -((LEGACY_SH - 1) * cellCm) / 2,
      warpLimitCm: 0.22 * LEGACY_WIDTH_CM,
      warpX,
      warpY,
      height: legacy.sculpt.height,
      active: true,
    });
    layer.ensureCovers(LEGACY_WIDTH_CM, LEGACY_HEIGHT_CM);
  }

  return { project, layer };
}
