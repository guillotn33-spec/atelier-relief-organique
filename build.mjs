// Build léger — esbuild uniquement, aucune dépendance CDN à l'exécution.
// `node build.mjs`         → bundle de production dans dist/
// `node build.mjs --serve` → même bundle, watch + serveur local sur :4321
//
// Le mode --serve est le seul mode de développement supporté : le
// fonctionnement en file:// n'est plus un critère (amendement C).

import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// Actifs statiques copiés tels quels à la racine de dist/.
//
// EN MODE --serve, ILS SONT AUSSI SURVEILLÉS. La surveillance d'esbuild ne suit
// que le graphe des modules : `index.html` n'en fait pas partie, si bien que le
// modifier n'avait AUCUN effet jusqu'au redémarrage du serveur. Mesuré à
// l'occasion : un attribut ajouté au balisage restait invisible dans la page et
// la correction passait pour inopérante.
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
// Harnais d'empreinte comportementale (§20, lot 8). Développement seulement :
// il pilote l'interface et n'a rien à faire dans un déploiement.
if (serve) entryPoints.empreinte = path.join(root, 'src', 'empreinte.js');

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
  for (const file of staticFiles) {
    watch(path.join(root, file), { persistent: false }, () => {
      copyFile(path.join(root, file), path.join(dist, file))
        .then(() => console.log(`[watch] copié : ${file}`))
        .catch(() => {});
    });
  }
  const { host, port } = await ctx.serve({ servedir: dist, port: 4321 });
  console.log(`\n  Atelier → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);
} else {
  await esbuild.build(options);
  const produced = await readdir(dist);
  console.log('dist/ :', produced.join(', '));
  if (!existsSync(path.join(dist, 'app.js'))) process.exit(1);
}
