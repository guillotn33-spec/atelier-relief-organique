# Audit du lot 9 — Atelier relief organique

Audit du dépôt `Atelier-relief-organique` au 16 août 2026, sur l'arbre de travail
avant commit. Suite de tests : **124/124 sur 9 suites** (vérifié, node v22).
Le travail Claude Code + Codex est cohérent : aucun conflit de merge, aucune
double implémentation d'un même module, aucun import cassé **dans l'arbre de
travail**. Le problème est dans l'index git, pas dans le code.

---

## 0. Blocage immédiat — le commit serait cassé

### 0.1 La syntaxe

`\` en fin de ligne est du bash. PowerShell utilise le backtick `` ` ``. Le
`git add` multi-lignes a donc échoué à la première ligne, rien n'a été stagé, et
le `git commit` — dont le here-string `@' … '@` était pourtant correct — n'avait
rien à committer. Message trompeur : git a répondu « no changes added to
commit », pas « ta commande précédente a échoué ».

### 0.2 L'index partiel casse le build

L'index actuel stage `src/ui/atelier.js`, qui importe :

```js
import { ContextHelp }      from './contextHelp.js';   // ?? non suivi
import { MenuBar }          from './menuBar.js';       // ?? non suivi
import { ColorDisc }        from './colorDisc.js';     // ?? non suivi
import { BrushCursor }      from './brushCursor.js';   // ?? non suivi
```

Un `git clone` de ce commit **ne builderait pas** : esbuild échoue sur quatre
imports introuvables. Le déploiement Vercel casserait au premier push.

Trois autres incohérences dans le même index :

| Fichier | État | Conséquence si on committe tel quel |
|---|---|---|
| `tests/run-all.mjs` | modifié, non stagé | `tests/effects.mjs` est committé mais jamais exécuté par la suite |
| `src/ui/dock.js` | supprimé, non stagé | 255 lignes de code mort restent dans le dépôt |
| `build.mjs` | modifié, non stagé | `ref-1/2/3.jpg` non servies en dev → `tests/calibrate-refs.mjs` inutilisable par le prochain qui clone |
| `src/geometry/variation.js`, `src/render2d/shade.js` | modifiés, non stagés | deux correctifs de comportement perdus (bornage de variation, spéculaire `brillant`) |

**Le lot 9 est un tout.** Le découper laisse un dépôt qui ne compile pas.

### 0.3 Les commandes

```powershell
cd $HOME\Documents\Atelier-relief-organique
git add -A
git status --short
npm test
node build.mjs
```

Attendu : `124/124` puis `dist/ : app.css, app.js, index.html`.
Les avertissements CRLF sont normaux — `.gitattributes` déclare `* text=auto
eol=lf`, git normalise à l'écriture. Rien à corriger.

Puis, pour le message multi-lignes en PowerShell (le here-string était bon,
on le garde) :

```powershell
git commit -F -
```
…et coller le message, terminé par `Ctrl+Z` puis Entrée. Plus fiable que
`@' … '@` quand le message contient des apostrophes typographiques.

---

## 1. Défauts confirmés, par gravité

### G1 — Fuite DOM et casse visuelle à la réouverture d'un projet

`src/ui/effectPreviews.js:104-107`

```js
const ancien = bouton.querySelector('.effect-glyph, .effect-swatch');
const toile = this.toile(46, 29);          // classe : 'effect-thumb'
if (ancien) ancien.replaceWith(toile);
else bouton.prepend(toile);                 // ← 2ᵉ passage : ajoute au lieu de remplacer
```

`monter()` n'est pas idempotent. Au premier montage le glyphe est remplacé par
un canvas `.effect-thumb`. Au second — `main.js:64-67` fait `atelier.destroy()`
puis `new Atelier(...)` sur **le même** `#atelier`, et `destroy()`
(`atelier.js:1278-1300`) ne touche pas `this.boutique` — le sélecteur ne trouve
plus rien et on **prepend un canvas de plus**, pour chacun des 21 `.effect-item`.

