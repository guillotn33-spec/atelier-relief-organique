// Heightmap canonique — bornes, mise à jour partielle, surface de référence.
//
//   node tests/heightmap.mjs
//
// Ces vérifications scellent deux défauts trouvés à l'audit du lot 6, tous deux
// invisibles à l'écran et visibles seulement dans un fichier exporté ou sur un
// format extrême. Un rendu qui a l'air juste n'est pas une preuve : c'est
// précisément pourquoi ils avaient survécu à six lots.

import { buildHeightmap, updateHeightmapRect, sampleAo, AO_MIN_CELLS } from '../src/geometry/heightmap.js';
import { createProject, PRESETS, defaultGeometry } from '../src/core/project.js';
import { shadeParams, shadeRegion } from '../src/render2d/shade.js';
import { SculptLayer } from '../src/sculpt/layer.js';
import { stamp } from '../src/sculpt/brush.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

function makeProject(widthCm, heightCm, depthCm = 6, shape = 'rectangle') {
  const project = createProject({ canvasShape: shape, widthCm, heightCm, depthCm, name: 'Essai heightmap' });
  Object.assign(project.geometry, defaultGeometry(), PRESETS.dunes.geometry);
  return project;
}

/** Applique un trait au calque et retourne le rectangle en cm qu'il a sali. */
function tracer(layer, tool, { x0 = -60, x1 = 60, y = 0, radiusCm = 20, strength = 1, pas = 9 } = {}) {
  let rect = null;
  let precedent = x0;
  for (let x = x0; x <= x1; x += pas) {
    const r = stamp(layer, { tool, xCm: x, yCm: y, dxCm: x - precedent, dyCm: 0, radiusCm, strength, pressure: 1, first: x === x0 });
    if (r) {
      rect = rect
        ? { x0: Math.min(rect.x0, r.x0), y0: Math.min(rect.y0, r.y0), x1: Math.max(rect.x1, r.x1), y1: Math.max(rect.y1, r.y1) }
        : r;
    }
    precedent = x;
  }
  return rect;
}

const bornesReelles = (hm) => {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of hm.h) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, sum };
};

// ---- A. Les bornes survivent à une mise à jour partielle ----
//
// DÉFAUT SCELLÉ ICI. `updateHeightmapRect` entretenait `sum` par différence mais
// laissait `min` et `max` à leur valeur de construction. Sculpter en relief
// au-dessus du maximum initial, puis exporter, produisait un panneau plus épais
// que déclaré dont la face avant n'était plus à z = 0 : mesuré à 6,982 cm pour
// 6 cm annoncés, face avant à +0,982 cm. Rien ne le montrait à l'écran.
//
// Le trait passe par `updateHeightmapRect` et NON par `buildHeightmap` : c'est
// le chemin partiel qui était fautif, une reconstruction complète a toujours
// donné les bonnes bornes.

