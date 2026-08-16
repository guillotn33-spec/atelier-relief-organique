// Exports (§17, §18) — la part éprouvable sans navigateur.
//
//   node tests/export.mjs
//
// L'exigence la plus dure de §18 est négative : « ne jamais exporter une simple
// image appliquée sur un rectangle plat en prétendant qu'il s'agit du relief
// 3D ». On ne peut pas la vérifier en regardant un fichier s'ouvrir — il faut
// mesurer que la géométrie exportée porte bien le relief, sommet par sommet.

import { buildHeightmap } from '../src/geometry/heightmap.js';
import { createProject, PRESETS, defaultGeometry } from '../src/core/project.js';
import { outputSizeFor, MAX_PIXELS } from '../src/export/image.js';
import { exportObj, exportUsdz, materialNameFor } from '../src/export/model.js';
import { SculptLayer } from '../src/sculpt/layer.js';
import { stamp } from '../src/sculpt/brush.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

function makeProject(shape, widthCm, heightCm, depthCm = 6) {
  const project = createProject({ canvasShape: shape, widthCm, heightCm, depthCm, name: 'Panneau essai' });
  Object.assign(project.geometry, defaultGeometry(), PRESETS.dunes.geometry);
  return project;
}

// ---- A. Définition d'image (§17) ----

console.log('\nA. Définition d’image : le rapport vient du projet\n');
{
  const cases = [
    ['rectangle 200 × 120', makeProject('rectangle', 200, 120), 2048],
    ['portrait 90 × 180', makeProject('rectangle', 90, 180), 2048],
    ['carré 120', makeProject('square', 120, 120), 4096],
    ['rond 130', makeProject('circle', 130, 130), 2048],
    ['bandeau 500 × 60', makeProject('rectangle', 500, 60), 4096],
  ];
  let rapportsOk = true;
  let grandCoteOk = true;
  for (const [label, project, longSide] of cases) {
    const out = outputSizeFor(project, longSide);
    const rapportImage = out.width / out.height;
    const rapportProjet = project.widthCm / project.heightCm;
    const ecart = Math.abs(rapportImage - rapportProjet) / rapportProjet;
    const grand = Math.max(out.width, out.height);
    console.log(`   ${label.padEnd(20)} → ${out.width} × ${out.height}   rapport ${rapportImage.toFixed(4)} contre ${rapportProjet.toFixed(4)}`);
    if (ecart > 0.002) rapportsOk = false;
    if (Math.abs(grand - longSide) > 1) grandCoteOk = false;
  }
  check('A1 — le rapport de l’image est celui du projet', rapportsOk);
  check('A2 — le grand côté est celui demandé', grandCoteOk);

  // Le plafond doit intervenir, et le DIRE.
  const enorme = outputSizeFor(makeProject('square', 200, 200), 40000);
  console.log(`   demande absurde de 40 000 px → ${enorme.width} × ${enorme.height}, signalé : ${enorme.clamped}`);
  check('A3 — une définition délirante est plafonnée', enorme.width * enorme.height <= MAX_PIXELS && enorme.clamped);
  check('A4 — le plafond est signalé, pas silencieux', enorme.clamped === true);
}

// ---- B. OBJ : géométrie, unités, matériau ----

console.log('\nB. Export OBJ\n');
{
  const project = makeProject('rectangle', 200, 120, 6);
  const hm = buildHeightmap(project, null);
  const { objText, mtlText, baseName, built } = exportObj(project, hm, { maxTriangles: 40000 });

  const lignes = objText.split('\n');
  const v = lignes.filter((l) => l.startsWith('v ')).length;
  const vn = lignes.filter((l) => l.startsWith('vn ')).length;
  const vt = lignes.filter((l) => l.startsWith('vt ')).length;
  const f = lignes.filter((l) => l.startsWith('f ')).length;
  console.log(`   ${v} sommets, ${vn} normales, ${vt} UV, ${f} faces (mesh : ${built.vertexCount} sommets, ${built.triangles} triangles)`);
  check('B1 — sommets, normales et UV en nombre égal', v === vn && v === vt && v === built.vertexCount, `${v} / ${vn} / ${vt}`);
  check('B2 — une face par triangle', f === built.triangles, `${f} contre ${built.triangles}`);

  check('B3 — le MTL est déclaré par mtllib', objText.includes(`mtllib ${baseName}.mtl`));
  check('B4 — le matériau utilisé existe dans le MTL', objText.includes(`usemtl ${materialNameFor(project)}`) && mtlText.includes(`newmtl ${materialNameFor(project)}`));

  // Unités : le panneau doit mesurer 2,00 × 1,20 m et 0,06 m d'épaisseur.
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const ligne of lignes) {
    if (!ligne.startsWith('v ')) continue;
    const [, x, y, z] = ligne.split(/\s+/).map(Number);
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  console.log(`   emprise exportée : ${(xMax - xMin).toFixed(3)} × ${(yMax - yMin).toFixed(3)} × ${(zMax - zMin).toFixed(3)} m`);
  check(
    'B5 — dimensions cohérentes, en mètres',
    Math.abs(xMax - xMin - 2.0) < 0.01 && Math.abs(yMax - yMin - 1.2) < 0.01 && Math.abs(zMax - zMin - 0.06) < 0.002,
    `${(xMax - xMin).toFixed(3)} × ${(yMax - yMin).toFixed(3)} × ${(zMax - zMin).toFixed(3)} m`
  );

  // §18 : ce n'est PAS un rectangle plat. Un plan aurait un Z constant.
  const relief = zMax - zMin;
  check('B6 — la géométrie porte le relief, ce n’est pas un plan', relief > 0.01, `amplitude en Z : ${relief.toFixed(4)} m`);
}

