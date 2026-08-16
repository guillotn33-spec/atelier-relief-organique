// Ombrage 2D (§7, §8) — la part éprouvable sans navigateur.
//
//   node tests/shading.mjs
//
// `shadeParams` et `shadeRegion` ne touchent ni au DOM ni à un canvas : ils
// écrivent des octets RGBA dans un tampon fourni. Tout §7 et une bonne part de
// §8 sont donc mesurables ici, alors que le lot 4 les avait seulement REGARDÉS.
//
// Ce que ces vérifications refusent de faire : comparer le rendu à une image de
// référence enregistrée. Un tel oracle ne dit pas si le rendu est JUSTE, il dit
// s'il a changé — et il tombe au premier réglage légitime. On éprouve donc les
// PROPRIÉTÉS que §7 et §8 exigent, pas des pixels gelés.

import { buildHeightmap, resampleTo, sampleAo, sampleHeight } from '../src/geometry/heightmap.js';
import { createProject, PRESETS, defaultGeometry } from '../src/core/project.js';
import { shadeParams, shadeRegion, FINISHES } from '../src/render2d/shade.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

const W = 384;
const H = 230;

function makeProject(mod) {
  const project = createProject({ canvasShape: 'rectangle', widthCm: 200, heightCm: 120, depthCm: 6, name: 'Essai ombrage' });
  Object.assign(project.geometry, defaultGeometry(), PRESETS.dunes.geometry);
  if (mod) mod(project);
  return project;
}

/** Reproduit ce que fait `renderFull` : rééchantillonnage, occlusion, ombrage. */
function rendre(project) {
  const hm = buildHeightmap(project, null);
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
  return { hm, map, ao, sp, data };
}

const luminance = (data, i) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
const mediane = (arr) => { const s = Float64Array.from(arr).sort(); return s[s.length >> 1]; };

/** Sépare les pixels en « plateaux » et « fonds de creux » selon la PROFONDEUR RÉELLE. */
function parProfondeur({ map, ao, data }) {
  const n = W * H;
  const prof = new Float64Array(n);
  for (let i = 0; i < n; i++) prof[i] = ao[i] - map[i];
  const ordre = Array.from({ length: n }, (_, i) => i).sort((a, b) => prof[a] - prof[b]);
  const dec = Math.floor(n / 10);
  return {
    plateaux: mediane(ordre.slice(0, dec).map((i) => luminance(data, i))),
    creux: mediane(ordre.slice(n - dec).map((i) => luminance(data, i))),
    tout: mediane(Array.from({ length: n }, (_, i) => luminance(data, i))),
  };
}

// ---- A. Plage tonale : le noir des creux et la clarté des plateaux coexistent ----

console.log('\nA. Plage tonale sur les réglages par défaut\n');
const defaut = rendre(makeProject());
{
  const t = parProfondeur(defaut);
  const lum = Array.from({ length: W * H }, (_, i) => luminance(defaut.data, i)).sort((a, b) => a - b);
  const q = (f) => lum[Math.floor(f * (lum.length - 1))];
  console.log(`   p0,5 ${q(0.005).toFixed(1)}   p5 ${q(0.05).toFixed(1)}   médiane ${q(0.5).toFixed(1)}   p95 ${q(0.95).toFixed(1)}   max ${q(1).toFixed(1)}`);
  console.log(`   plateaux ${t.plateaux.toFixed(1)}   fonds de creux ${t.creux.toFixed(1)}   rapport ${(t.plateaux / t.creux).toFixed(2)}`);

  check('A1 — les fonds de creux descendent très bas', q(0.005) < 45, `1er demi-centile à ${q(0.005).toFixed(1)}/255`);
  check('A2 — les plateaux restent très clairs', q(0.95) > 230, `95e centile à ${q(0.95).toFixed(1)}/255`);
  // Le défaut doit rester NATUREL : ni image globalement noire, ni image lavée.
  check('A3 — le réglage par défaut n’est pas un assombrissement global', q(0.5) > 120 && q(0.5) < 205, `médiane ${q(0.5).toFixed(1)}/255`);
  check('A4 — la séparation vient de la profondeur réelle', t.plateaux / t.creux > 2.5, `plateaux ${t.plateaux.toFixed(1)} contre creux ${t.creux.toFixed(1)}`);
}