Double conséquence :

- accumulation de 21 canvas par ouverture de projet ;
- **casse visuelle immédiate** : `.effect-item` est une grille à 3 colonnes
  fixes (`styles.css:1196`) ; un 4ᵉ enfant décale la vignette dans la colonne du
  texte, le texte dans la colonne de 10 px, le chevron sur une seconde ligne.

Les `.preset-card` échappent au problème (le canvas garde la classe
`preset-art`, donc il est bien retrouvé). Corriger en cherchant aussi
`.effect-thumb`, ou en ajoutant un `destroy()` à `EffectPreviews`.

### G2 — Trois curseurs reconstruisent tout le champ pour rien

`src/ui/bindings.js:33-36` les classe `scope: 'geometry'` → `rebuildInteractif()`
→ **460-580 ms** par cran sur 200×120 cm (chiffre du code lui-même,
`atelier.js:318-320`).

| Curseur | Ce qu'il fait réellement | Coût réel possible |
|---|---|---|
| `negative` | `field.js:410` : `return ctx.negative ? -h : h` — une négation sur la sortie | < 1 ms (facteur ~500) |
| `softness` | **`field.js` ne lit jamais `softness`** — 0 occurrence. Il ne pilote qu'un rayon de flou dans `heightmap.js` | 0 évaluation de champ nécessaire |
| `depth` | `h = depth · (…) + lift` : la hauteur est **affine en `depth`** (`field.js:235, 271, 395`) | un multiply-add sur le tampon, ~0,3 ms (facteur ~400) |

C'est le meilleur rapport gain/effort du dépôt. Rien à changer dans le moteur :
il suffit d'un `scope` supplémentaire (`'postprocess'`) et de trois passes
triviales sur la heightmap existante.

### G3 — Bande morte 921-980 px : l'interface se bloque

`styles.css:449` rend `#drawerToggle` visible dès 980 px, mais la règle tiroir
`#atelier .inspector-panel { position: fixed }` (`styles.css:977`) ne s'active
qu'à 920 px — et `styles.css:800` (spécificité `(1,1,0)`) maintient
`position: static` entre les deux.

Cliquer le bouton exécute `atelier.js:1180-1185`, qui ajoute `.show` au
`.backdrop` (`position: fixed; z-index: 39`) : **toute l'interface s'assombrit
et rien ne s'ouvre.** Sortie seulement par clic sur le voile ou Échap.

Cause racine : **deux familles de points de rupture qui s'entrelacent sans se
correspondre** — 620/980/981 (mise en page héritée) et 700/920/1180 (mise en
page pro). À réconcilier sur une seule grille.

### G4 — `gallery-white` écrase la couleur du mur, définitivement

`src/core/effects.js:100` : `presentation: { wallColor: '#d7d5cf' }`. C'est le
seul effet d'« Éclairage » qui écrit dans `presentation`. Choisir « Galerie
blanche » efface le choix de l'utilisateur, et l'écrasement est **collant** :
passer ensuite à « Studio chaud » ne rétablit rien.

### G5 — `#effectRandomize` ne randomise pas l'effet affiché

`proWorkspace.js:196` délègue par `.click()` à `#newVariation` →
`nextVariation(project.geometry)`, qui par contrat
(`variation.js:12-13`) **ne touche ni lumière, ni matière, ni présentation**.
L'infobulle dit « Créer une variation de cet effet » (`index.html:185`).
Quand l'effet actif est « Porcelaine » ou « Halo arrière », le bouton ne
randomise rien de ce qu'il annonce.

Corollaire : `atelier.js:943-951` ne met pas à jour `ui.activeEffectKey`.
La barre continue d'annoncer « Alvéoles » sur une géométrie qui a dérivé de
dix variations.

