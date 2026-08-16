// Calibration des prototypes sur les photos de référence.
//
//   node tests/calibrate-refs.mjs            → mesure l'écart courant
//   node tests/calibrate-refs.mjs --chercher → cherche de meilleurs réglages
//
// CE QUI EST POSSIBLE, ET CE QUI NE L'EST PAS.
//
// Un moteur procédural ne peut pas reproduire une photographie « au pixel
// près ». Les trois références montrent des panneaux RÉELS, avec une
// disposition de cavités unique, une perspective d'appareil, une chute de
// lumière physique, un mur et un sol. Aucune graine ne redonne cette
// disposition-là : il faudrait embarquer l'image elle-même, ce qui reviendrait
// à plaquer une photo sur le canvas — exactement ce que ce produit refuse de
// faire depuis le premier lot.
//
// Ce qui est possible, et ce que fait ce fichier : mesurer sur les photos les
// grandeurs qui font leur SIGNATURE, mesurer les mêmes sur nos rendus, et
// régler les prototypes pour que l'écart soit minimal. La ressemblance devient
// alors un nombre, pas une opinion.
//
// Les cibles ci-dessous ont été relevées dans un navigateur sur ref-1/2/3.jpg,
// panneau recadré hors mur et hors sol, à 420 px de large.

import { buildHeightmap, resampleTo, sampleAo } from '../src/geometry/heightmap.js';
import { createProject, PRESETS, defaultGeometry } from '../src/core/project.js';
import { shadeParams, shadeRegion } from '../src/render2d/shade.js';

const CIBLES = {
  dunes: { ref: 'ref-1.jpg', p5: 52.8, median: 135.6, p95: 221.4, sombre: 21.7, echelle: 9.0, rapport: 1.637 },
  cellules: { ref: 'ref-2.jpg', p5: 56.3, median: 132.0, p95: 220.1, sombre: 19.3, echelle: 6.7, rapport: 1.686 },
  archipel: { ref: 'ref-3.jpg', p5: 66.8, median: 150.5, p95: 217.4, sombre: 14.2, echelle: 9.0, rapport: 1.795 },
};

const W = 420;

// La recherche travaille sur une grille d'aperçu : quatre fois moins de
// cellules, donc quatre fois plus d'essais dans le même temps. Les grandeurs
// mesurées — répartition des tons, échelle en pourcentage de la largeur — ne
// dépendent pas de la finesse d'échantillonnage. Le résultat retenu est ensuite
// revérifié à pleine qualité.
function rendre(project, quality = 1) {
  const H = Math.max(8, Math.round(W / (project.widthCm / project.heightCm)));
  const hm = buildHeightmap(project, null, quality === 1 ? {} : { quality });
  const map = resampleTo(hm, project, W, H);
  const ao = new Float32Array(W * H);
  const halfW = project.widthCm / 2;
  const halfH = project.heightCm / 2;
  for (let y = 0; y < H; y++) {
    const yCm = -halfH + (y / (H - 1)) * project.heightCm;
    for (let x = 0; x < W; x++) ao[y * W + x] = sampleAo(hm.ao, -halfW + (x / (W - 1)) * project.widthCm, yCm);
  }
  const sp = shadeParams(project, W, hm.max - hm.min);
  const data = new Uint8ClampedArray(W * H * 4);
  shadeRegion(data, map, ao, W, H, 0, 0, W, H, 0, 0, W, H, sp);
  return { data, W, H };
}

/** Mêmes grandeurs que celles relevées sur les photos, calculées à l'identique. */
export function mesurer({ data, W: w, H: h }) {
  const lum = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const tri = Float64Array.from(lum).sort();
  const q = (f) => tri[Math.floor(f * (tri.length - 1))];
  const median = q(0.5);
  let sombres = 0;
  for (let i = 0; i < tri.length; i++) if (tri[i] < median * 0.62) sombres++;

  let moy = 0;
  for (let i = 0; i < lum.length; i++) moy += lum[i];
  moy /= lum.length;
  let echelle = 0;
  for (let d = 1; d < w / 2; d++) {
    let c = 0;
    let n = 0;
    for (let y = Math.round(h / 4); y < Math.round((3 * h) / 4); y += 3) {
      for (let x = 0; x + d < w; x += 2) {
        c += (lum[y * w + x] - moy) * (lum[y * w + x + d] - moy);
        n++;
      }
    }
    if (c / n <= 0) { echelle = (100 * d) / w; break; }
  }
  return { p5: q(0.05), median, p95: q(0.95), sombre: (100 * sombres) / tri.length, echelle };
}

/**
 * Distance à la cible, en pourcentage.
 * Chaque grandeur est rapportée à son échelle propre — 255 pour un ton, la
 * valeur cible pour une proportion — sans quoi la luminance écraserait tout.
 */
export function distance(m, cible) {
  const t = (a, b) => Math.abs(a - b) / 255;
  const r = (a, b) => Math.abs(a - b) / Math.max(1, b);
  const termes = [
    t(m.p5, cible.p5) * 1.0,
    t(m.median, cible.median) * 1.4,
    // Les hautes lumières pèsent autant que la médiane : l'amendement F exige
    // des plateaux CLAIRS. Une première recherche, qui les sous-pondérait, a
    // trouvé un archipel parfait en médiane et p5 mais dont le p95 tombait à
    // 170 contre 217 — l'image entière écrasée dans les gris moyens.
    t(m.p95, cible.p95) * 1.4,
    r(m.sombre, cible.sombre) * 0.5,
    // L'échelle reste MESURÉE et affichée, pour information, mais ne pèse plus
    // dans la distance : elle a induit en erreur, voir la note sur AXES.
    r(m.echelle || 60, cible.echelle) * 0.0,
  ];
  return (100 * termes.reduce((a, b) => a + b, 0)) / termes.length;
}