// ---- B. Ombres et exposition sont deux commandes DIFFÉRENTES ----
//
// §7 l'exige explicitement : « la profondeur tonale vient de la profondeur
// RÉELLE dans la heightmap, pas d'un assombrissement global ». Un curseur
// d'ombres qui assombrirait aussi les plateaux serait un curseur d'exposition
// déguisé, et la vérification ci-dessous le prendrait en flagrant délit.

console.log('\nB. Ombres et exposition ne font pas la même chose\n');
{
  const base = parProfondeur(defaut);
  const ombres = parProfondeur(rendre(makeProject((p) => { p.lighting.shadowStrength = 1; p.lighting.cavityOcclusion = 1; })));
  const expo = parProfondeur(rendre(makeProject((p) => { p.lighting.exposureEv = -1; })));

  const varCreuxOmbres = (ombres.creux - base.creux) / base.creux;
  const varPlateauxOmbres = (ombres.plateaux - base.plateaux) / base.plateaux;
  const varCreuxExpo = (expo.creux - base.creux) / base.creux;
  const varPlateauxExpo = (expo.plateaux - base.plateaux) / base.plateaux;

  console.log(`   ombres au maximum : creux ${(100 * varCreuxOmbres).toFixed(1)} %   plateaux ${(100 * varPlateauxOmbres).toFixed(1)} %`);
  console.log(`   exposition −1 EV  : creux ${(100 * varCreuxExpo).toFixed(1)} %   plateaux ${(100 * varPlateauxExpo).toFixed(1)} %`);

  check('B1 — les ombres creusent fortement les creux', varCreuxOmbres < -0.4, `${(100 * varCreuxOmbres).toFixed(1)} %`);
  check('B2 — les ombres ne touchent PAS les plateaux', Math.abs(varPlateauxOmbres) < 0.05, `${(100 * varPlateauxOmbres).toFixed(1)} %`);
  check('B3 — l’exposition agit sur toute l’image', varPlateauxExpo < -0.3, `plateaux ${(100 * varPlateauxExpo).toFixed(1)} %`);
  check(
    'B4 — les deux commandes sont distinctes, pas deux noms du même effet',
    Math.abs(varPlateauxOmbres) < Math.abs(varPlateauxExpo) / 5,
    `plateaux : ${(100 * varPlateauxOmbres).toFixed(1)} % par les ombres contre ${(100 * varPlateauxExpo).toFixed(1)} % par l’exposition`
  );
}

// ---- C. §8 : quatre matières, quatre réponses à la lumière ----
//
// Comparer des MÉDIANES ne suffit pas : mat et brillant ont pratiquement la
// même médiane de plateau (217,3 contre 217,4). Ce qui les sépare est la forme
// du reflet — large et doux pour le satiné, étroit et intense pour le brillant.
// On mesure donc l'écart MOYEN (étendue du reflet) et l'écart MAXIMAL
// (intensité), deux grandeurs qui se croisent entre ces deux finitions.