// ---- C. Le relief exporté suit la sculpture ----

console.log('\nC. L’export suit l’œuvre affichée\n');
{
  const project = makeProject('rectangle', 200, 120, 6);
  const layer = SculptLayer.forCanvas(200, 120);
  const avant = exportObj(project, buildHeightmap(project, layer), { maxTriangles: 20000 }).objText;
  for (let i = 0; i < 8; i++) {
    stamp(layer, { tool: 'dig', xCm: -40 + i * 11, yCm: 6, dxCm: 11, dyCm: 0, radiusCm: 16, strength: 0.85, pressure: 1, first: i === 0 });
  }
  const apres = exportObj(project, buildHeightmap(project, layer), { maxTriangles: 20000 }).objText;
  check('C1 — sculpter change le fichier exporté', avant !== apres, `${avant.length} contre ${apres.length} caractères`);
}

// ---- D. USDZ ----

console.log('\nD. Export USDZ\n');
{
  const project = makeProject('rectangle', 200, 120, 6);
  const hm = buildHeightmap(project, null);
  const { data, built } = await exportUsdz(project, hm, { maxTriangles: 40000 });
  console.log(`   ${data.length} octets pour ${built.triangles} triangles`);

  // Un USDZ est une archive ZIP non compressée : signature « PK\\x03\\x04 ».
  const signature = String.fromCharCode(data[0], data[1]) + data[2] + ',' + data[3];
  check('D1 — l’archive est un ZIP valide', data[0] === 0x50 && data[1] === 0x4b && data[2] === 3 && data[3] === 4, signature);
  // L'archive entière est décodée : `points` arrive APRÈS le tableau d'indices,
  // qui pèse plusieurs centaines de kilo-octets. Une lecture partielle
  // concluait à tort que les points manquaient.
  const texte = new TextDecoder('utf-8', { fatal: false }).decode(data);
  check('D2 — l’archive contient une scène USD', texte.includes('#usda 1.0'), 'en-tête #usda 1.0');
  check('D3 — le maillage est déclaré, pas une image plaquée', /def Mesh/.test(texte) && texte.includes('points = ['), 'primitive Mesh avec tableau de points');
  check('D4 — les normales sont exportées', texte.includes('normals = ['));
  check('D5 — les UV sont exportés', texte.includes('primvars:st = ['));
  check('D6 — un matériau est attaché', texte.includes('UsdPreviewSurface'));

  // Unités : USDZ déclare metersPerUnit = 1, donc les points DOIVENT être en
  // mètres. Un panneau de 200 cm exporté en centimètres arriverait à 200 m en
  // réalité augmentée. On lit les coordonnées dans le fichier plutôt que de
  // faire confiance au code qui vient de les écrire.
  check('D8 — l’échelle déclarée est le mètre', /metersPerUnit\s*=\s*1/.test(texte));
  const bloc = texte.slice(texte.indexOf('points = ['), texte.indexOf('points = [') + 4000);
  const triplets = [...bloc.matchAll(/\(([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+)\)/g)].slice(0, 200);
  let maxAbs = 0;
  for (const t of triplets) maxAbs = Math.max(maxAbs, Math.abs(+t[1]), Math.abs(+t[2]));
  console.log(`   ${triplets.length} points relus dans l'archive, coordonnée maximale ${maxAbs.toFixed(3)}`);
  check(
    'D9 — les coordonnées sont bien en mètres',
    triplets.length > 20 && maxAbs > 0.3 && maxAbs < 1.6,
    `maximum ${maxAbs.toFixed(3)} (attendu ≈ 1,0 pour un panneau de 2 m)`
  );

  check('D7 — poids raisonnable', data.length > 10000 && data.length < 40e6, `${(data.length / 1e6).toFixed(2)} Mo`);
}

// ---- E. Rond : le disque est exporté, pas son rectangle ----

console.log('\nE. Toile ronde\n');
{
  const rond = makeProject('circle', 130, 130, 6);
  const carre = makeProject('square', 130, 130, 6);
  const objRond = exportObj(rond, buildHeightmap(rond, null), { maxTriangles: 40000 });
  const objCarre = exportObj(carre, buildHeightmap(carre, null), { maxTriangles: 40000 });
  const ratio = objRond.built.vertexCount / objCarre.built.vertexCount;
  console.log(`   rond ${objRond.built.vertexCount} sommets, carré ${objCarre.built.vertexCount} — rapport ${ratio.toFixed(3)}`);
  check('E1 — le rond n’exporte pas les sommets de son rectangle', ratio > 0.70 && ratio < 0.85, `rapport ${ratio.toFixed(3)}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
