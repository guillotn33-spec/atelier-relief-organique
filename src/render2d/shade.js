// Ombrage 2D — porté depuis la version 1 sans changement de formule.
//
// Les contrôles séparés d'exposition, d'intensité d'ombre et d'occlusion (§7)
// arrivent au lot 4. Au lot 1 ce module doit produire une image IDENTIQUE à celle
// de la version 1 à réglages égaux : c'est la référence de non-régression de la
// bascule d'architecture.

import { clamp, hexToRgb } from '../core/math.js';

export function shadeParams(project, width) {
  const { lighting, material, geometry } = project;
  const azimuth = (lighting.angle * Math.PI) / 180;
  const elevation = (lighting.height * Math.PI) / 180;
  const color = hexToRgb(material.color);
  return {
    lx: Math.cos(azimuth) * Math.cos(elevation),
    ly: Math.sin(azimuth) * Math.cos(elevation),
    lz: Math.sin(elevation),
    normalScale: (18 + geometry.depth * 14) * (width / 900),
    ambient: 0.4 - lighting.contrast * 0.1,
    diffuseGain: 0.66 + lighting.contrast * 0.2,
    depthShadow: 0.3 + lighting.contrast * 0.2,
    concaveShadow: 0.1 + lighting.contrast * 0.08,
    lapScale: width * width * 0.0032,
    depthRange: Math.max(0.05, geometry.depth * 0.85),
    color,
    shadowR: color[0] * 0.4 + 15,
    shadowG: color[1] * 0.39 + 14,
    shadowB: color[2] * 0.38 + 13,
    texture: material.texture,
    seed: geometry.seed,
  };
}

/**
 * Ombre un rectangle du tampon de hauteurs vers un ImageData.
 * `map` est à la résolution de sortie (mapW × mapH) ; `data` reçoit la zone
 * [ix0,ix1[ × [iy0,iy1[ ; (gx0,gy0) situe cette zone dans l'image complète, ce qui
 * garde le grain et le vignettage stables entre un rendu complet et un patch.
 */
export function shadeRegion(data, map, mapW, mapH, ix0, iy0, ix1, iy1, gx0, gy0, fullW, fullH, sp, mean) {
  const outW = ix1 - ix0;
  for (let y = iy0; y < iy1; y++) {
    const yu = Math.max(0, y - 1);
    const yd = Math.min(mapH - 1, y + 1);
    const gy = gy0 + (y - iy0);
    for (let x = ix0; x < ix1; x++) {
      const xl = Math.max(0, x - 1);
      const xr = Math.min(mapW - 1, x + 1);
      const gx = gx0 + (x - ix0);
      const i = y * mapW + x;
      const hl = map[y * mapW + xl];
      const hr = map[y * mapW + xr];
      const hu = map[yu * mapW + x];
      const hd = map[yd * mapW + x];
      const dx = (hr - hl) * sp.normalScale;
      const dy = (hd - hu) * sp.normalScale;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const nx = -dx * inv;
      const ny = -dy * inv;
      const nz = inv;
      const diffuse = Math.max(0, (nx * sp.lx + ny * sp.ly + nz * sp.lz + 0.3) / 1.3);
      const concavity = clamp((hl + hr + hu + hd - 4 * map[i]) * sp.lapScale, 0, 1);
      const depthBelow = clamp((mean - map[i]) / sp.depthRange, 0, 1);
      const occlusion = 1 - Math.min(0.6, depthBelow * sp.depthShadow + concavity * sp.concaveShadow);
      const light = clamp((sp.ambient + diffuse * sp.diffuseGain) * occlusion, 0.14, 1.08);

      let h1 = Math.imul(gx + 17, 374761393) + Math.imul(gy + 31, 668265263) + Math.imul(sp.seed, 69069);
      h1 = Math.imul(h1 ^ (h1 >>> 13), 1274126177);
      const fine = ((h1 ^ (h1 >>> 16)) >>> 0) / 4294967295 - 0.5;
      let h2 = Math.imul((gx >> 2) + 113, 374761393) + Math.imul((gy >> 2) + 57, 668265263) + Math.imul(sp.seed, 362437);
      h2 = Math.imul(h2 ^ (h2 >>> 13), 1274126177);
      const coarse = ((h2 ^ (h2 >>> 16)) >>> 0) / 4294967295 - 0.5;
      const grain = (fine * 5.4 + coarse * 3.6) * sp.texture;

      const vignette = 1 - 0.055 * Math.pow(Math.hypot(gx / fullW - 0.5, gy / fullH - 0.5) / 0.71, 1.8);
      const p = ((y - iy0) * outW + (x - ix0)) * 4;
      data[p] = clamp((sp.shadowR + (sp.color[0] - sp.shadowR) * light) * vignette + grain, 0, 255);
      data[p + 1] = clamp((sp.shadowG + (sp.color[1] - sp.shadowG) * light) * vignette + grain, 0, 255);
      data[p + 2] = clamp((sp.shadowB + (sp.color[2] - sp.shadowB) * light) * vignette + grain, 0, 255);
      data[p + 3] = 255;
    }
  }
}
