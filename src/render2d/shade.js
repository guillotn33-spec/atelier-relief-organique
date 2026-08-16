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
  brillant: { specular: 0.58, shininess: 58, metal: 0, roughness: 0.22 },
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
// Réciproque de 2³² − 1 : deux divisions flottantes de moins par pixel pour le
// grain, soit 1,3 million par rendu plein.
const INV_U32 = 1 / 4294967295;

// Table du vignetage.
//
// Le facteur s'écrivait `1 − 0,055 · (hypot(cx, cy) / 0,71)^1,8` — un `hypot`,
// une puissance à exposant non entier (donc `exp∘log`, que le moteur ne peut pas
// réduire) et deux divisions PAR PIXEL, soit 650 000 de chaque sur un rendu
// d'aperçu et 9 millions sur un export en 3072 px. Or cette quantité ne dépend
// ni de la lumière, ni de la matière, ni du relief : seulement de la POSITION
// dans l'image. Elle était pourtant recalculée à chaque cran d'un curseur de
// lumière.
//
// En posant s = (cx² + cy²) / 0,71², la puissance devient s^0,9 et le `hypot`
// disparaît. `s` vaut au plus 0,99 aux coins d'une image, donc une table sur
// [0, 1] la couvre entièrement. Interpolée linéairement sur 2048 pas, l'erreur
// reste sous 10⁻⁴ niveau de couleur : invisible, et surtout DÉTERMINISTE — le
// rendu partiel et le rendu complet lisent la même table, donc restent
// identiques octet pour octet.
const VIGNETTE_N = 2048;
const VIGNETTE = new Float64Array(VIGNETTE_N + 2);
for (let i = 0; i <= VIGNETTE_N + 1; i++) VIGNETTE[i] = Math.pow(i / VIGNETTE_N, 0.9);
const INV_VIGNETTE_R2 = 1 / (0.71 * 0.71);