console.log('\nC. Les quatre finitions répondent différemment (§8)\n');
{
  const ref = rendre(makeProject((p) => { p.material.finish = 'mat'; })).data;
  const signature = (finish) => {
    const data = rendre(makeProject((p) => { p.material.finish = finish; })).data;
    let somme = 0;
    let max = 0;
    let satures = 0;
    for (let i = 0; i < W * H; i++) {
      const l = luminance(data, i);
      if (l > 250) satures++;
      const e = Math.abs(l - luminance(ref, i));
      somme += e;
      if (e > max) max = e;
    }
    return { moyen: somme / (W * H), max, satures };
  };

  const mat = signature('mat');
  const satine = signature('satine');
  const brillant = signature('brillant');
  const chrome = signature('chrome');
  for (const [nom, s] of [['mat', mat], ['satiné', satine], ['brillant', brillant], ['chrome', chrome]]) {
    console.log(`   ${nom.padEnd(9)} écart moyen ${s.moyen.toFixed(2)}   écart max ${s.max.toFixed(1)}   pixels saturés ${s.satures}`);
  }

  check('C1 — le tableau des finitions couvre les quatre noms', ['mat', 'satine', 'brillant', 'chrome'].every((f) => FINISHES[f]));
  check('C2 — « mat » est la référence, sans reflet spéculaire', FINISHES.mat.roughness === 1 && FINISHES.mat.metal === 0);
  check('C3 — chaque finition se distingue de « mat »', satine.moyen > 2 && brillant.max > 40 && chrome.moyen > 20,
    `satiné ${satine.moyen.toFixed(2)} moyen · brillant ${brillant.max.toFixed(1)} max · chrome ${chrome.moyen.toFixed(2)} moyen`);
  check(
    'C4 — satiné diffuse large, brillant concentre',
    satine.moyen > brillant.moyen && brillant.max > satine.max,
    `moyens ${satine.moyen.toFixed(2)} > ${brillant.moyen.toFixed(2)} et max ${brillant.max.toFixed(1)} > ${satine.max.toFixed(1)}`
  );
  check('C5 — le chrome est le plus éloigné du plâtre', chrome.moyen > satine.moyen && chrome.moyen > brillant.moyen, `${chrome.moyen.toFixed(2)}`);
}

// ---- D. La couture : un patch doit être indiscernable du rendu complet ----
//
// Deux chemins remplissent la MÊME carte de hauteurs : `renderFull` passe par
// `resampleTo` (séparable, poids précalculés), `renderPatch` par `sampleHeight`
// (bicubique ponctuel). Ce sont deux implémentations INDÉPENDANTES du même
// interpolant : si elles divergeaient, le bord d'un patch laisserait une marque
// visible pendant un trait de sculpture. La vérification les confronte.

console.log('\nD. Couture entre le rendu complet et le repeint partiel\n');
{
  const project = makeProject();
  const { hm, map, ao, sp, data } = rendre(project);
  const halfW = project.widthCm / 2;
  const halfH = project.heightCm / 2;

  let ecartMax = 0;
  for (let y = 0; y < H; y++) {
    const yCm = -halfH + (y / (H - 1)) * project.heightCm;
    for (let x = 0; x < W; x++) {
      const xCm = -halfW + (x / (W - 1)) * project.widthCm;
      const d = Math.abs(map[y * W + x] - sampleHeight(hm, xCm, yCm));
      if (d > ecartMax) ecartMax = d;
    }
  }
  const amplitude = hm.max - hm.min;
  console.log(`   écart maximal entre les deux échantillonneurs : ${ecartMax.toExponential(2)} cm sur ${amplitude.toFixed(3)} cm d’amplitude`);
  check('D1 — les deux échantillonneurs donnent la même hauteur', ecartMax < 1e-5, `${ecartMax.toExponential(2)} cm`);

  // Ombrage d'une fenêtre intérieure : chaque octet doit valoir celui du rendu
  // complet. Les bords de la fenêtre sont EXCLUS — les normales y sont prises
  // par différences finies serrées contre la bordure du tampon, exactement ce
  // que la marge de deux pixels de `renderPatch` sert à couvrir.
  const [px0, py0, px1, py1] = [96, 60, 224, 150];
  const pw = px1 - px0;
  const ph = py1 - py0;
  const patch = new Uint8ClampedArray(pw * ph * 4);
  shadeRegion(patch, map, ao, W, H, px0, py0, px1, py1, px0, py0, W, H, sp);

  let identiques = 0;
  let differents = 0;
  let ecartOctetMax = 0;
  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      const ip = (y * pw + x) * 4;
      const ig = ((py0 + y) * W + (px0 + x)) * 4;
      let egal = true;
      for (let c = 0; c < 4; c++) {
        const e = Math.abs(patch[ip + c] - data[ig + c]);
        if (e > ecartOctetMax) ecartOctetMax = e;
        if (e !== 0) egal = false;
      }
      if (egal) identiques++;
      else differents++;
    }
  }
  console.log(`   ${identiques} pixels identiques, ${differents} différents, écart maximal ${ecartOctetMax} niveau(x)`);
  check('D2 — le patch est identique octet pour octet au rendu complet', differents === 0 && identiques > 10000, `${differents} pixel(s) divergent(s)`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