console.log('\nA. Bornes de la heightmap après un trait\n');
{
  const project = makeProject(200, 120, 6);
  const layer = SculptLayer.forCanvas(200, 120);
  const hm = buildHeightmap(project, layer);
  const avant = { min: hm.min, max: hm.max };

  const rect = tracer(layer, 'raise');
  updateHeightmapRect(hm, project, layer, { x0: rect.x0 - 12, y0: rect.y0 - 12, x1: rect.x1 + 12, y1: rect.y1 + 12 });

  const vrai = bornesReelles(hm);
  console.log(`   avant le trait : min ${avant.min.toFixed(4)}  max ${avant.max.toFixed(4)}`);
  console.log(`   après (stockées) : min ${hm.min.toFixed(4)}  max ${hm.max.toFixed(4)}`);
  console.log(`   après (mesurées) : min ${vrai.min.toFixed(4)}  max ${vrai.max.toFixed(4)}`);

  check('A1 — le trait a bien dépassé le maximum d’origine', vrai.max > avant.max + 1e-6, `${vrai.max.toFixed(4)} contre ${avant.max.toFixed(4)}`);
  check('A2 — le maximum stocké est le maximum réel', hm.max === vrai.max, `${hm.max.toFixed(6)} contre ${vrai.max.toFixed(6)}`);
  check('A3 — le minimum stocké est le minimum réel', hm.min === vrai.min, `${hm.min.toFixed(6)} contre ${vrai.min.toFixed(6)}`);
  check('A4 — la somme stockée reste juste', Math.abs(hm.sum - vrai.sum) / Math.abs(vrai.sum) < 1e-4, `${hm.sum.toFixed(2)} contre ${vrai.sum.toFixed(2)}`);

  // LA CONSÉQUENCE, MESURÉE ET NON DÉDUITE.
  //
  // Jusqu'au retrait du périmètre 3D, ce défaut se démontrait sur le maillage
  // exporté : des bornes périmées donnaient un panneau de 6,982 cm pour 6 cm
  // déclarés. Le maillage n'existe plus, mais les bornes restent porteuses —
  // `shadeParams` reçoit `hm.max − hm.min` comme amplitude, et c'est elle qui
  // règle la profondeur d'occlusion. Des bornes fausses ne déforment donc plus
  // un fichier : elles déforment l'IMAGE. On le montre en ombrant deux fois la
  // même carte, avec l'amplitude juste puis avec celle d'avant le trait.
  const amplitudeJuste = hm.max - hm.min;
  const amplitudePerimee = avant.max - avant.min;
  const W = 160;
  const H = 100;
  const carte = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      carte[y * W + x] = hm.h[Math.min(hm.rows - 1, y * 3) * hm.cols + Math.min(hm.cols - 1, x * 3)];
    }
  }
  const ao = new Float32Array(W * H).fill(hm.sum / hm.h.length);
  // On regarde le DÉCILE LE PLUS SOMBRE, pas la moyenne : l'amplitude règle la
  // profondeur d'occlusion, donc les fonds de cavité. Une moyenne sur toute
  // l'image dilue l'effet dans les plateaux, que l'occlusion ne touche pas —
  // mesuré 1,0 % en moyenne contre bien davantage sur les creux.
  const creux = (amplitude) => {
    const sp = shadeParams(project, W, amplitude);
    const data = new Uint8ClampedArray(W * H * 4);
    shadeRegion(data, carte, ao, W, H, 0, 0, W, H, 0, 0, W, H, sp);
    const lum = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum.sort();
    const dec = Math.max(1, Math.floor(lum.length / 10));
    let somme = 0;
    for (let i = 0; i < dec; i++) somme += lum[i];
    return somme / dec;
  };
  const avecJuste = creux(amplitudeJuste);
  const avecPerimee = creux(amplitudePerimee);
  const ecartPct = (100 * Math.abs(avecJuste - avecPerimee)) / Math.max(1, avecJuste);
  console.log(`   amplitude juste ${amplitudeJuste.toFixed(4)} cm contre périmée ${amplitudePerimee.toFixed(4)} cm`);
  console.log(`   fonds de cavité : ${avecJuste.toFixed(1)} contre ${avecPerimee.toFixed(1)} — écart ${ecartPct.toFixed(1)} %`);
  check('A5 — des bornes périmées changeraient visiblement l’image', ecartPct > 5, `${ecartPct.toFixed(1)} % sur les fonds de cavité`);
  check('A6 — l’amplitude transmise à l’ombrage est la vraie', Math.abs(amplitudeJuste - (vrai.max - vrai.min)) < 1e-9, `${amplitudeJuste.toFixed(6)} cm`);
}

// ---- B. Un trait « creuser » ne déborde pas non plus ----

console.log('\nB. Le même contrôle sur un trait en creux\n');
{
  const project = makeProject(160, 100, 4);
  const layer = SculptLayer.forCanvas(160, 100);
  const hm = buildHeightmap(project, layer);
  const rect = tracer(layer, 'dig', { x0: -50, x1: 50, radiusCm: 18 });
  updateHeightmapRect(hm, project, layer, { x0: rect.x0 - 10, y0: rect.y0 - 10, x1: rect.x1 + 10, y1: rect.y1 + 10 });

  const vrai = bornesReelles(hm);
  check('B1 — bornes exactes après un creusement', hm.min === vrai.min && hm.max === vrai.max, `min ${hm.min.toFixed(6)} / ${vrai.min.toFixed(6)}, max ${hm.max.toFixed(6)} / ${vrai.max.toFixed(6)}`);

  // Le relief creusé doit rester dans la profondeur déclarée : c'est le champ
  // lui-même qu'on vérifie, sans passer par une géométrie exportée.
  console.log(`   relief : de ${hm.min.toFixed(4)} à ${hm.max.toFixed(4)} cm sur ${project.depthCm} cm déclarés`);
  check(
    'B2 — le relief tient dans la profondeur du panneau',
    hm.max - hm.min <= project.depthCm + 1e-6,
    `${(hm.max - hm.min).toFixed(4)} cm pour ${project.depthCm} cm`
  );
}

