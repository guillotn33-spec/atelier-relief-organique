// Construction du mesh 3D à partir de la heightmap canonique (§9).
//
// Ce module ne connaît pas Three.js : il produit des tableaux typés bruts. Deux
// raisons. D'abord il reste éprouvable en Node, sans navigateur ni WebGL —
// c'est ce qui permet de vérifier par la mesure que le mesh porte le MÊME relief
// que la vue 2D. Ensuite les exports USDZ et OBJ du lot 6 consommeront ces mêmes
// tableaux, donc la même géométrie, sans repasser par la scène.
//
// Repères. La heightmap est en centimètres, x vers la droite et y vers le BAS.
// La scène 3D est en centimètres elle aussi, mais y vers le HAUT : le mesh
// inverse donc y, et lui seul. Rien d'autre dans le projet ne connaît cette
// convention.
//
// Axe Z. Le plateau le plus haut du relief est la face avant du panneau, à
// z = 0 ; le point le plus creux descend à z = −depthCm. C'est la lecture
// physique d'un panneau taillé dans une dalle : on enlève de la matière, on n'en
// ajoute pas. `project.depthCm` est donc bien l'épaisseur sculptée, distincte de
// `geometry.depth` qui n'est qu'une amplitude de champ.

const MAX_TRIANGLES = 240000;

/**
 * @param {object} project
 * @param {object} hm  heightmap canonique
 * @param {object} [options]  maxTriangles — plafond de densité du maillage
 * @returns {{positions:Float32Array, normals:Float32Array, uvs:Float32Array,
 *            indices:Uint32Array, cols:number, rows:number, stride:number,
 *            triangles:number, zScale:number, dropped:number}}
 */
export function buildReliefMesh(project, hm, options = {}) {
  const maxTriangles = options.maxTriangles || MAX_TRIANGLES;

  // Pas d'échantillonnage : la heightmap peut porter 257 000 cellules, soit un
  // demi-million de triangles. On la sous-échantillonne uniformément jusqu'à
  // tenir sous le plafond, sans jamais changer le relief lui-même.
  const fullQuads = (hm.cols - 1) * (hm.rows - 1);
  let stride = 1;
  while (Math.floor((hm.cols - 1) / stride) * Math.floor((hm.rows - 1) / stride) * 2 > maxTriangles) stride++;

  const cols = Math.floor((hm.cols - 1) / stride) + 1;
  const rows = Math.floor((hm.rows - 1) / stride) + 1;

  const halfW = project.widthCm / 2;
  const halfH = project.heightCm / 2;
  const span = hm.max - hm.min || 1;
  const depthCm = project.depthCm;
  // h = hm.max → z = 0 ; h = hm.min → z = −depthCm.
  const zScale = depthCm / span;

  const isCircle = project.canvasShape === 'circle';
  const radius = halfW;

  const sampleCount = cols * rows;
  const rawX = new Float32Array(sampleCount);
  const rawY = new Float32Array(sampleCount);
  const rawZ = new Float32Array(sampleCount);
  const inside = new Uint8Array(sampleCount);

  for (let r = 0; r < rows; r++) {
    const hmRow = Math.min(hm.rows - 1, r * stride);
    const yCm = hm.yCmAt(hmRow);
    for (let c = 0; c < cols; c++) {
      const hmCol = Math.min(hm.cols - 1, c * stride);
      const xCm = hm.xCmAt(hmCol);
      const i = r * cols + c;
      rawX[i] = xCm;
      rawY[i] = -yCm; // heightmap : y vers le bas ; scène : y vers le haut
      rawZ[i] = (hm.h[hmRow * hm.cols + hmCol] - hm.max) * zScale;
      // Un sommet ne compte que s'il est dans la toile. Hors du disque, il ne
      // sert à rien : §9 demande de ne pas les conserver.
      inside[i] = isCircle
        ? xCm * xCm + yCm * yCm <= radius * radius
          ? 1
          : 0
        : Math.abs(xCm) <= halfW + 1e-6 && Math.abs(yCm) <= halfH + 1e-6
          ? 1
          : 0;
    }
  }

  // Un quad n'est émis que si ses quatre coins sont dans la toile. Les sommets
  // restés inutilisés sont ensuite supprimés et les indices renumérotés.
  const used = new Int32Array(sampleCount).fill(-1);
  const quads = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (!inside[a] || !inside[b] || !inside[d] || !inside[e]) continue;
      quads.push(a, b, d, e);
      used[a] = 0;
      used[b] = 0;
      used[d] = 0;
      used[e] = 0;
    }
  }

  let vertexCount = 0;
  for (let i = 0; i < sampleCount; i++) if (used[i] === 0) used[i] = vertexCount++;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const stepCm = hm.cellCm * stride;
  const invTwoStep = 1 / (2 * stepCm);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const v = used[i];
      if (v < 0) continue;

      positions[v * 3] = rawX[i];
      positions[v * 3 + 1] = rawY[i];
      positions[v * 3 + 2] = rawZ[i];

      // UV continus, dérivés des coordonnées physiques : aucune couture, et la
      // texture peinte dans Procreate retombera exactement sur le relief.
      uvs[v * 2] = (rawX[i] + halfW) / project.widthCm;
      uvs[v * 2 + 1] = (rawY[i] + halfH) / project.heightCm;

      // Normales analytiques, prises sur la heightmap plutôt que reconstruites
      // depuis les faces : elles décrivent la surface réelle et non la facette
      // du maillage sous-échantillonné.
      const left = rawZ[r * cols + Math.max(0, c - 1)];
      const right = rawZ[r * cols + Math.min(cols - 1, c + 1)];
      const up = rawZ[Math.max(0, r - 1) * cols + c];
      const down = rawZ[Math.min(rows - 1, r + 1) * cols + c];
      const dzdx = (right - left) * invTwoStep;
      // rawY est déjà inversé : la dérivée suit le même sens que la scène.
      const dzdy = (up - down) * invTwoStep;
      const nx = -dzdx;
      const ny = -dzdy;
      const len = Math.hypot(nx, ny, 1) || 1;
      normals[v * 3] = nx / len;
      normals[v * 3 + 1] = ny / len;
      normals[v * 3 + 2] = 1 / len;
    }
  }

  const indices = new Uint32Array((quads.length / 4) * 6);
  let k = 0;
  for (let q = 0; q < quads.length; q += 4) {
    const a = used[quads[q]];
    const b = used[quads[q + 1]];
    const d = used[quads[q + 2]];
    const e = used[quads[q + 3]];
    // Enroulement anti-horaire vu de face (+Z vers l'observateur).
    indices[k++] = a;
    indices[k++] = d;
    indices[k++] = b;
    indices[k++] = b;
    indices[k++] = d;
    indices[k++] = e;
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    cols,
    rows,
    stride,
    vertexCount,
    triangles: indices.length / 3,
    zScale,
    fullQuads,
    dropped: sampleCount - vertexCount,
  };
}
