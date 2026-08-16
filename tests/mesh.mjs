// Mesh 3D (§9) — éprouvé sans navigateur ni WebGL.
//
//   node tests/mesh.mjs
//
// L'exigence centrale de §9 est que la vue 3D et l'édition 2D montrent
// EXACTEMENT le même relief. Ce n'est pas une question d'apparence : le mesh est
// construit à partir de la heightmap canonique, et ce test le vérifie sommet par
// sommet contre cette même heightmap.

import { buildHeightmap } from '../src/geometry/heightmap.js';
import { buildReliefMesh } from '../src/render3d/mesh.js';
import { createProject, PRESETS, defaultGeometry } from '../src/core/project.js';
import { SculptLayer } from '../src/sculpt/layer.js';
import { stamp } from '../src/sculpt/brush.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

function makeProject(shape, widthCm, heightCm, depthCm = 6) {
  const project = createProject({ canvasShape: shape, widthCm, heightCm, depthCm });
  Object.assign(project.geometry, defaultGeometry(), PRESETS.dunes.geometry);
  return project;
}

// ---- A. Le mesh porte le relief de la heightmap, pas un autre ----

console.log('\nA. Le mesh 3D et la heightmap portent le même relief\n');
{
  const project = makeProject('rectangle', 200, 120, 6);
  const hm = buildHeightmap(project, null);
  const mesh = buildReliefMesh(project, hm);

  // Chaque sommet doit retomber sur la hauteur de la heightmap, à la conversion
  // en centimètres près. On la refait ici dans l'autre sens.
  const span = hm.max - hm.min;
  let maxErr = 0;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const x = mesh.positions[v * 3];
    const y = -mesh.positions[v * 3 + 1]; // la scène inverse y
    const z = mesh.positions[v * 3 + 2];
    const col = Math.round(hm.colAt(x));
    const row = Math.round(hm.rowAt(y));
    if (col < 0 || row < 0 || col >= hm.cols || row >= hm.rows) continue;
    const attendu = (hm.h[row * hm.cols + col] - hm.max) * (project.depthCm / span);
    maxErr = Math.max(maxErr, Math.abs(attendu - z));
  }
  console.log(`   ${mesh.vertexCount} sommets, ${mesh.triangles} triangles, pas d'échantillonnage ${mesh.stride}`);
  console.log(`   écart maximal sommet / heightmap : ${maxErr.toExponential(2)} cm`);
  check('A1 — chaque sommet reprend la hauteur de la heightmap', maxErr < 1e-4, `${maxErr.toExponential(2)} cm`);

  // Axe Z : le plateau le plus haut est la face avant, le plus creux à −depthCm.
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const z = mesh.positions[v * 3 + 2];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  console.log(`   plage de Z : ${zMin.toFixed(3)} à ${zMax.toFixed(3)} cm (profondeur du projet : ${project.depthCm} cm)`);
  check('A2 — Z dérive de depthCm', Math.abs(zMax) < 1e-4 && Math.abs(zMin + project.depthCm) < 1e-3, `${zMin.toFixed(3)} … ${zMax.toFixed(3)}`);

  // Dimensions X/Y = dimensions physiques.
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const largeur = xMax - xMin;
  const hauteur = yMax - yMin;
  console.log(`   emprise : ${largeur.toFixed(2)} × ${hauteur.toFixed(2)} cm (projet : ${project.widthCm} × ${project.heightCm})`);
  check(
    'A3 — X/Y aux dimensions physiques du projet',
    Math.abs(largeur - project.widthCm) < hm.cellCm * mesh.stride + 0.01 &&
      Math.abs(hauteur - project.heightCm) < hm.cellCm * mesh.stride + 0.01,
    `${largeur.toFixed(2)} × ${hauteur.toFixed(2)} cm`
  );
}

// ---- B. La sculpture se retrouve dans le mesh ----

console.log('\nB. Une sculpture 2D apparaît dans le mesh\n');
{
  const project = makeProject('rectangle', 200, 120, 6);
  const layer = SculptLayer.forCanvas(200, 120);
  const avant = buildReliefMesh(project, buildHeightmap(project, layer));

  for (let i = 0; i < 8; i++) {
    stamp(layer, { tool: 'dig', xCm: -40 + i * 11, yCm: 6, dxCm: 11, dyCm: 0, radiusCm: 16, strength: 0.8, pressure: 1, first: i === 0 });
  }
  const apres = buildReliefMesh(project, buildHeightmap(project, layer));

  let maxDelta = 0;
  for (let v = 0; v < Math.min(avant.vertexCount, apres.vertexCount); v++) {
    maxDelta = Math.max(maxDelta, Math.abs(avant.positions[v * 3 + 2] - apres.positions[v * 3 + 2]));
  }
  console.log(`   déplacement maximal d'un sommet après le trait : ${maxDelta.toFixed(3)} cm`);
  check('B1 — la sculpture déplace réellement le mesh', maxDelta > 0.2, `${maxDelta.toFixed(3)} cm`);
}