// ---- C. Surface de référence : jamais dégénérée, même sur un panneau étroit ----
//
// DÉFAUT SCELLÉ ICI. La grille décimée de `buildAoField` pouvait tomber à une
// poignée de cellules sur un format très allongé : la « surface de référence
// locale » n'était alors plus locale du tout, et l'occlusion des creux se
// calculait contre une moyenne quasi globale. Mesuré avant correction :
// jusqu'à 25,9 % d'écart sur l'occlusion d'un panneau 120 × 120 ; après, 2,0 %.
//
// L'oracle est une MOYENNE LOCALE EXACTE, calculée ici par image intégrale sur
// la grille pleine — une implémentation indépendante de `buildAoField`, qui
// n'emprunte ni sa décimation ni son flou. Le résidu qu'elle mesure mélange
// deux choses : la perte due à la décimation, et l'écart de forme entre une
// moyenne de boîte et le flou à trois passes du code. Le seuil est donc posé
// au-dessus du pire cas mesuré (7,4 %) sans prétendre isoler l'une des deux.

/** Moyenne de boîte exacte, par image intégrale. Ne dépend d'aucun code testé. */
function moyenneLocale(hm, rayonCellules) {
  const { cols, rows, h } = hm;
  const S = new Float64Array((cols + 1) * (rows + 1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      S[(r + 1) * (cols + 1) + (c + 1)] = h[r * cols + c] + S[r * (cols + 1) + (c + 1)] + S[(r + 1) * (cols + 1) + c] - S[r * (cols + 1) + c];
    }
  }
  const out = new Float64Array(cols * rows);
  const R = Math.max(1, Math.round(rayonCellules));
  for (let r = 0; r < rows; r++) {
    const r0 = Math.max(0, r - R);
    const r1 = Math.min(rows - 1, r + R);
    for (let c = 0; c < cols; c++) {
      const c0 = Math.max(0, c - R);
      const c1 = Math.min(cols - 1, c + R);
      const som = S[(r1 + 1) * (cols + 1) + (c1 + 1)] - S[r0 * (cols + 1) + (c1 + 1)] - S[(r1 + 1) * (cols + 1) + c0] + S[r0 * (cols + 1) + c0];
      out[r * cols + c] = som / ((r1 - r0 + 1) * (c1 - c0 + 1));
    }
  }
  return out;
}

console.log('\nC. Surface de référence sur des formats extrêmes\n');
{
  const formats = [
    [200, 120], [200, 30], [500, 12], [300, 18], [120, 120],
    [12, 12], [500, 200], [40, 200], [1, 1],
  ];
  let pire = 0;
  let pireFormat = null;
  let cellulesMin = Infinity;
  for (const [w, h] of formats) {
    const project = makeProject(w, h, 6);
    const hm = buildHeightmap(project, null);
    const decime = hm.ao;

    // Le rayon réellement employé, plafonné comme dans `buildAoField` : un rayon
    // plus large que le demi-panneau n'a pas de sens.
    const rayonUtile = Math.min(hm.aoRadius, Math.min(hm.cols, hm.rows) / 2);
    const reference = moyenneLocale(hm, rayonUtile);

    let etendue = 0;
    for (const v of hm.h) etendue = Math.max(etendue, Math.abs(v));

    let somme = 0;
    let n = 0;
    for (let r = 0; r < hm.rows; r += 2) {
      for (let c = 0; c < hm.cols; c += 2) {
        const xCm = hm.originXCm + c * hm.cellCm;
        const yCm = hm.originYCm + r * hm.cellCm;
        somme += Math.abs(sampleAo(decime, xCm, yCm) - reference[r * hm.cols + c]);
        n++;
      }
    }
    const cellules = Math.min(decime.cols, decime.rows);
    if (cellules < cellulesMin) cellulesMin = cellules;
    const ecart = etendue > 0 ? somme / n / etendue : 0;
    if (ecart > pire) { pire = ecart; pireFormat = `${w} × ${h}`; }
    console.log(`   ${String(w).padStart(3)} × ${String(h).padStart(3)} cm   grille ${hm.cols}×${hm.rows}   occlusion ${decime.cols}×${decime.rows}   écart ${(100 * ecart).toFixed(1)} %`);
  }
  check('C1 — la surface de référence garde assez de cellules', cellulesMin >= AO_MIN_CELLS, `plus petit côté : ${cellulesMin} cellules, plancher ${AO_MIN_CELLS}`);
  check('C2 — la surface de référence reste une moyenne LOCALE', pire < 0.12, `pire écart ${(100 * pire).toFixed(1)} % sur ${pireFormat}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
