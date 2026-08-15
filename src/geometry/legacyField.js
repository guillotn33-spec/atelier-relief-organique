// Générateur de champ version 1, porté tel quel — SANS aucune constante 1.6.
//
// ⚠ Ce module est provisoire. L'audit du lot 0 a établi que ce générateur ne peut
// pas produire les références : les formes sont placées pour NE PAS se recouvrir,
// les liaisons sont rejetées au-delà d'un seuil, le fond des cavités est plat sur
// ses 45 % centraux, et la houle `swell` est ajoutée APRÈS coup — ce qui fabrique
// exactement l'îlot central que l'amendement A interdit.
//
// Il est conservé au lot 1 dans un seul but : servir de référence de non-régression
// pendant la bascule d'architecture. Le lot 2 le remplace par un moteur à bruit fbm
// + domain warp + creusement monotone. Ne pas investir ici.

import { clamp, smoothstep, smin, mulberry32 } from '../core/math.js';

function createShapes(geometry, aspect) {
  const rng = mulberry32(geometry.seed);
  const shapes = [];
  const base = 0.155 * geometry.scale * Math.sqrt(10 / geometry.count);

  for (let i = 0; i < geometry.count; i++) {
    let best = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 34; attempt++) {
      const candidate = { x: -0.03 + rng() * 1.06, y: -0.03 + rng() * 1.06 };
      let score = 10;
      for (const other of shapes) {
        const dx = candidate.x - other.x;
        // La version 1 écrivait `* 1.6` ici. Cette métrique d'espacement est
        // INVERSE de celle du champ (qui multiplie x par aspect, pas y) : le
        // placement écarte donc les formes 2,56× trop verticalement. On reproduit
        // le défaut à l'identique via `aspect` pour ne pas changer le rendu du
        // lot 1, et on ne le reconduit PAS au lot 2.
        const dy = (candidate.y - other.y) * aspect;
        score = Math.min(score, Math.hypot(dx, dy) / (other.radius + base));
      }
      score += rng() * 0.08;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    const longness = 1 + geometry.elongation * (1.05 + rng() * 1.1);
    const sizeNoise = 0.74 + rng() * 0.55;
    const a = base * longness * sizeNoise;
    const b = (base * (0.74 + rng() * 0.38)) / Math.pow(longness, 0.34);
    const flowBias = (-0.22 + (best.y - 0.5) * 0.44) * geometry.flow;
    const scatter = (rng() - 0.5) * Math.PI * (1 - geometry.flow * 0.72);
    const angle = flowBias + scatter;

    shapes.push({
      x: best.x,
      y: best.y,
      a,
      b,
      radius: Math.sqrt(a * b),
      angle,
      cos: Math.cos(angle), // précalculé : la v1 les recalculait à chaque pixel
      sin: Math.sin(angle),
      phase: rng() * Math.PI * 2,
      phase2: rng() * Math.PI * 2,
      depth: 0.75 + rng() * 0.38,
    });
  }
  return shapes;
}

function buildValleys(shapes, geometry, aspect) {
  const valleys = [];
  const linked = new Set();
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    const neighbours = [];
    for (let j = 0; j < shapes.length; j++) {
      if (j === i) continue;
      neighbours.push({ j, d: Math.hypot((s.x - shapes[j].x) * aspect, s.y - shapes[j].y) });
    }
    neighbours.sort((a, b) => a.d - b.d);
    for (let n = 0; n < Math.min(2, neighbours.length); n++) {
      const o = shapes[neighbours[n].j];
      const key = Math.min(i, neighbours[n].j) + ':' + Math.max(i, neighbours[n].j);
      if (linked.has(key)) continue;
      if (neighbours[n].d > (s.radius + o.radius) * (n === 0 ? 2.4 : 1.8)) continue;
      if (neighbours[n].d > (n === 0 ? 0.6 : 0.45)) continue;
      linked.add(key);
      const strength = n === 0 ? 0.62 : 0.5;
      const v = {
        x1: s.x * aspect,
        y1: s.y,
        x2: o.x * aspect,
        y2: o.y,
        halfWidth: Math.max(0.06, Math.min(s.radius, o.radius) * 0.75) * (1 + neighbours[n].d * 0.5),
        depth: geometry.depth * strength * (s.depth + o.depth) * 0.5,
      };
      v.ex = v.x2 - v.x1;
      v.ey = v.y2 - v.y1;
      v.invLen2 = 1 / Math.max(1e-6, v.ex * v.ex + v.ey * v.ey);
      valleys.push(v);
    }
  }
  return valleys;
}