export function shadeRegion(data, map, ao, mapW, mapH, ix0, iy0, ix1, iy1, gx0, gy0, fullW, fullH, sp) {
  const outW = ix1 - ix0;
  const invWrap = 1 / (1 + sp.wrap);

  // TOUT CE QUI NE DÉPEND PAS DU PIXEL SORT DE LA BOUCLE.
  //
  // Le corps lisait trente et une propriétés de `sp` par pixel, plus trois
  // accès au tableau de couleur — vingt millions de chargements par rendu. Ce
  // sont des lectures d'objet, donc non hissées par le moteur : rien ne lui
  // garantit que `sp` n'est pas modifié entre deux itérations.
  const { lx, ly, lz, hx, hy, hz, normalScale, lapScale, ambient, diffuseGain, wrap,
    exposure, shadowStrength, cavityOcclusion, contrastGain, specular, shininess,
    metal, texture, seed, depthRange } = sp;
  const cr = sp.color[0];
  const cg = sp.color[1];
  const cb = sp.color[2];
  const invDepthRange = 1 / depthRange;
  const gainOcclusion = 1.55 * shadowStrength;
  const gainConcavite = 1.1 * cavityOcclusion;
  const avecGrain = texture > 0;
  const invFullW = 1 / fullW;
  const invFullH = 1 / fullH;

  // Indices et facteurs par COLONNE, calculés une fois.
  //
  // Deux `Math.max`/`Math.min` par pixel disparaissent — et surtout, le
  // gradient de bord est corrigé. Sur la première et la dernière colonne, la
  // différence centrée porte sur UNE cellule au lieu de deux, alors que
  // `normalScale` est calibré pour deux : la normale du liseré de un pixel
  // était deux fois trop verticale, et tout le pourtour du panneau mal éclairé.
  // Invisible à 1020 px, net sur un export en 3072. Le facteur `2 / (xr − xl)`
  // rétablit l'échelle ; il vaut 1 partout ailleurs.
  //
  // Pour le laplacien, la solution est le MIROIR : une différence seconde n'est
  // pas définie sur deux points. Réfléchir le voisin manquant donne la condition
  // de bord habituelle, là où la réplication perdait purement un terme.
  const colG = new Int32Array(outW);
  const colD = new Int32Array(outW);
  const colGL = new Int32Array(outW);
  const colDL = new Int32Array(outW);
  const colEchelle = new Float64Array(outW);
  const colVignette = new Float64Array(outW);
  for (let k = 0; k < outW; k++) {
    const x = ix0 + k;
    const g = x > 0 ? x - 1 : 0;
    const d = x < mapW - 1 ? x + 1 : mapW - 1;
    colG[k] = g;
    colD[k] = d;
    colEchelle[k] = d > g ? (2 / (d - g)) * normalScale : 0;
    colGL[k] = x > 0 ? x - 1 : Math.min(1, mapW - 1);
    colDL[k] = x < mapW - 1 ? x + 1 : Math.max(0, mapW - 2);
    const cx = (gx0 + k) * invFullW - 0.5;
    colVignette[k] = cx * cx;
  }

  for (let y = iy0; y < iy1; y++) {
    const yu = y > 0 ? y - 1 : 0;
    const yd = y < mapH - 1 ? y + 1 : mapH - 1;
    const echelleY = yd > yu ? (2 / (yd - yu)) * normalScale : 0;
    const yuL = y > 0 ? y - 1 : Math.min(1, mapH - 1);
    const ydL = y < mapH - 1 ? y + 1 : Math.max(0, mapH - 2);
    const gy = gy0 + (y - iy0);
    const cy = gy * invFullH - 0.5;
    const cy2 = cy * cy;
    const ligne = y * mapW;
    const ligneU = yu * mapW;
    const ligneD = yd * mapW;
    const ligneUL = yuL * mapW;
    const ligneDL = ydL * mapW;
    const dst = (y - iy0) * outW;
    const grainY = Math.imul(gy + 31, 668265263) + Math.imul(seed, 69069);
    const grainY2 = Math.imul((gy >> 2) + 57, 668265263) + Math.imul(seed, 362437);

    for (let k = 0; k < outW; k++) {
      const x = ix0 + k;
      const i = ligne + x;
      const centre = map[i];
      const hl = map[ligne + colG[k]];
      const hr = map[ligne + colD[k]];
      const hu = map[ligneU + x];
      const hd = map[ligneD + x];

      const dx = (hr - hl) * colEchelle[k];
      const dy = (hd - hu) * echelleY;
      // `1 / Math.sqrt(…)` et non `1 / Math.hypot(dx, dy, 1)` : `hypot` fait une
      // mise à l'échelle anti-débordement qui n'a aucun sens sur des dérivées
      // bornées. C'est la règle que `field.js` énonce et applique déjà.
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const nx = -dx * inv;
      const ny = -dy * inv;
      const nz = inv;

      const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz + wrap) * invWrap);

      // Occlusion : profondeur locale sous la surface de référence, plus
      // concavité. Exponentielle et NON plafonnée — c'est ce qui permet
      // d'atteindre le noir au fond d'un creux sans toucher aux plateaux.
      const localDepth = clamp((ao[i] - centre) * invDepthRange, 0, 1.4);
      const concavity = clamp(
        (map[ligne + colGL[k]] + map[ligne + colDL[k]] + map[ligneUL + x] + map[ligneDL + x] - 4 * centre) * lapScale,
        0,
        1
      );
      const occlusion = Math.exp(-(localDepth * gainOcclusion + concavity * gainConcavite));

      let lum = (ambient + diffuse * diffuseGain) * occlusion * exposure;
      // Contraste autour d'un pivot fixe : la matière garde sa clarté de
      // plateau pendant que les bas s'enfoncent.
      lum = 0.42 + (lum - 0.42) * contrastGain;
      lum = clamp(lum, 0, 1.7);

      let r;
      let g;
      let b;

      if (metal) {
        // Chrome : la diffuse ne veut rien dire sur un métal. On lit un
        // environnement de studio dans la normale — sol sombre, ciel clair,
        // bande d'horizon — puis on la teinte par la couleur de matière.
        const up = clamp(-ny * 0.5 + 0.5, 0, 1);
        const env = 0.06 + 0.94 * Math.pow(up, 1.7);
        const ecart = (up - 0.5) * 7;
        const horizon = Math.exp(-(ecart * ecart)) * 0.35;
        const metalLum = clamp((env + horizon) * occlusion * exposure, 0, 1.8);
        r = cr * metalLum;
        g = cg * metalLum;
        b = cb * metalLum;
      } else {
        r = cr * lum;
        g = cg * lum;
        b = cb * lum;
      }

      if (specular > 0) {
        const nh = nx * hx + ny * hy + nz * hz;
        if (nh > 0) {
          const s = specular * Math.pow(nh, shininess) * occlusion * 255;
          r += s;
          g += s;
          b += s;
        }
      }

      // Le grain suit la lumière : un plâtre ne montre pas son grain dans le
      // noir. À texture nulle il vaut zéro : on ne le calcule pas.
      let grain = 0;
      if (avecGrain) {
        const gx = gx0 + k;
        let h1 = Math.imul(gx + 17, 374761393) + grainY;
        h1 = Math.imul(h1 ^ (h1 >>> 13), 1274126177);
        const fine = ((h1 ^ (h1 >>> 16)) >>> 0) * INV_U32 - 0.5;
        let h2 = Math.imul((gx >> 2) + 113, 374761393) + grainY2;
        h2 = Math.imul(h2 ^ (h2 >>> 13), 1274126177);
        const coarse = ((h2 ^ (h2 >>> 16)) >>> 0) * INV_U32 - 0.5;
        grain = (fine * 5.4 + coarse * 3.6) * texture * Math.min(1, lum + 0.15);
      }

      // Vignetage par table : voir la note de `VIGNETTE`.
      const s = (colVignette[k] + cy2) * INV_VIGNETTE_R2;
      const t = s < 1 ? s * VIGNETTE_N : VIGNETTE_N;
      const j = t | 0;
      const vignette = 1 - 0.055 * (VIGNETTE[j] + (VIGNETTE[j + 1] - VIGNETTE[j]) * (t - j));

      const p = (dst + k) * 4;
      data[p] = clamp(r * vignette + grain, 0, 255);
      data[p + 1] = clamp(g * vignette + grain, 0, 255);
      data[p + 2] = clamp(b * vignette + grain, 0, 255);
      data[p + 3] = 255;
    }
  }
}