// ---- C. Le rond ne garde pas de sommets inutiles ----

console.log('\nC. Toile ronde : masque circulaire\n');
{
  const project = makeProject('circle', 130, 130, 6);
  const hm = buildHeightmap(project, null);
  const mesh = buildReliefMesh(project, hm);
  const radius = project.widthCm / 2;

  let dehors = 0;
  let rayonMax = 0;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const d = Math.hypot(x, y);
    rayonMax = Math.max(rayonMax, d);
    if (d > radius + 1e-6) dehors++;
  }
  const carre = buildReliefMesh(makeProject('square', 130, 130, 6), buildHeightmap(makeProject('square', 130, 130, 6), null));
  const ratio = mesh.vertexCount / carre.vertexCount;
  console.log(`   rond : ${mesh.vertexCount} sommets — carré de même côté : ${carre.vertexCount}`);
  console.log(`   rapport ${ratio.toFixed(3)} (π/4 ≈ 0,785 attendu)   rayon maximal ${rayonMax.toFixed(2)} cm`);
  check('C1 — aucun sommet hors du disque', dehors === 0, `${dehors} sommet(s) hors disque`);
  check('C2 — les sommets extérieurs ne sont pas conservés', ratio < 0.85 && ratio > 0.70, `rapport ${ratio.toFixed(3)}`);
}

// ---- D. UV propres et continus ----

console.log('\nD. UV\n');
{
  const project = makeProject('rectangle', 200, 120, 6);
  const mesh = buildReliefMesh(project, buildHeightmap(project, null));
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let horsPlage = 0;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const u = mesh.uvs[v * 2];
    const w = mesh.uvs[v * 2 + 1];
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (w < vMin) vMin = w;
    if (w > vMax) vMax = w;
    if (u < -1e-6 || u > 1 + 1e-6 || w < -1e-6 || w > 1 + 1e-6) horsPlage++;
  }
  console.log(`   u ∈ [${uMin.toFixed(4)}, ${uMax.toFixed(4)}]   v ∈ [${vMin.toFixed(4)}, ${vMax.toFixed(4)}]`);
  check('D1 — UV dans [0,1], sans débordement', horsPlage === 0, `${horsPlage} sommet(s) hors plage`);
  check('D2 — UV couvrant toute la toile', uMin < 0.002 && uMax > 0.998 && vMin < 0.002 && vMax > 0.998);

  // Continuité : deux sommets voisins ne doivent jamais sauter d'un bord à l'autre.
  let sautMax = 0;
  for (let r = 0; r < mesh.rows; r++) {
    for (let c = 1; c < mesh.cols; c++) {
      const a = r * mesh.cols + c - 1;
      const b = r * mesh.cols + c;
      if (a >= mesh.vertexCount || b >= mesh.vertexCount) continue;
      sautMax = Math.max(sautMax, Math.abs(mesh.uvs[b * 2] - mesh.uvs[a * 2]));
    }
  }
  check('D3 — aucune couture dans les UV', sautMax < 0.05, `saut maximal ${sautMax.toFixed(4)}`);
}

// ---- E. Densité bornée, indices valides ----

console.log('\nE. Maillage\n');
{
  const grand = makeProject('rectangle', 500, 200, 12);
  const hm = buildHeightmap(grand, null);
  const mesh = buildReliefMesh(grand, hm);
  console.log(`   panneau 500 × 200 : heightmap ${hm.cols}×${hm.rows}, mesh ${mesh.cols}×${mesh.rows} (pas ${mesh.stride}), ${mesh.triangles} triangles`);
  check('E1 — nombre de triangles borné', mesh.triangles <= 240000, `${mesh.triangles} triangles`);

  let indicesValides = true;
  for (let i = 0; i < mesh.indices.length; i++) {
    if (mesh.indices[i] >= mesh.vertexCount) {
      indicesValides = false;
      break;
    }
  }
  check('E2 — tous les indices pointent sur un sommet existant', indicesValides);

  let normalesUnitaires = true;
  for (let v = 0; v < mesh.vertexCount; v += 17) {
    const len = Math.hypot(mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]);
    if (Math.abs(len - 1) > 1e-4) {
      normalesUnitaires = false;
      break;
    }
  }
  check('E3 — normales unitaires', normalesUnitaires);

  // Orientation : vues de face, les normales doivent regarder l'observateur.
  let versArriere = 0;
  for (let v = 0; v < mesh.vertexCount; v++) if (mesh.normals[v * 3 + 2] <= 0) versArriere++;
  check('E4 — toutes les normales regardent vers l’avant', versArriere === 0, `${versArriere} normale(s) inversée(s)`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
