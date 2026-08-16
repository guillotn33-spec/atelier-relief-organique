// Export 3D pour Procreate (§18) — USDZ et OBJ.
//
// Les deux exporteurs viennent de Three.js, comme l'impose l'amendement B :
// écrire un exporteur USDZ maison est interdit, et pour de bonnes raisons — le
// format est un ZIP d'archives USD alignées sur 64 octets, avec un en-tête
// binaire crudement spécifié.
//
// La géométrie exportée est celle de `buildReliefMesh`, donc celle de la
// heightmap canonique, donc celle affichée à l'écran. Il n'y a pas de « version
// export » du relief : §18 interdit explicitement d'exporter une image plaquée
// sur un rectangle en prétendant que c'est du relief, et la seule façon sûre de
// ne pas le faire est de n'avoir qu'une géométrie.
//
// UNITÉS. Le projet raisonne en centimètres, les deux formats sont exportés en
// MÈTRES. USDZ déclare un `metersPerUnit` de 1 : un panneau de 200 cm exporté
// tel quel arriverait à 200 mètres en réalité augmentée. OBJ n'a pas d'unité
// déclarée, mais la convention des outils qui l'ouvrent est le mètre. Les deux
// sortent donc à la même échelle, et un panneau de 2 m mesure 2,0 unités.

import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, Scene } from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { FINISHES } from '../render2d/shade.js';
import { buildReliefMesh } from '../render3d/mesh.js';

const CM_TO_M = 0.01;

export function materialNameFor(project) {
  return `relief_${project.material.finish || 'mat'}`;
}

// Densité d'export. Plus généreuse qu'à l'affichage — un fichier n'a pas à
// tenir 60 images par seconde — mais pas illimitée : mesuré, 400 000 triangles
// donnent un USDZ de 9,3 Mo et un OBJ de 16 Mo, ce qui est pénible à ouvrir sur
// un iPad. À 200 000 le relief reste très détaillé pour un panneau mural et
// l'USDZ retombe sous 5 Mo.
export const EXPORT_MAX_TRIANGLES = 200000;

/** Scène d'export : un seul mesh, à l'échelle mètre, orienté comme à l'écran. */
export function buildExportScene(project, hm, { maxTriangles = EXPORT_MAX_TRIANGLES } = {}) {
  const built = buildReliefMesh(project, hm, { maxTriangles });

  const positions = new Float32Array(built.positions.length);
  for (let i = 0; i < positions.length; i++) positions[i] = built.positions[i] * CM_TO_M;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(built.normals.slice(), 3));
  geometry.setAttribute('uv', new BufferAttribute(built.uvs.slice(), 2));
  geometry.setIndex(new BufferAttribute(built.indices.slice(), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const finish = FINISHES[project.material.finish] || FINISHES.mat;
  const material = new MeshStandardMaterial({
    color: new Color(project.material.color),
    roughness: finish.roughness,
    metalness: finish.metal,
  });
  material.name = materialNameFor(project);

  const mesh = new Mesh(geometry, material);
  mesh.name = 'panneau_relief';

  const scene = new Scene();
  scene.name = 'atelier_relief';
  scene.add(mesh);
  return { scene, mesh, built };
}

/** USDZ — format prioritaire pour l'iPad. Retourne un Uint8Array. */
export async function exportUsdz(project, hm, options) {
  const { scene, built } = buildExportScene(project, hm, options);
  const exporter = new USDZExporter();
  const data = exporter.parseAsync ? await exporter.parseAsync(scene) : await exporter.parse(scene);
  return { data, built };
}

/**
 * OBJ — accompagné de son MTL.
 *
 * `OBJExporter` écrit bien `usemtl <nom>` mais ne produit PAS le fichier de
 * matériau ni la ligne `mtllib` qui le déclare. Sans elles, l'OBJ s'ouvre en
 * gris par défaut. On ajoute donc la déclaration en tête et on fabrique le MTL,
 * ce qui n'est pas un exporteur maison : le format MTL tient en dix lignes de
 * texte, à la différence d'USDZ.
 *
 * Emballage : deux fichiers de même racine, `mtllib` pointant sur le second.
 * Pas d'archive — sur iPad, deux fichiers déposés côte à côte dans Fichiers
 * s'ouvrent directement, là où un ZIP demanderait une manipulation de plus.
 */
export function exportObj(project, hm, options) {
  const { scene, built } = buildExportScene(project, hm, options);
  const baseName = fileBaseFor(project);
  const materialName = materialNameFor(project);

  let objText = new OBJExporter().parse(scene);
  objText = `# Atelier de relief organique\n# panneau ${project.widthCm} × ${project.heightCm} × ${project.depthCm} cm\n# unités : mètres\nmtllib ${baseName}.mtl\n${objText}`;

  const finish = FINISHES[project.material.finish] || FINISHES.mat;
  const color = new Color(project.material.color);
  // Exposant spéculaire de Phong déduit de la rugosité PBR : les deux modèles ne
  // se correspondent pas exactement, cette conversion est une approximation
  // assumée, cohérente avec le tableau de `shade.js`.
  const shininess = Math.round((1 - finish.roughness) ** 2 * 900) + 4;
  const specular = finish.metal ? 0.9 : 1 - finish.roughness;
  const mtlText = [
    '# Atelier de relief organique',
    `newmtl ${materialName}`,
    `Kd ${color.r.toFixed(4)} ${color.g.toFixed(4)} ${color.b.toFixed(4)}`,
    `Ka ${(color.r * 0.2).toFixed(4)} ${(color.g * 0.2).toFixed(4)} ${(color.b * 0.2).toFixed(4)}`,
    `Ks ${specular.toFixed(4)} ${specular.toFixed(4)} ${specular.toFixed(4)}`,
    `Ns ${shininess}`,
    'd 1.0',
    'illum 2',
    '',
  ].join('\n');

  return { objText, mtlText, baseName, built };
}

export function fileBaseFor(project) {
  const base = (project.name || 'relief').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || 'relief';
}