function projetPour(cle, geometry, lighting) {
  const cible = CIBLES[cle];
  const hauteur = 100;
  const p = createProject({ canvasShape: 'rectangle', widthCm: Math.round(hauteur * cible.rapport), heightCm: hauteur, depthCm: 6 });
  Object.assign(p.geometry, defaultGeometry(), PRESETS[cle].geometry, geometry || {});
  Object.assign(p.lighting, PRESETS[cle].lighting || {}, lighting || {});
  Object.assign(p.material, PRESETS[cle].material || {});
  Object.assign(p.presentation, PRESETS[cle].presentation || {});
  return p;
}

// L'ÉCHELLE ET LA FAMILLE NE SONT PAS DANS LA RECHERCHE, ET C'EST VOULU.
//
// Une première version les incluait. La distance est tombée de 42 à 14 % pour
// Dunes… et l'image est devenue un champ de rayures serrées, sans rapport avec
// les cavités closes de la photo. Le terme d'échelle, tiré d'une
// autocorrélation, est un mauvais juge de la STRUCTURE : il récompense la bonne
// période et ignore la forme.
//
// La structure — famille procédurale, taille des cavités — se règle donc à
// l'œil, contre la photo. La mesure garde ce qu'elle sait juger : la
// répartition des tons. Chacun son domaine.
const AXES = [
  ['geometry', 'density', 0.05, 0.95, 0.03],
  ['geometry', 'depth', 0.2, 1, 0.03],
  ['geometry', 'shoulder', 0.05, 1, 0.04],
  ['lighting', 'exposureEv', -2, 2, 0.08],
  ['lighting', 'contrast', 0.2, 1, 0.04],
  ['lighting', 'shadowStrength', 0, 1, 0.05],
  ['lighting', 'cavityOcclusion', 0, 1, 0.05],
  ['lighting', 'height', 15, 80, 3],
];

function evaluer(cle, g, l) {
  return distance(mesurer(rendre(projetPour(cle, g, l), 0.5)), CIBLES[cle]);
}

function chercher(cle, passes = 2) {
  const g = {};
  const l = {};
  let best = evaluer(cle, g, l);
  for (let passe = 0; passe < passes; passe++) {
    for (const [bloc, champ, lo, hi, pas] of AXES) {
      const cible = bloc === 'geometry' ? g : l;
      const base = projetPour(cle, g, l);
      const courant = cible[champ] ?? (bloc === 'geometry' ? base.geometry[champ] : base.lighting[champ]);
      for (const sens of [1, -1]) {
        let v = courant;
        for (let n = 0; n < 14; n++) {
          const essai = Math.min(hi, Math.max(lo, v + sens * pas));
          if (essai === v) break;
          cible[champ] = essai;
          const d = evaluer(cle, g, l);
          if (d < best - 1e-4) { best = d; v = essai; } else { cible[champ] = v; break; }
        }
      }
    }
  }
  return { geometry: g, lighting: l, distance: best };
}

const chercheMode = process.argv.includes('--chercher');
console.log(`\nÉcart aux photos de référence — ${W} px de large, panneau seul\n`);
for (const cle of Object.keys(CIBLES)) {
  const cible = CIBLES[cle];
  const avant = mesurer(rendre(projetPour(cle)));
  console.log(`${cle} → ${cible.ref}`);
  console.log(`   cible   p5 ${cible.p5.toFixed(0)}  médiane ${cible.median.toFixed(0)}  p95 ${cible.p95.toFixed(0)}  sombre ${cible.sombre.toFixed(1)} %  échelle ${cible.echelle.toFixed(1)} %`);
  console.log(`   actuel  p5 ${avant.p5.toFixed(0)}  médiane ${avant.median.toFixed(0)}  p95 ${avant.p95.toFixed(0)}  sombre ${avant.sombre.toFixed(1)} %  échelle ${avant.echelle.toFixed(1)} %`);
  console.log(`   distance : ${distance(avant, cible).toFixed(2)} %`);
  if (chercheMode) {
    const r = chercher(cle);
    // La distance annoncée est celle du rendu À PLEINE QUALITÉ, pas celle de la
    // grille d'aperçu sur laquelle la recherche a travaillé : les deux
    // diffèrent, et publier la seconde flatterait le résultat.
    const apres = mesurer(rendre(projetPour(cle, r.geometry, r.lighting)));
    console.log(`   → réglé  p5 ${apres.p5.toFixed(0)}  médiane ${apres.median.toFixed(0)}  p95 ${apres.p95.toFixed(0)}  sombre ${apres.sombre.toFixed(1)} %  échelle ${apres.echelle.toFixed(1)} %`);
    console.log(`   → distance à pleine qualité : ${distance(apres, cible).toFixed(2)} %  (recherche sur aperçu : ${r.distance.toFixed(2)} %)`);
    console.log(`   → geometry : ${JSON.stringify(r.geometry)}`);
    console.log(`   → lighting : ${JSON.stringify(r.lighting)}`);
  }
  console.log('');
}