### G6 — `#exportTop` et `#exportMobile` ne sont branchés nulle part

`index.html:44` et `:130`. Aucun écouteur direct, aucune délégation. `#exportTop`
est le CTA principal de la barre du haut. Seul `#exportRun` (dans le tiroir
Propriétés) et Ctrl+E fonctionnent.

`#exportMobile` et `#variationMobile` sont de toute façon **inatteignables à
toute largeur** : `.mobile-actions` vit dans `.library-panel`, affichée à
≤ 620 px (`styles.css:466`), mais la `.library-panel` entière est masquée dès
≤ 700 px (`styles.css:991`).

### G7 — Bord de 1 px mal éclairé sur tout le pourtour

`shade.js:119-127` : `xl = max(0, x-1)`, `xr = min(mapW-1, x+1)`. Sur les quatre
bords la différence porte sur **1 cellule au lieu de 2**, mais `normalScale`
(calibré pour 2) est appliqué tel quel → normale trop verticale, liseré de 1 px
systématiquement mal éclairé. Invisible à 1020 px, visible à l'export 3072 px.

### G8 — Une géométrie corrompue en base rend une toile vide, sans message

`main.js:29-33` : `{ ...defaultGeometry(), ...storedGeometry }`, aucune
validation — alors que les **dimensions** passent, elles, par `validateDimension`
(`project.js:41-56`). Or `field.js:202` `Math.max(2, g.basinScaleCm)` **ne
neutralise pas NaN** (`Math.max(2, NaN) === NaN`) → `invBasin = NaN` → heightmap
entièrement NaN → toile vide, sans exception ni message.

### G9 — Le bornage de variation a un cliquet à sens unique

`variation.js:55-67`. Le correctif règle bien le symptôme mesuré (densité 10 %
ne remonte plus à 22-29 %), mais introduit une dérive monotone.

Hors intervalle canonique, l'origine coïncide avec le **bord** de l'intervalle de
réflexion : tout tirage descendant est replié vers le haut, aucun ne passe. La
distribution est donc strictement ≥ l'origine (espérance +0,035 par variation à
`amount = 0.07`). Et `lo` est recalculé depuis la nouvelle valeur au tour
suivant : **le plancher monte à chaque clic**. Une densité posée à 10 % rejoint
la bande [0,18 ; 0,72] en 2 à 3 variations et n'en ressort plus. C'est la « borne
collante » que le commentaire dit vouloir éliminer, déplacée du bord canonique
vers le point de départ de l'utilisateur.

Correction : centrer l'intervalle sur l'origine —
`lo = min(bb, o − (bh−bb)/2)`, `hi = max(bh, o + (bh−bb)/2)` — ou ne pas
réfléchir du tout hors bande.

Accessoire : la garde `span <= 0` (l.60) est **morte** pour toutes les clés
existantes, et ne protège pas du cas NaN qu'elle semble viser.

---

## 2. Performance — les gains, par impact

Ordres de grandeur mesurés dans le code : 200 000 cellules et 460-580 ms par
reconstruction complète (200×120 cm) ; 651 000 px par rendu d'ombrage.
**Aucun Web Worker, aucun OffscreenCanvas, aucun tableau typé** dans le dépôt
(0 occurrence de `Worker|OffscreenCanvas|Float32Array|Uint8`). Tout est sur le
thread principal, en tâches longues de 10× le seuil des 50 ms.

