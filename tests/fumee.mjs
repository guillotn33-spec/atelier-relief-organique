// Fumée d'interface — la seule suite qui ouvre réellement l'application.
//
//     npm run fumee
//
// POURQUOI ELLE EXISTE. Les neuf autres suites n'éprouvent que le calcul :
// « aucune de ces suites ne couvre l'interface », dit `run-all.mjs`, et
// `src/empreinte.js` demandait jusqu'ici un navigateur piloté à la main. Or
// trois défauts de ce lot étaient INVISIBLES au calcul et évidents à l'écran :
//
//   • `#drawerToggle` porte deux classes, `.icon-btn` et `.drawer-toggle`, de
//     même spécificité ; la seconde est écrite 340 lignes plus haut, donc la
//     première gagnait et le bouton était visible À TOUTE LARGEUR. Le cliquer
//     sur un bureau posait le voile sombre sur l'interface entière sans rien
//     ouvrir. Aucune relecture du CSS ne l'avait vu ; un `getComputedStyle` l'a
//     donné en une ligne.
//   • la boutique empilait une toile par article à chaque réouverture de projet ;
//   • la recherche ne repliait pas les accents.
//
// ELLE EST FACULTATIVE. Playwright pèse plusieurs centaines de mégaoctets et
// n'a rien à faire dans les dépendances d'un projet qui tient en un bundle de
// 120 ko. Absent, ce fichier le dit et sort en succès : `run-all.mjs` ne le
// lance pas, c'est une vérification que l'on demande.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(racine, 'dist');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (_) {
  console.log('\n  Playwright n’est pas installé : fumée ignorée.');
  console.log('  Pour l’activer :  npm install --no-save playwright && npx playwright install chromium\n');
  process.exit(0);
}

