// Build léger — esbuild uniquement, aucune dépendance CDN à l'exécution.
// `node build.mjs`         → bundle de production dans dist/
// `node build.mjs --serve` → même bundle, watch + serveur local sur :4321
//
// Le service worker (lot 7) exige une origine http(s) : le mode --serve est donc
// le seul mode de développement supporté. Le fonctionnement en file:// n'est plus
// un critère (amendement C).

import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// Actifs statiques copiés tels quels à la racine de dist/.
// Le banc de mesure n'est servi qu'en développement : il ne doit pas être
// déployé avec l'application.
const staticFiles = serve ? ['index.html', 'bench.html'] : ['index.html'];
for (const file of staticFiles) {
  await copyFile(path.join(root, file), path.join(dist, file));
}

// Les images de référence ne sont pas embarquées dans l'application ; elles
// restent des documents de travail à la racine du dépôt.

// Entrées nommées plutôt qu'un `outfile` : cela conserve `app.js` / `app.css`
// tout en permettant d'ajouter le banc en développement seulement.
const entryPoints = { app: path.join(root, 'src', 'main.js') };
if (serve) entryPoints.bench = path.join(root, 'src', 'bench.js');

const options = {
  entryPoints,
  bundle: true,
  format: 'esm',
  target: ['safari16'],
  outdir: dist,
  sourcemap: serve ? 'inline' : false,
  minify: !serve,
  legalComments: 'none',
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: dist, port: 4321 });
  console.log(`\n  Atelier → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);
} else {
  await esbuild.build(options);
  const produced = await readdir(dist);
  console.log('dist/ :', produced.join(', '));
  if (!existsSync(path.join(dist, 'app.js'))) process.exit(1);
}