| # | Constat | Fichier | Gain |
|---|---|---|---|
| P1 | `negative` / `softness` / `depth` reconstruisent tout (voir G2) | `bindings.js:33-36` | **facteur 400-500** sur 3 curseurs |
| P2 | `evalParts` alloue un objet à 6 champs **par cellule**, dont 2 jamais lus. Justifié par une animation de houle qui n'existe plus (`atelier.js:123`) | `field.js:393-400` | 200 000 allocations/reconstruction |
| P3 | `rim` (un `fbm` complet) calculé inconditionnellement, **jamais lu** par les familles `cells` et `archipelago` | `field.js:324` | −16,7 % du bruit en Cellules, −12,5 % en Archipel |
| P4 | Les branches `dunes`/`cells`/`archipelago` divisent en dur (jusqu'à **7 divisions/cellule**) là où `organic` utilise les réciproques précalculées de `makeFieldContext:214-221` | `field.js:331-365` | ~1,4 M divisions évitables |
| P5 | Invariants recalculés 200 000 fois : `wavelength` (l.333), `threshold` (l.336), `width` (l.347), `shoulderBasin*1.50` (l.357)… | `field.js` | ~2 M multiplications |
| P6 | `hash01` fait une **division flottante** par appel — 5,4 M/reconstruction en Cellules. Dans la fonction même dont le commentaire l.83-86 refuse `Math.hypot` au motif qu'il est trop lent | `field.js:59` | 15-25 ms |
| P7 | `shade.js:191` : `Math.pow(Math.hypot(…)/0.71, 1.8)` par pixel, **fonction des seules coordonnées** — recalculé à chaque réombrage alors qu'il ne change qu'au redimensionnement | `shade.js:191` | 26-40 ms **à chaque cran** d'un curseur de lumière |
| P8 | 31 accès `sp.*` par pixel non hoistés (~20 M chargements/rendu) ; 84 accès `ctx.*` dont 10 chaînes `ctx.geometry.*` à deux niveaux | `shade.js:114-197`, `field.js:293-401` | 10-25 % typique, modification mécanique |
| P9 | `scope: 'shading'` (12 liaisons) appelle `render()` **synchronement dans le handler `input`**, pleine résolution, sans rAF ni coalescence — alors que `moveLight:932` throttle à un rAF et rend en demi-résolution pour le **même** paramètre | `atelier.js:350-352` | ~4× par événement, file qui déborde |
| P10 | `scope: 'size'` reconstruit en qualité 1 ; la poignée de redimensionnement fait le même changement en qualité 0,35 (`previewResize:1068`) | `atelier.js:340-347` | ~8× par image + reflow synchrone forcé (`getComputedStyle` + `getBoundingClientRect`) |
| P11 | `updateControlDisplays` fait 24 `querySelector` + 24 `setProperty` **par `pointermove`**, hors du garde `lightBusy` | `atelier.js:414-430` | non throttlé alors que le rendu l'est |
| P12 | 27 vignettes rendues au démarrage (pas 11 comme l'annonce `atelier.js:230`), dont les **13 des catégories fermées**. Aucun `IntersectionObserver` | `effectPreviews.js:125,135` | ~486 ms après la première peinture |

**Ordre d'attaque conseillé** : P1 (jour), puis P7 + P9 + P11 (le trio qui rend
les curseurs de lumière fluides), puis P3 + P4 + P5 (mécanique, sans risque),
puis P2. P12 se règle avec un `IntersectionObserver` sur les `<details>`.

Le vrai palier suivant est un **Web Worker** pour `buildHeightmap` : tant que la
reconstruction tourne sur le thread principal, même optimisée d'un facteur 3
elle reste une tâche longue de 150 ms pendant laquelle l'indicateur
« Calcul du relief… » ne peut même pas s'animer.

---

## 3. Dette laissée par la refonte

### 3.1 CSS mort — ~104 lignes sur 1254 (8 %)

Confirmé, aucune référence ni dans `index.html` ni dans les 11 JS :

- `.mini-palette` et sa règle enfant — `styles.css:282-299`
- `.dock--dragging`, `.dock--will-snap`, `.dock--collapsed` — `254-257`
- `.dock-handle`, `.dock-handle:active`, `#atelier .toolbar > .dock-handle` — `259-272`, `752`
- `.dock-guide` — `274-280`
- `#viewer3d`, `.art-wrap[data-view="3d"]` — `205-209` (**périmètre 3D retiré il y a un lot, son CSS est resté**)
- `.library-action*`, `.base-actions` — `675-695` (21 lignes)
- `.variation-actions`, `.variation-pair` — `367-370`
- `.sidebar-intro` — `73-74` ; `.btn-icon` — `69` ; `.panel-count` — `616`

À conserver malgré l'apparence : `.dim-*` (`399-411`) et `.project-row`
(`416-418`) sont construits en JS par `creation.js`.

Mort par spécificité, plus insidieux :

- `@media (max-width: 980px)` est **presque entièrement inerte** : ses règles
  sont en `(0,1,0)` face aux `#atelier …` en `(1,1,0)` (`styles.css:446-464`)
- `styles.css:457` `.top-actions .btn:first-child { display: none }` **ne matche
  plus rien** — le premier enfant est désormais `#drawerToggle`, qui porte
  `.icon-btn`. Le masquage de « Nouveau » sous 620 px a cessé silencieusement.
- `body` : le dégradé radial de `styles.css:28-36` n'est **jamais peint**,
  écrasé par `body { background: var(--app-bg) }` en `522`.

### 3.2 Deux systèmes de jetons de couleur concurrents

`:root` en `styles.css:6-16` (`--ink --muted --line --panel --accent`) et
`:root` en `styles.css:493-508` (`--text --text-2 --hairline --lime --chrome`).
Paires quasi identiques jamais réconciliées :

```
--accent  #d9ff74        --lime  #caff54          ← deux verts dans la même page
--ink     #f4f0e8        --text  #f1efe8
--line    rgba(255,255,255,.11)   --hairline rgba(255,255,255,.085)
```

`--chrome-2` et `--chrome-3` (`496-497`) sont déclarées et **jamais lues** — leurs
valeurs sont inlinées en dur ailleurs (`#1b1c19` en 748 et 910). `colorDisc.js:181`
écrit `--teinte`, que **rien ne lit**.

### 3.3 29 sélecteurs redéfinis à plus de 50 lignes d'écart

Les plus dangereux : `#atelier .stage` (438, 442, 780, 994), `#atelier
.stage-shell` (437, 703, 980, 992), `#atelier .pro-workspace` (591, 970, 976,
990), `#atelier .library-panel` (991, 1099, 1232). `@media (max-width: 1180px)`
est déclaré **deux fois**, à 262 lignes d'écart (`969` et `1231`).

Effet concret : `styles.css:618` déclare `grid-template-rows` à **3 rangées** pour
`.library-panel`, qui en a 4 depuis la refonte — faux, mais masqué par la
redéfinition ligne 1099.

### 3.4 Cible iPad coupée en deux au milieu de sa gamme

`styles.css:969-973` masque, en `!important`, tout `.advanced-brush` +
`.brush-options-sep` sous `max-width: 1180px` — borne **inclusive**.

- iPad 10,9″ paysage (1180 pt), iPad Air/10,2″ (1024-1112 pt) → **perdent**
  allongement, orientation, suivi de tracé, aperçu de brosse
- iPad Pro 11″ (1194 pt) et 12,9″ (1366 pt) → les gardent

Deux produits différents à 14 points d'écart.

---

## 4. Accessibilité — 5 constats confirmés

Le fond est bon : aucun `for` cassé, aucun `<button>` muet, tous les
`aria-controls`/`aria-labelledby` pointent juste. Les 35 `<label for="X">` qui
enveloppent aussi leur input sont redondants mais **valides**.

1. **`role="status"` détourné** — `index.html:186`. Un témoin décoratif statique
   déclaré région live polie, avec un `<span>` vide dedans. Rien n'est jamais
   annoncé et la région pollue l'arbre live. Le bon rôle serait `switch` +
   `aria-checked`, ou aucun.
2. **`#effectSearch` sans nom accessible** — `index.html:67`. Le seul contenu
   textuel du `<label>` est le `⌕`, qui est `aria-hidden`. Le nom retombe sur le
   `placeholder`, qui disparaît à la saisie.
3. **Double annonce sur les molettes** — `index.html:191-194`. `<output>` a un
   rôle implicite `status` (région live) et vit dans un `<button role="slider">`
   dont `proWorkspace.js:141` met déjà `aria-valuenow`/`aria-valuetext` à jour :
   deux annonces concurrentes par cran. Les autres `<output>` du fichier sont
   correctement neutralisés par `aria-hidden` — ces quatre-là ont été oubliés.
4. **Glyphes non masqués** — `index.html:81-113`. Les 21 boutons d'effets
   s'annoncent « ⌘ Relief organique › ». Le reste du fichier respecte pourtant
   la convention.
5. **`role="tab"` incomplet** — `index.html:273-275`. Ni `id`, ni `aria-controls`
   sur les onglets ; ni `aria-labelledby`, ni `tabindex="0"` sur les panneaux.
   Le lecteur annonce « onglet 1 sur 3 » sans jamais relier le panneau.

---

## 5. Recherche d'effets — quatre finitions

`proWorkspace.js:179-194`. Le filtrage marche, les catégories vides sont bien
masquées (`[hidden] { display: none !important }` en `styles.css:24` neutralise
correctement le `display` des `<details>`). Restent :

- **`.category-count` n'est jamais recalculé** : une recherche qui affiche
  1 matière laisse le résumé annoncer « 7 » (`proWorkspace.js:189-193`)
- **L'ouverture forcée n'est pas réversible** (`l.192`) : après une recherche
  puis effacement, « Matières » et « Éclairage » restent dépliés
- **Aucun repli d'accents** (`l.181,186` : `toLocaleLowerCase` sans
  `normalize('NFD')`) : « alveole » ne trouve pas « Alvéoles », « erosion » ne
  trouve pas « Érosion progressive »

