// Ombrage 2D — §7 (profondeur tonale) et §8 (matières).
//
// Ce que faisait la version 1, et qui rendait les références inatteignables :
// la couleur finale était interpolée entre la couleur de matière et une
// « couleur d'ombre » valant 0,4 × matière + 15. Le pixel le plus sombre
// possible tournait donc autour de 108/255 — un gris moyen. S'y ajoutaient une
// occlusion plafonnée à 0,6 et un plancher de lumière à 0,14. Aucun réglage ne
// pouvait descendre au noir : c'était verrouillé dans la formule.
//
// Ici la luminance MULTIPLIE la couleur de matière et n'a pas de plancher. Le
// fond d'une cavité peut donc approcher le noir, pendant que les plateaux
// restent très clairs — parce que l'assombrissement vient de la profondeur
// RÉELLE dans la heightmap, pas d'un voile global.
//
// Deux termes portent cette profondeur :
//   • profondeur LOCALE — écart entre la hauteur et une surface de référence
//     obtenue par un flou de grand rayon (voir `ao` dans heightmap.js). Un point
//     enfoncé sous son voisinage est occulté, où qu'il soit sur le panneau ;
//   • concavité — laplacien, qui creuse les recoins étroits.
//
// MATIÈRES (§8) — approximation 2D et correspondance PBR pour le lot 5.
// La vue 2D est frontale et orthographique : le vecteur de vue est (0, 0, 1), le
// spéculaire est un Blinn-Phong sur le demi-vecteur. Correspondance à respecter
// quand Three.js prendra le relais, pour que les deux vues coïncident :
//
//   mat      → roughness 1,00  metalness 0    aucun spéculaire  (LA référence)
//   satiné   → roughness 0,55  metalness 0    spéculaire large et faible
//   brillant → roughness 0,22  metalness 0    spéculaire étroit et vif
//   chrome   → roughness 0,08  metalness 1    la diffuse est remplacée par une
//                                             réflexion d'environnement
//
// « Mat » est le défaut et la référence : zéro reflet. C'est lui qui doit
// ressembler à ref-1/2/3, et rien dans son chemin de code n'ajoute de spéculaire.

import { clamp, hexToRgb } from '../core/math.js';

export const FINISHES = {
  mat: { specular: 0, shininess: 1, metal: 0, roughness: 1.0 },
  satine: { specular: 0.14, shininess: 10, metal: 0, roughness: 0.55 },
  brillant: { specular: 0.5, shininess: 58, metal: 0, roughness: 0.22 },
  chrome: { specular: 0.9, shininess: 150, metal: 1, roughness: 0.08 },
};

export function shadeParams(project, width, amplitude = 1) {
  const { lighting, material, geometry } = project;
  const azimuth = (lighting.angle * Math.PI) / 180;
  const elevation = (lighting.height * Math.PI) / 180;
  const color = hexToRgb(material.color);
  const finish = FINISHES[material.finish] || FINISHES.mat;

  const lx = Math.cos(azimuth) * Math.cos(elevation);
  const ly = Math.sin(azimuth) * Math.cos(elevation);
  const lz = Math.sin(elevation);
  // Demi-vecteur de Blinn, vue frontale : V = (0, 0, 1).
  const hxRaw = lx;
  const hyRaw = ly;
  const hzRaw = lz + 1;
  const hLen = Math.hypot(hxRaw, hyRaw, hzRaw) || 1;

  const contrast = lighting.contrast;

  return {
    lx,
    ly,
    lz,
    hx: hxRaw / hLen,
    hy: hyRaw / hLen,
    hz: hzRaw / hLen,

    normalScale: (18 + geometry.depth * 14) * (width / 900),
    lapScale: width * width * 0.0032,
    // Normalisé sur l'AMPLITUDE RÉELLE du relief, pas sur le paramètre de
    // profondeur. Les deux n'ont rien à voir : `geometry.depth` vaut 0,95 quand
    // l'amplitude mesurée du champ dépasse 2,4. Caler l'occlusion sur le second
    // saturait la profondeur locale partout, et l'image tombait en noir et blanc
    // sans demi-teintes.
    depthRange: Math.max(0.05, amplitude * 0.6),

    // L'ambiante est FRANCHE, et c'est elle qui est ensuite éteinte par
    // l'occlusion. Une ambiante quasi nulle (0,09, essayée d'abord) plongeait au
    // noir toute paroi tournée à l'opposé de la lumière, où qu'elle soit, et
    // l'image tombait en aplats. Un panneau de plâtre dans une pièce reçoit
    // beaucoup de lumière rebondie : seul l'enfoncement réel la lui retire.
    ambient: 0.30 + (1 - contrast) * 0.16,
    diffuseGain: 0.55 + contrast * 0.25,
    // Enveloppement : adoucit le terminateur, sans quoi le plâtre paraît
    // découpé au couteau.
    wrap: 0.35,

    exposure: Math.pow(2, lighting.exposureEv || 0),
    shadowStrength: lighting.shadowStrength ?? 0.55,
    cavityOcclusion: lighting.cavityOcclusion ?? 0.5,
    contrastGain: 0.80 + contrast * 0.45,

    specular: finish.specular,
    shininess: finish.shininess,
    metal: finish.metal,

    color,
    texture: material.texture,
    seed: geometry.seed,
  };
}

