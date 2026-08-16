// Brosse directionnelle (§6).
//
//   node tests/brush.mjs
//
// §6 demande une brosse elliptique ORIENTABLE. Le moteur acceptait déjà
// `elongation` et `angleDeg` depuis le lot 1, mais aucune commande ne les
// écrivait : la brosse était restée un disque pendant six lots. Ces
// vérifications éprouvent la forme réellement déposée dans le calque, jamais
// les paramètres qu'on lui a passés.

import { brushAxes, stamp, MAX_BRUSH_ASPECT } from '../src/sculpt/brush.js';
import { DirectionTracker, MIN_TRAVEL_CM } from '../src/sculpt/direction.js';
import { SculptLayer } from '../src/sculpt/layer.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

/**
 * Empreinte d'un coup de brosse unique, mesurée DANS le calque.
 * Retourne l'aire touchée, le centre et les moments d'inertie, dont on tire
 * l'axe principal et l'allongement réels de la tache.
 */
function empreinte({ radiusCm = 10, elongation = 0, angleDeg = 0, widthCm = 120, heightCm = 120 } = {}) {
  const layer = SculptLayer.forCanvas(widthCm, heightCm, 0.25);
  // Un unique coup, avec un déplacement suffisant pour que la dose ne soit pas
  // nulle. `dx` est purement horizontal pour que la trace ne soit pas étirée
  // par le trajet : ce qu'on mesure est bien la forme de la brosse.
  stamp(layer, { tool: 'dig', xCm: 0, yCm: 0, dxCm: 0.4, dyCm: 0, radiusCm, strength: 1, pressure: 1, elongation, angleDeg, first: true });

  const cell = layer.cellCm;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let poids = 0;
  for (let r = 0; r < layer.rows; r++) {
    for (let c = 0; c < layer.cols; c++) {
      const v = Math.abs(layer.height[r * layer.cols + c]);
      if (v <= 1e-9) continue;
      const x = layer.originXCm + c * cell;
      const y = layer.originYCm + r * cell;
      n++;
      poids += v;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
  }
  if (!n) return null;
  const mx = sx / n;
  const my = sy / n;
  const cxx = sxx / n - mx * mx;
  const cyy = syy / n - my * my;
  const cxy = sxy / n - mx * my;
  // Axes principaux de la tache : valeurs et vecteurs propres de la covariance.
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  const axeDeg = (Math.atan2(2 * cxy, cxx - cyy) * 90) / Math.PI;
  return {
    aireCm2: n * cell * cell,
    poids,
    allongementMesure: l2 > 1e-12 ? Math.sqrt(l1 / l2) : Infinity,
    axeDeg: ((axeDeg % 180) + 180) % 180,
  };
}

// ---- A. L'aire de la brosse ne change pas quand on l'allonge ----
//
// DÉFAUT SCELLÉ ICI. La première écriture — `a = r·s`, `b = r/√s` — faisait
// croître l'aire de 79 % entre le disque et l'allongement maximal, alors que le
// commentaire du fichier annonçait une aire « comparable ». Une brosse qui
// grossit en s'allongeant dépose davantage de matière sans le dire.

console.log('\nA. Aire conservée à travers l’allongement\n');
{
  const disque = empreinte({ elongation: 0 });
  let pire = 0;
  let pireCas = null;
  console.log('   allongement   rapport visé   rapport mesuré   aire / aire du disque');
  for (const e of [0, 0.25, 0.5, 0.75, 1]) {
    const emp = empreinte({ elongation: e });
    const { aspect } = brushAxes(1, e);
    const ratioAire = emp.aireCm2 / disque.aireCm2;
    const ecart = Math.abs(ratioAire - 1);
    if (ecart > pire) {
      pire = ecart;
      pireCas = `allongement ${e}`;
    }
    console.log(
      `   ${e.toFixed(2).padStart(10)}   ${aspect.toFixed(2).padStart(12)}   ${emp.allongementMesure.toFixed(2).padStart(14)}   ${ratioAire.toFixed(3).padStart(21)}`
    );
  }
  // 4 % : la tolérance de la discrétisation. L'ellipse est échantillonnée sur
  // une maille de 0,25 cm et son contour ne tombe pas sur les cellules.
  check('A1 — l’aire ne varie pas avec l’allongement', pire < 0.04, `pire écart ${(100 * pire).toFixed(1)} % (${pireCas})`);
  check('A2 — à allongement nul la brosse est un disque', Math.abs(disque.allongementMesure - 1) < 0.05, `allongement mesuré ${disque.allongementMesure.toFixed(3)}`);
}

// ---- B. Le rapport annoncé est le rapport déposé ----

console.log('\nB. L’allongement affiché est celui de la tache\n');
{
  let pire = 0;
  let pireCas = null;
  for (const e of [0.25, 0.5, 0.75, 1]) {
    const emp = empreinte({ elongation: e, radiusCm: 14 });
    const { aspect } = brushAxes(1, e);
    const ecart = Math.abs(emp.allongementMesure - aspect) / aspect;
    if (ecart > pire) {
      pire = ecart;
      pireCas = `allongement ${e} : ${emp.allongementMesure.toFixed(2)} mesuré contre ${aspect.toFixed(2)} annoncé`;
    }
  }
  check('B1 — la tache a le rapport que l’interface annonce', pire < 0.06, `pire écart ${(100 * pire).toFixed(1)} % — ${pireCas}`);
  check('B2 — le rapport maximal est celui de la constante', Math.abs(brushAxes(1, 1).aspect - MAX_BRUSH_ASPECT) < 1e-9, `${brushAxes(1, 1).aspect}`);
}

// ---- C. L'orientation demandée est l'orientation obtenue ----

console.log('\nC. Orientation\n');
{
  let pire = 0;
  let pireCas = null;
  for (const angle of [0, 30, 45, 60, 90, 135, 170]) {
    const emp = empreinte({ elongation: 0.8, radiusCm: 14, angleDeg: angle });
    // Écart angulaire modulo 180 : une ellipse à 179° est à 1° de l'horizontale.
    let d = Math.abs(emp.axeDeg - angle) % 180;
    if (d > 90) d = 180 - d;
    if (d > pire) {
      pire = d;
      pireCas = `${angle}° demandé, ${emp.axeDeg.toFixed(1)}° mesuré`;
    }
  }
  console.log(`   sept orientations éprouvées, pire écart ${pire.toFixed(2)}°`);
  check('C1 — l’axe de la tache suit l’angle demandé', pire < 2.5, `${pire.toFixed(2)}° (${pireCas})`);

  // Une ellipse est identique à elle-même après un demi-tour : 20° et 200°
  // doivent déposer EXACTEMENT la même matière.
  const a = empreinte({ elongation: 0.8, radiusCm: 14, angleDeg: 20 });
  const b = empreinte({ elongation: 0.8, radiusCm: 14, angleDeg: 200 });
  check(
    'C2 — un demi-tour ne change rien à la tache',
    Math.abs(a.poids - b.poids) < 1e-9 && Math.abs(a.aireCm2 - b.aireCm2) < 1e-9,
    `poids ${a.poids.toFixed(6)} contre ${b.poids.toFixed(6)}`
  );
}

// ---- D. Orientation reprise du tracé ----
//
// Le lissage travaille sur l'ANGLE DOUBLE. Un tracé en aller-retour — le cas
// courant quand on hachure — ne doit pas faire basculer la brosse de 180° à
// chaque changement de sens.

console.log('\nD. La brosse se couche dans le sens du geste\n');
{
  const droite = new DirectionTracker();
  for (let i = 0; i < 20; i++) droite.push(1, 0);
  check('D1 — un tracé horizontal donne 0°', Math.abs(droite.angleDeg()) < 0.01, `${droite.angleDeg().toFixed(3)}°`);

  const diagonale = new DirectionTracker();
  for (let i = 0; i < 30; i++) diagonale.push(1, 1);
  check('D2 — un tracé en diagonale donne 45°', Math.abs(diagonale.angleDeg() - 45) < 0.5, `${diagonale.angleDeg().toFixed(2)}°`);

  const vertical = new DirectionTracker();
  for (let i = 0; i < 30; i++) vertical.push(0, 1);
  check('D3 — un tracé vertical donne 90°', Math.abs(vertical.angleDeg() - 90) < 0.5, `${vertical.angleDeg().toFixed(2)}°`);

  // Le cas que l'angle double existe pour régler : une hachure.
  const hachure = new DirectionTracker();
  const angles = [];
  for (let i = 0; i < 40; i++) {
    hachure.push(i % 2 === 0 ? 1 : -1, 0);
    angles.push(hachure.angleDeg());
  }
  const amplitude = Math.max(...angles.slice(4)) - Math.min(...angles.slice(4));
  console.log(`   aller-retour horizontal : orientation entre ${Math.min(...angles.slice(4)).toFixed(2)}° et ${Math.max(...angles.slice(4)).toFixed(2)}°`);
  check('D4 — un aller-retour ne fait pas basculer la brosse', amplitude < 0.01, `amplitude ${amplitude.toFixed(4)}°`);

  // Contre-épreuve : sans l'angle double, la même séquence bascule bel et bien.
  let naif = null;
  const amplitudesNaives = [];
  for (let i = 0; i < 40; i++) {
    const dx = i % 2 === 0 ? 1 : -1;
    const brut = ((Math.atan2(0, dx) * 180) / Math.PI + 360) % 360;
    naif = naif === null ? brut : naif + (brut - naif) * 0.25;
    amplitudesNaives.push(naif);
  }
  const amplitudeNaive = Math.max(...amplitudesNaives.slice(4)) - Math.min(...amplitudesNaives.slice(4));
  check(
    'D5 — le lissage naïf, lui, bascule : la précaution sert',
    amplitudeNaive > 20,
    `amplitude ${amplitudeNaive.toFixed(1)}° sans l’angle double, contre ${amplitude.toFixed(4)}° avec`
  );

  const rien = new DirectionTracker();
  check('D6 — sans déplacement, l’angle manuel est conservé', !rien.ready && rien.angleDeg(37) === 37, `${rien.angleDeg(37)}°`);
  const bruit = new DirectionTracker();
  bruit.push(MIN_TRAVEL_CM * 0.5, 0);
  check('D7 — un frémissement sous le seuil est ignoré', !bruit.ready && bruit.angleDeg(37) === 37, `seuil ${MIN_TRAVEL_CM} cm`);

  // La direction suit un virage sans le devancer ni le rater.
  const virage = new DirectionTracker();
  for (let i = 0; i < 40; i++) virage.push(1, 0);
  const avant = virage.angleDeg();
  for (let i = 0; i < 40; i++) virage.push(0, 1);
  const apres = virage.angleDeg();
  check('D8 — la brosse suit un virage à angle droit', Math.abs(avant) < 0.5 && Math.abs(apres - 90) < 0.5, `${avant.toFixed(2)}° puis ${apres.toFixed(2)}°`);
}

// ---- E. Le trait allongé reste un trait, pas une bavure ----

console.log('\nE. Effet sur un trait complet\n');
{
  const tracer = (elongation, angleDeg) => {
    const layer = SculptLayer.forCanvas(160, 160, 0.25);
    let precedent = -40;
    for (let x = -40; x <= 40; x += 4) {
      stamp(layer, { tool: 'dig', xCm: x, yCm: 0, dxCm: x - precedent, dyCm: 0, radiusCm: 10, strength: 1, pressure: 1, elongation, angleDeg, first: x === -40 });
      precedent = x;
    }
    // Étendue verticale de la trace : c'est elle qui distingue un trait fin
    // d'un trait large.
    let hautMin = Infinity;
    let hautMax = -Infinity;
    let total = 0;
    for (let r = 0; r < layer.rows; r++) {
      for (let c = 0; c < layer.cols; c++) {
        if (Math.abs(layer.height[r * layer.cols + c]) <= 1e-9) continue;
        const y = layer.originYCm + r * layer.cellCm;
        if (y < hautMin) hautMin = y;
        if (y > hautMax) hautMax = y;
        total += Math.abs(layer.height[r * layer.cols + c]);
      }
    }
    return { largeurCm: hautMax - hautMin, total };
  };

  const rond = tracer(0, 0);
  const couche = tracer(1, 0); // ellipse alignée sur le trait → trait FIN
  const dresse = tracer(1, 90); // ellipse en travers → trait LARGE
  console.log(`   brosse ronde            : trait de ${rond.largeurCm.toFixed(1)} cm de large`);
  console.log(`   ellipse dans le sens    : ${couche.largeurCm.toFixed(1)} cm`);
  console.log(`   ellipse en travers      : ${dresse.largeurCm.toFixed(1)} cm`);
  check('E1 — couchée dans le sens du trait, la brosse affine le trait', couche.largeurCm < rond.largeurCm * 0.75, `${couche.largeurCm.toFixed(1)} contre ${rond.largeurCm.toFixed(1)} cm`);
  check('E2 — dressée en travers, elle l’élargit', dresse.largeurCm > rond.largeurCm * 1.5, `${dresse.largeurCm.toFixed(1)} contre ${rond.largeurCm.toFixed(1)} cm`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