/** Contexte de champ — dépend de la géométrie et du rapport réel de la toile. */
export function makeFieldContext(geometry, aspect) {
  const shapes = createShapes(geometry, aspect);
  return {
    geometry,
    aspect,
    shapes,
    valleys: buildValleys(shapes, geometry, aspect),
    k: 0.15 + geometry.softness * 0.2,
    swellAmp: geometry.depth * (0.1 + geometry.wave * 0.4),
    p1: geometry.seed * 0.013,
    p2: geometry.seed * 0.007,
    p3: geometry.seed * 0.019,
  };
}

/** Rayon de flou exprimé en fraction de la largeur — indépendant de la résolution. */
export function blurFraction(geometry) {
  return 0.006 + geometry.softness * 0.018;
}

/**
 * Évalue le champ en un point.
 * u, v sont normalisés sur la toile ; warpU/warpV sont les déplacements de
 * sculpture DÉJÀ convertis en unités u/v ; lift est la hauteur sculptée.
 */
export function evalField(ctx, u, v, warpU, warpV, lift, tPhase = 0, withSwell = true) {
  const { geometry, aspect, shapes, valleys, k, swellAmp, p1, p2, p3 } = ctx;
  const tau = Math.PI * 2;
  const flow = geometry.flow;

  const x = u + warpU;
  const y = v + warpV;

  const globalWarpX = flow * (0.022 * Math.sin(y * tau * 1.45 + geometry.seed * 0.017) + 0.009 * Math.sin((x + y) * tau * 2.2));
  const globalWarpY = flow * (0.016 * Math.sin(x * tau * 1.25 + geometry.seed * 0.011) - 0.008 * Math.cos((x - y) * tau * 2.4));
  const wx = x + globalWarpX;
  const wy = y + globalWarpY;

  let field = 0;
  for (let s = 0; s < shapes.length; s++) {
    const shape = shapes[s];
    const dx = (wx - shape.x) * aspect;
    const dy = wy - shape.y;
    const rx = shape.cos * dx + shape.sin * dy;
    const ry = -shape.sin * dx + shape.cos * dy;
    const theta = Math.atan2(ry / shape.b, rx / shape.a);
    const irregular =
      1 +
      geometry.irregularity * 0.095 * Math.sin(theta * 3 + shape.phase) +
      geometry.irregularity * 0.05 * Math.sin(theta * 5 + shape.phase2);
    const r = Math.hypot(rx / shape.a, ry / shape.b) * irregular;
    const inner = 1 - smoothstep(0.45, 1.0, r);
    const bowl = -geometry.depth * shape.depth * (inner * 0.85 + inner * inner * 0.15);
    field = smin(field, bowl, k);
  }

  const qx = wx * aspect + flow * 0.045 * Math.sin(wy * tau * 2.1 + p2);
  const qy = wy + flow * 0.04 * Math.sin(wx * aspect * tau * 1.3 + p1);
  for (let i = 0; i < valleys.length; i++) {
    const valley = valleys[i];
    const t = clamp(((qx - valley.x1) * valley.ex + (qy - valley.y1) * valley.ey) * valley.invLen2, 0, 1);
    const dist = Math.hypot(qx - valley.x1 - valley.ex * t, qy - valley.y1 - valley.ey * t);
    const prof = 1 - smoothstep(0, valley.halfWidth, dist);
    field = smin(field, -valley.depth * prof, k);
  }

  let swell = 0;
  if (withSwell) {
    swell =
      swellAmp *
      (0.5 * Math.sin((x * 0.8 + y * 0.55) * tau * 1.15 + p1 + tPhase) +
        0.32 * Math.sin((x * 0.45 - y * 1.05) * tau * 1.35 + p2 + tPhase * 0.7) +
        0.18 * Math.sin((x * 1.5 + y * 1.3) * tau * 0.8 + p3 + tPhase * 1.35));
  }

  return swell + field + lift;
}