// Le bundle doit être frais : éprouver `dist/` d'hier ne dit rien du code
// d'aujourd'hui, et c'est le genre de faux vert qui coûte cher.
await new Promise((ok, ko) => {
  const p = spawn(process.execPath, [join(racine, 'build.mjs')], { stdio: 'ignore' });
  p.on('exit', (code) => (code === 0 ? ok() : ko(new Error('build.mjs a échoué'))));
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const serveur = createServer(async (req, res) => {
  const chemin = join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    const corps = await readFile(chemin);
    res.writeHead(200, { 'content-type': TYPES[extname(chemin)] || 'application/octet-stream' });
    res.end(corps);
  } catch (_) {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${serveur.address().port}`;

const resultats = [];
const check = (label, ok, detail) => {
  resultats.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
};

// Le binaire installé peut ne pas correspondre à la version de Playwright —
// c'est le cas dès qu'un environnement fournit Chromium à part. On se rabat
// alors sur celui qui est là plutôt que d'exiger un second téléchargement.
let navigateur;
try {
  navigateur = await chromium.launch({ args: ['--no-sandbox'] });
} catch (erreur) {
  const { existsSync, readdirSync } = await import('node:fs');
  const dossier = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidat = dossier && existsSync(dossier)
    ? readdirSync(dossier)
      .filter((d) => d.startsWith('chromium'))
      .map((d) => join(dossier, d, 'chrome-linux', d.includes('headless') ? 'headless_shell' : 'chrome'))
      .find(existsSync)
    : null;
  if (!candidat) throw erreur;
  navigateur = await chromium.launch({ executablePath: candidat, args: ['--no-sandbox'] });
}
const page = await navigateur.newPage({ viewport: { width: 1440, height: 900 } });
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(`exception : ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(`console : ${m.text()}`); });

await page.goto(`${base}/index.html`);
await page.waitForTimeout(300);
await page.click('#createProject');
await page.waitForTimeout(2200);

console.log('\nA. Ce que la feuille de style fait vraiment\n');

check(
  'A1 — sur un bureau, le bouton « Propriétés » est masqué',
  await page.evaluate(() => getComputedStyle(document.getElementById('drawerToggle')).display === 'none'),
  'il posait le voile sombre sans rien ouvrir'
);

await page.setViewportSize({ width: 900, height: 800 });
await page.waitForTimeout(400);
await page.click('#drawerToggle');
await page.waitForTimeout(500);
check('A2 — en mode étroit, le tiroir s’ouvre réellement', await page.evaluate(() => {
  const s = document.getElementById('sidebar');
  const t = getComputedStyle(s).transform;
  return getComputedStyle(s).position === 'fixed' && (t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)');
}));
await page.click('#backdrop');
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);

console.log('\nB. La boutique survit à une réouverture\n');

const toilesMax = () => page.evaluate(() => Math.max(...[...document.querySelectorAll('.effect-item')].map((b) => b.querySelectorAll('canvas').length)));
check('B1 — une seule toile par article', (await toilesMax()) === 1, `${await toilesMax()} toile(s)`);

await page.click('#newProject');
await page.waitForTimeout(700);
const repris = await page.evaluate(() => { const b = document.querySelector('#projectList button'); if (b) { b.click(); return true; } return false; });
if (!repris) await page.click('#createProject');
await page.waitForTimeout(2500);
check(
  'B2 — après réouverture, toujours une seule toile par article',
  (await toilesMax()) === 1,
  `${await toilesMax()} toile(s) — c’est ici qu’elles s’empilaient`
);
check('B3 — la grille à trois colonnes tient', await page.evaluate(() => {
  const b = document.querySelector('.effect-item');
  const r = b.getBoundingClientRect();
  return [...b.children].every((c) => c.getBoundingClientRect().top < r.top + r.height);
}));

console.log('\nC. Les effets font ce qu’ils annoncent\n');

await page.evaluate(() => { for (const c of document.querySelectorAll('.effect-category')) c.open = true; });
await page.waitForTimeout(400);

const couleurMatiere = () => page.evaluate(() => document.getElementById('materialColor').value);
const avantMatiere = await couleurMatiere();
await page.click('[data-effect="terracotta"]');
await page.waitForTimeout(900);
const nomActif = await page.evaluate(() => document.getElementById('activeEffectName').textContent);
check('C1 — une matière change la matière et s’annonce dans la barre', (await couleurMatiere()) !== avantMatiere && nomActif === 'Terre cuite', `${avantMatiere} → ${await couleurMatiere()}, « ${nomActif} »`);

const graine = await page.evaluate(() => document.getElementById('seedLabel').textContent);
const avantVariation = await couleurMatiere();
await page.click('#effectRandomize');
await page.waitForTimeout(900);
check(
  'C2 — varier une matière varie la matière, pas la composition',
  (await couleurMatiere()) !== avantVariation && (await page.evaluate(() => document.getElementById('seedLabel').textContent)) === graine,
  `${avantVariation} → ${await couleurMatiere()}, graine inchangée`
);

const mur = await page.evaluate(() => document.getElementById('wallColor').value);
await page.click('[data-effect="gallery-white"]');
await page.waitForTimeout(900);
check('C3 — « Galerie blanche » n’écrase plus la couleur du mur', (await page.evaluate(() => document.getElementById('wallColor').value)) === mur, mur);

console.log('\nD. Recherche\n');

await page.fill('#effectSearch', 'alveole');
await page.waitForTimeout(300);
check('D1 — « alveole » trouve « Alvéoles »', await page.evaluate(() => !document.querySelector('[data-effect="alveoli"]').hidden));
check('D2 — le compteur de catégorie suit le filtre', await page.evaluate(() => {
  const c = document.querySelector('[data-effect-category="form"]');
  return c.querySelector('.category-count').textContent === String([...c.querySelectorAll('.effect-item')].filter((i) => !i.hidden).length);
}));
await page.fill('#effectSearch', '');
await page.waitForTimeout(300);
check('D3 — effacer la recherche rend son état de repos au panneau', await page.evaluate(() => !document.querySelector('[data-effect-category="material"]').open));

console.log('\nE. Les retouches rendent bien une image\n');

const pixelCentral = () => page.evaluate(() => {
  const c = document.getElementById('reliefCanvas');
  return [...c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data].join(',');
});
const bascule = (id, valeur) => page.evaluate(([i, v]) => {
  const e = document.getElementById(i);
  if (e.type === 'checkbox') { e.checked = v; e.dispatchEvent(new Event('change', { bubbles: true })); }
  else { e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); }
}, [id, valeur]);

const origine = await pixelCentral();
await bascule('negative', true);
await page.waitForTimeout(700);
check('E1 — le mode négatif change l’image', (await pixelCentral()) !== origine);
await bascule('negative', false);
await page.waitForTimeout(700);
check('E2 — repasser en positif rend exactement l’image d’origine', (await pixelCentral()) === origine, 'la négation est sa propre réciproque');

for (const id of ['depth', 'softness']) {
  await bascule(id, 60);
  await page.waitForTimeout(800);
}
check('E3 — profondeur et douceur rendent une image non vide', (await pixelCentral()) !== '0,0,0,0');

check('F1 — aucune exception ni erreur de console sur tout le parcours', erreurs.length === 0, erreurs.join(' ; '));

await navigateur.close();
serveur.close();

const passes = resultats.filter((r) => r.ok).length;
console.log(`\n${passes}/${resultats.length} vérifications passées\n`);
if (passes !== resultats.length) process.exit(1);