---

## 6. Ce qui est propre — vérifié, rien à faire

- **Correspondance HTML ↔ EFFECTS parfaite** : 24 `data-effect` ↔ 24 clés, zéro
  orphelin dans les deux sens. Les 4 compteurs de catégorie sont justes.
- **Aucun effet inerte** : les 7 matières et 6 éclairages sont deux à deux
  distincts et tous différents des valeurs par défaut. Vérifié par comparaison
  programmatique.
- **Les vignettes sont bien rendues par le vrai moteur**, même chemin que le clic
  (`effectPreviews.js:186-196`), et la file est étalée un élément par tour —
  aucune boucle synchrone de N rendus.
- **Coalescence des reconstructions correcte** : `renderToken` (`atelier.js:599`)
  est incrémenté puis relu dans le callback différé, et invalidé dans `destroy`.
  Plusieurs `rebuild()` dans la même image se réduisent bien à une seule.
- **Aucune division par zéro** dans `shoulderRamp`, `smin`/`smax`,
  `sparseEllipticSignal` — les gardes couvrent tous les réels, y compris pour un
  appel externe. `-Infinity` traverse `shoulderRamp` et ressort en 0.
- **Modulo sur négatif correct** (`wrapAngle`, `hash01` en `>>>`), **aucun
  `clamp` à bornes inversées** sur les 14 sites, **PRNG déterministe** et
  reproductible (`mixSeed` pur, `mulberry32` réinstancié).