/**
 * Ombre un rectangle du tampon de hauteurs vers un ImageData.
 * `map` et `ao` sont à la résolution de sortie ; `ao` porte la surface de
 * référence locale (flou de grand rayon) qui donne sa profondeur au noir.
 */
export function shadeRegion(data, map, ao, mapW, mapH, ix0, iy0, ix1, iy1, gx0, gy0, fullW, fullH, sp) {
  const outW = ix1 - ix0;
  const invWrap = 1 / (1 + sp.wrap);

  for (let y = iy0; y < iy1; y++) {
    const yu = Math.max(0, y - 1);
    const yd = Math.min(mapH - 1, y + 1);
    const gy = gy0 + (y - iy0);
    for (let x = ix0; x < ix1; x++) {
      const xl = Math.max(0, x - 1);
      const xr = Math.min(mapW - 1, x + 1);
      const gx = gx0 + (x - ix0);
      const i = y * mapW + x;
      const centre = map[i];
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

      const diffuse = Math.max(0, (nx * sp.lx + ny * sp.ly + nz * sp.lz + sp.wrap) * invWrap);

      // Occlusion : profondeur locale sous la surface de référence, plus
      // concavité. Exponentielle et NON plafonnée — c'est ce qui permet
      // d'atteindre le noir au fond d'un creux sans toucher aux plateaux.
      const localDepth = clamp((ao[i] - centre) / sp.depthRange, 0, 1.4);
      const concavity = clamp((hl + hr + hu + hd - 4 * centre) * sp.lapScale, 0, 1);
      const occlusion = Math.exp(-(localDepth * 1.55 * sp.shadowStrength + concavity * 1.1 * sp.cavityOcclusion));

      let lum = (sp.ambient + diffuse * sp.diffuseGain) * occlusion * sp.exposure;
      // Contraste autour d'un pivot fixe : la matière garde sa clarté de
      // plateau pendant que les bas s'enfoncent.
      lum = 0.42 + (lum - 0.42) * sp.contrastGain;
      lum = clamp(lum, 0, 1.7);

      let r;
      let g;
      let b;

      if (sp.metal) {
        // Chrome : la diffuse ne veut rien dire sur un métal. On lit un
        // environnement de studio dans la normale — sol sombre, ciel clair,
        // bande d'horizon — puis on la teinte par la couleur de matière.
        const up = clamp(-ny * 0.5 + 0.5, 0, 1);
        const env = 0.06 + 0.94 * Math.pow(up, 1.7);
        const horizon = Math.exp(-Math.pow((up - 0.5) * 7, 2)) * 0.35;
        const metalLum = clamp((env + horizon) * occlusion * sp.exposure, 0, 1.8);
        r = sp.color[0] * metalLum;
        g = sp.color[1] * metalLum;
        b = sp.color[2] * metalLum;
      } else {
        r = sp.color[0] * lum;
        g = sp.color[1] * lum;
        b = sp.color[2] * lum;
      }

      if (sp.specular > 0) {
        const nh = nx * sp.hx + ny * sp.hy + nz * sp.hz;
        if (nh > 0) {
          const s = sp.specular * Math.pow(nh, sp.shininess) * occlusion * 255;
          r += s;
          g += s;
          b += s;
        }
      }

      let h1 = Math.imul(gx + 17, 374761393) + Math.imul(gy + 31, 668265263) + Math.imul(sp.seed, 69069);
      h1 = Math.imul(h1 ^ (h1 >>> 13), 1274126177);
      const fine = ((h1 ^ (h1 >>> 16)) >>> 0) / 4294967295 - 0.5;
      let h2 = Math.imul((gx >> 2) + 113, 374761393) + Math.imul((gy >> 2) + 57, 668265263) + Math.imul(sp.seed, 362437);
      h2 = Math.imul(h2 ^ (h2 >>> 13), 1274126177);
      const coarse = ((h2 ^ (h2 >>> 16)) >>> 0) / 4294967295 - 0.5;
      // Le grain suit la lumière : un plâtre ne montre pas son grain dans le noir.
      const grain = (fine * 5.4 + coarse * 3.6) * sp.texture * Math.min(1, lum + 0.15);

      const vignette = 1 - 0.055 * Math.pow(Math.hypot(gx / fullW - 0.5, gy / fullH - 0.5) / 0.71, 1.8);
      const p = ((y - iy0) * outW + (x - ix0)) * 4;
      data[p] = clamp(r * vignette + grain, 0, 255);
      data[p + 1] = clamp(g * vignette + grain, 0, 255);
      data[p + 2] = clamp(b * vignette + grain, 0, 255);
      data[p + 3] = 255;
    }
  }
}
