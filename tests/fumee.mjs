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

console.log('\nF. Affichage épuré et palette flottante\n');

await page.click('#benitoToggle');
await page.waitForTimeout(900);
const cache = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === 'none'; }, sel);
check(
  'F1 — tout le mobilier disparaît, la barre d’outils et la scène restent',
  (await cache('.topbar')) && (await cache('.library-panel')) && (await cache('.inspector-panel')) && (await cache('.bottom-panel'))
    && !(await cache('#toolbar')) && !(await cache('.stage')),
);
check('F2 — la palette flottante est visible', !(await cache('#palette')));

// LA PALETTE RESTE DANS LA FENÊTRE — le défaut qui a fait supprimer dock.js.
const boite = () => page.evaluate(() => { const r = document.getElementById('palette').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const depart = await boite();
const poignee = await page.locator('[data-palette-grip]').boundingBox();
await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
await page.mouse.down();
await page.mouse.move(500, 300, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
const deplacee = await boite();
check('F3 — la palette se déplace à la poignée', Math.abs(deplacee.x - depart.x) > 20 || Math.abs(deplacee.y - depart.y) > 20, `${Math.round(depart.x)},${Math.round(depart.y)} → ${Math.round(deplacee.x)},${Math.round(deplacee.y)}`);

// On la pousse volontairement hors du cadre, puis on rétrécit la fenêtre.
await page.mouse.move(poignee.x + 40, poignee.y + 40);
await page.evaluate(() => { const p = document.getElementById('palette'); p.style.transform = 'translate3d(4000px, 4000px, 0)'; });
await page.setViewportSize({ width: 700, height: 620 });
await page.waitForTimeout(500);
const apresReduction = await boite();
check(
  'F4 — après réduction de la fenêtre, la palette reste entièrement visible',
  apresReduction.x >= 0 && apresReduction.y >= 0 && apresReduction.x + apresReduction.w <= 700 + 1 && apresReduction.y + apresReduction.h <= 620 + 1,
  `${Math.round(apresReduction.x)},${Math.round(apresReduction.y)} pour ${Math.round(apresReduction.w)}×${Math.round(apresReduction.h)} dans 700×620`
);
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);

// La palette pilote bien la brosse de l'atelier, elle n'a pas son propre état.
await page.evaluate(() => { const e = document.getElementById('paletteSize'); e.value = '40'; e.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(300);
check('F5 — la palette pilote la brosse de l’atelier', (await page.evaluate(() => document.getElementById('brushSize').value)) === '40');
await page.click('[data-palette-tool="dig"]');
await page.waitForTimeout(300);
check('F6 — un outil de la palette change l’outil actif', await page.evaluate(() => document.querySelector('.tool[data-tool="dig"]').classList.contains('active')));

// Repli de la barre : le bouton du lot 7 était inatteignable.
await page.click('#toolbarCollapse');
await page.waitForTimeout(400);
// On mesure la HAUTEUR de la barre, pas le `display` calculé d'un outil : un
// élément dans un parent masqué garde son propre `display`, si bien que
// l'assertion précédente échouait alors que le repli fonctionnait.
check('F7 — la barre d’outils se replie', await page.evaluate(() => {
  const t = document.getElementById('toolbar');
  return t.classList.contains('toolbar--replie')
    && t.getBoundingClientRect().height < 40
    && document.querySelector('.tool[data-tool="light"]').getBoundingClientRect().height === 0;
}));
await page.click('#toolbarCollapse');
await page.waitForTimeout(400);

await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('F8 — Échap quitte l’affichage épuré', !(await page.evaluate(() => document.getElementById('atelier').classList.contains('benito'))));

console.log('\nG. Mode Prompt\n');

await page.click('#promptToggle');
await page.waitForTimeout(500);
const prompt = () => page.evaluate(() => ({
  ouvert: !document.getElementById('promptSheet').hidden,
  texte: document.querySelector('[data-prompt-final]').value,
  cavites: document.querySelector('[data-prompt-cavites]').textContent,
}));
const p1 = await prompt();
check('G1 — la feuille s’ouvre et porte un prompt', p1.ouvert && p1.texte.length > 200, `${p1.texte.length} caractères`);
check('G2 — le nombre de cavités est annoncé comme estimé', /estimation dérivée/.test(p1.cavites), p1.cavites);

// Le prompt suit les curseurs, en direct.
await page.evaluate(() => { const e = document.getElementById('depth'); e.value = '25'; e.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(700);
const p2 = await prompt();
check('G3 — baisser la profondeur change la phrase de relief', p2.texte !== p1.texte && /shallow/.test(p2.texte), p2.texte.match(/It has ([^,]+)/)?.[1] || '');

// Une section retouchée à la main cesse de suivre les curseurs.
await page.click('[data-niveau="detaille"]');
await page.waitForTimeout(300);
await page.fill('[data-section="surface"]', 'Surface écrite à la main.');
await page.waitForTimeout(300);
await page.evaluate(() => { const e = document.getElementById('texture'); e.value = '90'; e.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(700);
check(
  'G4 — une section retouchée n’est pas écrasée par les curseurs',
  (await page.evaluate(() => document.querySelector('[data-section="surface"]').value)) === 'Surface écrite à la main.'
    && !(await page.evaluate(() => document.querySelector('[data-section-field="surface"] .prompt-edited').hidden))
);
await page.click('[data-prompt-reset]');
await page.waitForTimeout(400);
// Le grain à 90 % se dit « coarse, heavily granular texture » : chercher le
// mot « grain » ne marchait que pour les valeurs basses.
check('G5 — « rendre la main aux curseurs » restaure la section', /The material is .+(grain|granular|smooth)/.test(await page.evaluate(() => document.querySelector('[data-section="surface"]').value)));

await page.click('[data-niveau="expert"]');
await page.waitForTimeout(400);
const expert = await page.evaluate(() => ({
  negatif: document.querySelector('[data-prompt-negative]').value,
  json: document.querySelector('[data-prompt-json]').value,
}));
let jsonValide = false;
try { jsonValide = JSON.parse(expert.json).object === 'organic_wall_relief'; } catch (_) { jsonValide = false; }
check('G6 — le niveau expert donne un JSON valide et un negative prompt', jsonValide && expert.negatif.includes('furniture'));

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('G7 — Échap ferme la feuille de prompt', await page.evaluate(() => document.getElementById('promptSheet').hidden));

check('H1 — aucune exception ni erreur de console sur tout le parcours', erreurs.length === 0, erreurs.join(' ; '));

await navigateur.close();
serveur.close();

const passes = resultats.filter((r) => r.ok).length;
console.log(`\n${passes}/${resultats.length} vérifications passées\n`);
if (passes !== resultats.length) process.exit(1);