- **Aucun état mutable partagé** : `PRESETS[k].geometry` et `EFFECTS[k].geometry`
  sont systématiquement étalés dans un objet neuf.
- **Le balayage 3×3** de `cellularSignal`/`sparseEllipticSignal` est
  mathématiquement justifié — la troncature au rang 2 est exacte, biais de `smax`
  borné par `k/4 = 0,065`, vérifié.
- **`.gitattributes`** est correct (`* text=auto eol=lf`, `*.jpg binary`) : les
  avertissements CRLF sont le fonctionnement normal, pas un défaut.

---

## 7. Incohérences mineures, à noter

- **État initial contradictoire** : `defaultUi()` déclare `presetKey: 'dunes'` et
  `activeEffectKey: 'fluid-dunes'` (`project.js:199-201`) alors que
  `defaultGeometry()` (famille `organic`, 52 cm) ne correspond ni au preset
  `dunes` (38 cm, elongation 0,82) ni à l'effet `fluid-dunes` (famille `dunes`,
  43 cm). `index.html:81` marque `organic-relief` actif et `index.html:184`
  affiche en dur « Dunes fluides ». **Trois désignations différentes sur un
  projet neuf.**
- **Deux chemins parallèles pour la même chose** : les vignettes de référence
  passent par `applyPreset` (`atelier.js:1114`) et non `applyEffect`. Les deux
  produisent aujourd'hui la même géométrie — vérifié champ par champ — mais ce
  sont deux implémentations à maintenir en phase.
