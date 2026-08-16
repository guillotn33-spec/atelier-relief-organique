// Dimensions de toile — bornes, verrou de rapport, saisie (§2, §5).
//
//   node tests/dimensions.mjs
//
// Le verrou de rapport est un engagement pris envers l'utilisateur : tant qu'il
// est actif, la forme du panneau ne change pas. Un verrou qui cède en silence
// est pire qu'un verrou absent — on s'appuie dessus.

import { BOUNDS, fitLockedSize, validateDimension } from '../src/core/project.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

// ---- A. Le verrou tient contre des bornes ASYMÉTRIQUES ----
//
// DÉFAUT SCELLÉ ICI. Le rectangle admet 500 cm de large mais 200 cm de haut.
// Le redimensionnement plafonnait chaque dimension SÉPARÉMENT : un panneau
// 160 × 100 verrouillé à 1,6 et tiré en largeur sortait en 500 × 200, soit un
// rapport de 2,5. Mesuré aussi : 160 × 100 réduit à 1 cm donnait 1 × 1
// (rapport 1,0), et 100 × 180 tiré à 400 donnait 400 × 200 (rapport 2,0).

console.log('\nA. Verrou de rapport contre les bornes du rectangle\n');
{
  const b = BOUNDS.rectangle;
  console.log(`   bornes : largeur ${b.widthCm.min}–${b.widthCm.max} cm, hauteur ${b.heightCm.min}–${b.heightCm.max} cm`);

  const cas = [
    [160, 100, 500],
    [160, 100, 1],
    [100, 180, 400],
    [300, 60, 500],
    [50, 150, 2],
    [200, 120, 700],
    [137, 89, 3],
    [200, 199, 480],
  ];
  let pire = 0;
  let pireCas = null;
  let bornesRespectees = true;
  for (const [w0, h0, cible] of cas) {
    const ratio = w0 / h0;
    const r = fitLockedSize('rectangle', ratio, cible);
    const obtenu = r.widthCm / r.heightCm;
    const ecart = Math.abs(obtenu - ratio) / ratio;
    if (ecart > pire) {
      pire = ecart;
      pireCas = `${w0} × ${h0} tiré vers ${cible} → ${r.widthCm} × ${r.heightCm}`;
    }
    if (r.widthCm < b.widthCm.min || r.widthCm > b.widthCm.max || r.heightCm < b.heightCm.min || r.heightCm > b.heightCm.max) {
      bornesRespectees = false;
    }
    console.log(
      `   ${String(`${w0} × ${h0}`).padEnd(10)} rapport ${ratio.toFixed(3)}  vers ${String(cible).padStart(3)} cm  →  ` +
        `${String(`${r.widthCm} × ${r.heightCm}`).padEnd(10)} rapport ${obtenu.toFixed(3)}   écart ${(100 * ecart).toFixed(2)} %`
    );
  }
  check('A1 — le rapport survit au plafond de largeur', pire < 0.02, `pire écart ${(100 * pire).toFixed(2)} % (${pireCas})`);
  check('A2 — les deux dimensions restent dans leurs bornes', bornesRespectees);

  // Le plafond utile n'est PAS la borne de largeur : à 1,6 il vaut 200 × 1,6.
  const auMax = fitLockedSize('rectangle', 1.6, 9999);
  check(
    'A3 — le plafond est celui qu’impose la hauteur, pas la largeur',
    auMax.heightCm === b.heightCm.max && auMax.widthCm === Math.round(b.heightCm.max * 1.6),
    `${auMax.widthCm} × ${auMax.heightCm} pour un rapport de 1,6`
  );
}

// ---- B. Balayage large : aucun rapport ne doit céder ----

console.log('\nB. Balayage de rapports et de tailles\n');
{
  let pire = 0;
  let pireCas = null;
  let n = 0;
  let horsBornes = 0;
  const b = BOUNDS.rectangle;
  for (let w0 = 3; w0 <= 480; w0 += 7) {
    for (let h0 = 3; h0 <= 195; h0 += 11) {
      const ratio = w0 / h0;
      for (const cible of [1, 4, 17, 90, 260, 640]) {
        const r = fitLockedSize('rectangle', ratio, cible);
        n++;
        if (r.widthCm < b.widthCm.min || r.widthCm > b.widthCm.max || r.heightCm < b.heightCm.min || r.heightCm > b.heightCm.max) horsBornes++;
        const ecart = Math.abs(r.widthCm / r.heightCm - ratio) / ratio;
        if (ecart > pire) {
          pire = ecart;
          pireCas = `rapport ${ratio.toFixed(3)} vers ${cible} → ${r.widthCm} × ${r.heightCm}`;
        }
      }
    }
  }
  console.log(`   ${n} combinaisons éprouvées, pire écart ${(100 * pire).toFixed(2)} % (${pireCas})`);
  check('B1 — aucun rapport ne dérive de plus de 3 %', pire < 0.03, `${(100 * pire).toFixed(2)} %`);
  check('B2 — aucune sortie de bornes sur l’ensemble du balayage', horsBornes === 0, `${horsBornes} cas hors bornes`);
}

// ---- C. Un rapport absurde ne fait pas planter le verrou ----

console.log('\nC. Entrées dégénérées\n');
{
  const degenerees = [
    ['rapport nul', () => fitLockedSize('rectangle', 0, 100)],
    ['rapport négatif', () => fitLockedSize('rectangle', -2, 100)],
    ['rapport NaN', () => fitLockedSize('rectangle', NaN, 100)],
    ['rapport infini', () => fitLockedSize('rectangle', Infinity, 100)],
    ['forme inconnue', () => fitLockedSize('triangle', 1.6, 100)],
  ];
  let toutesFinies = true;
  for (const [nom, f] of degenerees) {
    let r;
    try {
      r = f();
    } catch (e) {
      r = null;
    }
    const bon = r && Number.isFinite(r.widthCm) && Number.isFinite(r.heightCm) && r.widthCm >= 1 && r.heightCm >= 1;
    if (!bon) toutesFinies = false;
    console.log(`   ${nom.padEnd(18)} → ${r ? `${r.widthCm} × ${r.heightCm}` : 'exception'}`);
  }
  check('C1 — toute entrée dégénérée rend une taille légale', toutesFinies);
}

// ---- D. La saisie manuelle reste stricte ----

console.log('\nD. Validation de la saisie\n');
{
  const refuses = ['', '  ', 'abc', '12,', '-5', '1e3', '12.', '.5', '3 cm', '9999999'];
  const acceptes = ['1', '160', '99.5', '99,5', ' 200 '];
  let refusOk = true;
  let acceptOk = true;
  for (const v of refuses) if (validateDimension('rectangle', 'widthCm', v).ok) { refusOk = false; console.log(`   accepté à tort : « ${v} »`); }
  for (const v of acceptes) {
    const r = validateDimension('rectangle', 'widthCm', v);
    if (!r.ok) { acceptOk = false; console.log(`   refusé à tort : « ${v} » — ${r.error}`); }
  }
  console.log(`   ${refuses.length} saisies invalides refusées, ${acceptes.length} valides acceptées`);
  check('D1 — les saisies invalides sont refusées', refusOk);
  check('D2 — les saisies valides passent, virgule comprise', acceptOk);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