- **`applyEffect` ne met à jour ni `designName` ni `presetKey`** pour
  `material`/`lighting` (`effects.js:149-150`) : après « Terre cuite », la
  vignette « Dunes » reste allumée.
- **Le grisage famille-dépendant est codé en dur pour un seul contrôle** :
  `syncFamilyControls` (`atelier.js:398-412`) ne connaît que `channelWeight` et
  une seule condition, avec le libellé écrit en dur. Un **second** mécanisme,
  différent, existe pour la brosse (`atelier.js:447` utilise `.is-disabled`
  quand le premier utilise `.control-inert`). Rien dans `BINDINGS` ne déclare
  l'applicabilité.
- **`wave` est largement inerte** hors `organic`/`cells` — `field.js:391` force
  `carrierHeight = 0` pour `dunes` et `archipelago` — et n'est **pas** grisé. Il
  reste un résidu via `carrierBias` ; à mesurer avant de trancher. Si le résidu
  n'est pas perceptible, c'est exactement le mensonge d'interface que
  `syncFamilyControls` prétend corriger, laissé en place.
- **`!important` devenus gratuits** : `styles.css:733-735` (`position/left/top`
  sur `.toolbar.dock`) neutralisaient le positionnement flottant de `dock.js`.
  Plus rien n'écrit `top`/`left` sur la barre depuis sa suppression.

---

## 8. Plan proposé

**Maintenant** — `git add -A`, `npm test`, `node build.mjs`, puis committer.
Le lot est cohérent, il ne se découpe pas.

**Lot 10 — correction** (une journée) : G1 (fuite DOM, casse visuelle),
G3 (bande morte 921-980), G6 (`#exportTop` mort), G4 (mur écrasé),
G5 (bouton qui ment). Ce sont cinq défauts que l'utilisateur rencontre.

**Lot 11 — performance** (le mandat du projet) : P1 d'abord — facteur 400 sur
trois curseurs pour un `scope` supplémentaire et trois passes triviales. Puis
P7 + P9 + P11 ensemble : c'est ce qui rend les curseurs de lumière fluides.
Puis P3/P4/P5, mécaniques et sans risque. Mesurer avant/après avec `bench.html`,
qui existe déjà.

**Lot 12 — dette** : réconcilier les deux systèmes de jetons CSS et les deux
familles de breakpoints, supprimer les ~104 lignes mortes, puis les cinq
constats d'accessibilité et les quatre finitions de recherche.

**Horizon** : Web Worker pour `buildHeightmap`. C'est le seul changement qui
sorte la reconstruction du thread principal ; tout le reste ne fait que rendre
la tâche longue moins longue.

---

*Audit conduit sur l'arbre de travail, hors `node_modules` et `legacy/`.
Chaque constat marqué « confirmé » a été vérifié dans le code source, référence
fichier:ligne à l'appui. Suite de tests exécutée : 124/124.*
