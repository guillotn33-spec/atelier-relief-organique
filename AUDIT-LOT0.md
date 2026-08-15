# Lot 0 — Audit de `atelier-relief-organique.html`

Objet audité, identifié avant lecture :

| | |
|---|---|
| chemin | `C:\Users\guill\Documents\Atelier-relief-organique\atelier-relief-organique.html` |
| sha256 | `92925d8ed24de4de352d0301d1f26209e296b09b4d28afe45baa02faea980807` |
| taille | 66 961 octets |
| lignes | 1693 |
| modifié | 14/08 22:29 |

Le dossier contient aussi `ref-1.jpg`, `ref-2.jpg`, `ref-3.jpg` et un `.gitkeep`.
**Il n'y a pas de dépôt git** (`git status` → *not a git repository*).

Poste : node v24.16.0, npm 11.13.0, git 2.54.0. Rien ne manque pour un build esbuild.

Aucune mesure de temps n'a été faite dans cet audit. Tout ce qui touche à la
performance ci-dessous est un **comptage d'opérations lu dans le code**, pas un
chronométrage. C'est signalé à chaque fois.

---

## 1. Les dépendances au rapport 1.6

Neuf sites réels, plus deux faux positifs qu'il ne faut pas toucher.

| Ligne | Code | Nature | Ce qui casse en format libre |
|---|---|---|---|
| 321 | `.art-wrap { aspect-ratio: 1.6 }` | CSS | la toile ne peut pas être carrée ni ronde |
| 656 | `export 1920 × 1200 px` | texte | mensonge d'affichage dès §17 |
| 710 | `const SW = 256, SH = 160` | **grille de sculpture** | grille anisotrope sur 500×50 ou sur un rond |
| 792 | `const dy = (candidate.y - other.y) * 1.6` | placement des formes | espacement faux hors 1.6 |
| 1095 | `lowH = Math.round(lowW / 1.6)` | patch de sculpture | patch décalé pendant le trait |
| 1140 | `renderRelief(previewCanvas, 460, 288, cfg)` | aperçu lumière | aperçu déformé |
| 1197 | `height = Math.round(width / 1.6)` | **rendu principal** | tout le rendu |
| 1261 | `renderRelief(output, 1920, 1200, …)` | export PNG | export déformé |
| 1310, 1315 | `radius * 1.6`, `dy / 1.6` | forme de brosse | brosse ovale au lieu de ronde |

Faux positifs, à **ne pas** remplacer :
- lignes 1326 et 1328, `strength * dose * 1.6 * fall` : `1.6` est un **gain de dose** du creusement, sans aucun rapport avec le format ;
- ligne 1268, `setTimeout(…, 1200)` : millisecondes.

**Bonne nouvelle structurelle** : le cœur du champ est déjà paramétré en `aspect`
(`makeRenderContext` l.861, `computeField` l.899, `buildValleys` l.834). Les neuf
sites ci-dessus sont périphériques. Le champ lui-même n'est pas à 1.6.

**Mauvaise nouvelle, plus grave que les 1.6** : les formes sont placées en
coordonnées **normalisées uv** (`x: -0.03 + rng() * 1.06`, l.786). Agrandir la toile
répartit *le même nombre* de formes sur une surface plus grande. L'amendement D
demande l'inverse : agrandir doit **révéler du motif supplémentaire**. Aucun réglage
des 1.6 ne donne ce comportement — il faut un champ continu en **centimètres** dont
la toile est une fenêtre. C'est le même verdict que l'amendement A, atteint par
l'autre bout.

---

## 2. Il n'y a pas de modèle de projet

L'état est éclaté en trois endroits, sans objet central :

1. **le DOM** — `readConfig()` (l.753) relit les 17 `<input>` à chaque rendu. Les
   valeurs métier vivent dans les contrôles, pas en mémoire ;
2. **six variables de module** — `seed`, `currentName`, `renderToken`, `lastFull`,
   `sculptActive`, `activeTool` (l.703-719) ;
3. **trois Float32Array** — `sculpt.warpX/warpY/height` (l.711-715).

Conséquences directes pour la suite :
- pas de forme de toile, pas de dimensions physiques, pas de profondeur en cm —
  rien à persister pour §2 ;
- `presets` (l.682-701) **mélange** géométrie (`count`, `scale`, `elongation`,
  `flow`, `irregularity`, `depth`, `softness`, `wave`) et lumière/présentation
  (`lightAngle`, `lightHeight`, `contrast`, `backlight`, `wallColor`, `frame`,
  `panelLayout`). §4 exige la séparation explicite des deux ;
- `saveState()` est appelé **à chaque rendu** (l.1200), donc chaque mouvement de
  slider écrit dans localStorage.

## 3. La heightmap n'existe pas comme donnée

C'est le point le plus important de l'audit.

`renderRelief` (l.1065) alloue `new Float32Array(width * height)`, le remplit, le
floute, l'ombre, puis **le jette**. Il n'y a aucun tableau de hauteurs conservé.
La heightmap est une *fonction pure* de `(cfg, seed, calque de sculpture)`,
réévaluée à chaque fois, à la résolution du rendu du moment (560→1020 px en
aperçu, 1920 à l'export, 460 en aperçu-lumière, `aw*animQuality` en animation).

Or §9 dit « le système de heightmap actuel reste la source de vérité » et exige que
la vue 3D et l'édition 2D montrent **exactement** le même relief ; §4 exige de
mémoriser « exactement l'état géométrique courant » ; §5 exige un négatif
non destructif restituant « exactement » le relief précédent ; §18 exige un mesh
issu de « exactement la même heightmap ».

Ces quatre exigences portent sur un objet qui n'existe pas encore. **Le lot 1 doit
matérialiser une heightmap canonique** — une grille de résolution définie, ancrée
en cm, indépendante de la résolution d'affichage — dont le rendu 2D, le mesh 3D et
les exports sont tous des consommateurs. Sans cela, §4, §5, §9 et §18 ne peuvent
être qu'approximés, ce que la spec interdit mot pour mot.

---

## 4. Pourquoi le générateur actuel ne peut pas produire les références

L'amendement A est confirmé par le code, mécanisme par mécanisme.

**a) Les formes sont placées pour ne PAS se toucher.** `createShapes` (l.776) tire
34 candidats et garde celui qui **maximise** la distance minimale normalisée aux
formes déjà posées (l.784-796). C'est un dart-throwing anti-recouvrement. Les
références montrent des creux qui se recouvrent franchement et deviennent un
chenal unique.

**b) Les liaisons sont des exceptions, pas la règle.** `buildValleys` (l.826) ne
relie que les 2 plus proches voisins, et **rejette** la liaison si
`d > (rayons)·2.4` ou `d > .6` (l.841-842). On obtient des capsules fines greffées
entre des bols, pas une topologie continue.

**c) Le fond des cavités est plat.** `inner = 1 - smoothstep(.45, 1.0, r)` (l.908) :
pour tout `r ≤ .45`, `inner = 1`, donc `bowl` est **constant** sur les 45 % centraux
de chaque ellipse. Le creux n'est pas monotone, il a un plateau.

**d) Et sur ce plateau, on ajoute une houle indépendante.** `out[…] = swell + field
+ lift` (l.931) : la houle (l.925-929) est une somme de trois sinus **globaux**, sans
aucun rapport avec la position des cavités, d'amplitude `depth·(0.10 + wave·0.40)`
— soit ≈ 0,31 aux réglages Dunes contre ≈ 0,7-1,0 pour la profondeur d'un creux.
Une modulation de 30 à 40 % de la profondeur, **appliquée à l'intérieur d'un fond
plat**, produit exactement l'îlot central et l'anneau que l'amendement A interdit.

**e) Une modulation angulaire s'ajoute par-dessus.** `irregular` (l.904-906) module
le rayon par `sin(3θ)` et `sin(5θ)` — c'est ce qui fabrique les lobes en trèfle
visibles sur les grandes cavités.

Conclusion : `createShapes` + `buildValleys` + le terme `swell` additif sont à
**remplacer**, pas à régler. La cible (bruit fbm + domain warp + smoothstep +
smooth minimum + houle porteuse basse fréquence) est un autre moteur. En revanche
`smin` (l.821), `blurHeightMap` (l.936) et tout le bloc d'ombrage sont réutilisables
tels quels.

Ce que montrent les trois références, pour mémoire du lot 2 : plateaux hauts très
clairs et larges, creux **fusionnés en chenaux** qui traversent le panneau, fonds
de cavité presque noirs, aucune arête, aucun reflet, matière plâtre à grain fin,
halo lumineux derrière le panneau, joints de panneaux visibles (ref-1, ref-2) ou
cadre noir fin (ref-3).

---

## 5. Sculpture

Ce qui existe et fonctionne (à conserver intégralement, §23) :

| Fonction | Lignes |
|---|---|
| 5 outils : `warp`, `dig`, `raise`, `smooth`, `erase` | 1302-1343 |
| pression du stylet (`ev.pressure`, défaut .55) | 1468 |
| événements coalescés (`getCoalescedEvents`) | 1465 |
| undo/redo 15 niveaux + raccourcis clavier | 1346-1380, 1642 |
| rendu incrémental par zone sale pendant le trait | 1090-1132, 1438-1462 |
| persistance Int16 quantifiée + base64 | 1388-1423 |

Limites structurelles :
- la grille est en **uv normalisé** (256×160), donc ancrée à la toile, pas à la
  matière. L'amendement D (ancrage en cm, points conservés hors toile après
  réduction) impose de changer d'espace et de rendre la grille non bornée ;
- le rayon de brosse est `brushSize/100` en **fraction de largeur** (l.1303) : la
  même brosse fait 5 cm sur un panneau de 50 cm et 50 cm sur un panneau de 500 cm ;
- la brosse est ronde à l'écran uniquement grâce au 1.6 câblé (l.1310, 1315) ; §6
  demande de toute façon une brosse elliptique orientable, ce code est à refaire ;
- l'undo/redo ne couvre **que** le calque de sculpture. Ni les réglages, ni la
  seed, ni les presets n'y entrent. §4 (`Retour base`) et §5 (négatif) ne peuvent
  pas s'appuyer dessus en l'état ;
- chaque instantané d'undo copie 3 × 40 960 flottants = **491 KB** ; la pile de 15
  occupe donc ≈ 7,4 MB de RAM en permanence.

## 6. Pointeurs et gestes

Tout passe par quatre écouteurs sur `artWrap` (l.1601-1629), sans arbitrage.

- **Le deuxième doigt est explicitement jeté** : `if (activePointers.size > 1)
  { endStroke(); lightDragId = null; return; }` (l.1604). Aucun pinch n'est possible
  aujourd'hui, c'est bien un rejet volontaire à remplacer (§11).
- **Fuite de pointeur, bug réel** : `activePointers` n'est alimenté que par
  `pointerdown` sur `artWrap`, et `setPointerCapture` n'est appelé que pour le
  premier pointeur (l.1605). Si le deuxième doigt se lève hors de l'élément, son
  `pointerup` n'arrive jamais, `activePointers` ne redescend pas à 1, et **toute
  sculpture ultérieure est bloquée** jusqu'au rechargement. Le futur gestionnaire
  de gestes ne doit pas reproduire ce schéma.
- Aucune notion de verrouillage de geste, aucune orbite, aucune poignée de
  redimensionnement, aucune barre déplaçable. §10, §11, §14, §15 et §22 sont du
  code entièrement neuf.
- `<meta name="viewport" content="width=device-width, initial-scale=1">` (l.5)
  laisse le zoom Safari actif ; seul `.art-wrap { touch-action: none }` (l.329) le
  bloque localement. Le pinch de §11 devra cohabiter avec ça explicitement.
- Un `ResizeObserver` sur `artWrap` relance un rendu complet (l.1681) : il entrera
  en conflit direct avec la poignée de redimensionnement de §3.

## 7. Rendu et coût

Rendu **Canvas 2D, boucle par pixel sur le CPU, synchrone**, sur le thread
principal. Trois étages : `computeField` (l.873) → `blurHeightMap` (l.936) →
`shadeRegion` (l.1024).

Comptage lu dans le code pour l'export 1920 × 1200 aux réglages Dunes (2 304 000
pixels, 9 formes, ~14 vallées, adoucissement 62) :

- `computeField` : par pixel, une passe sur chaque forme avec `cos`, `sin`,
  `atan2`, `hypot`, plus une passe sur chaque vallée avec `hypot`, plus 3 `sin`
  de houle → de l'ordre de **10⁸ appels transcendantaux** ;
- `blurHeightMap` : rayon `1920 × (0.006 + 0.62 × 0.018) ≈ 33`, donc un noyau de
  67 taps en deux passes séparables → **≈ 3 × 10⁸ multiplications-additions** ;
- `shadeRegion` : 2 hachages entiers + 1 `pow` + 3 `hypot` par pixel.

Le tout dans un seul appel bloquant, sans worker, sans découpe temporelle. Je n'ai
**pas mesuré** la durée réelle ; le comptage suffit à dire que §21 (réactivité au
Pencil) impose un worker ou une découpe, et que rien de tout cela ne peut être
appelé pendant un `pointermove`.

Gaspillage évident et facile à récupérer au lot 2 : `Math.cos(shape.angle)` et
`Math.sin(shape.angle)` sont recalculés **à l'intérieur de la boucle de pixels**,
pour chaque forme et chaque pixel (l.897-898), alors qu'ils sont constants.

Détail à ne pas perdre : l'occlusion utilise `mean`, la moyenne de **toute** la
carte (l.1074-1077), et les patchs incrémentaux réutilisent le `mean` du dernier
rendu complet (l.1119). C'est un couplage global qui devra être décidé explicitement
quand la heightmap deviendra canonique.

## 8. Persistance — le chiffre qui tranche pour l'amendement E

Deux clés localStorage : `relief-lab-state-v2` (l.1232) et `relief-lab-sculpt`
(l.1403).

Taille exacte du calque de sculpture, calculée depuis le code :
`SW × SH = 40 960` cellules × 3 champs = 122 880 entiers 16 bits = **245 760 octets**,
encodés en base64 = **327 680 caractères**. Safari compte le quota en UTF-16, soit
**≈ 640 KB de quota consommés par un seul calque de sculpture**, pour un quota
d'environ 5 MB par origine.

Un projet + son instantané de base = ≈ 1,3 MB. **Le quota Safari est atteint vers
quatre projets.** L'amendement E n'est pas une précaution, c'est une nécessité
arithmétique. La migration devra lire ces deux clés au premier lancement.

## 9. Export

`exportPng` (l.1254) : PNG seul, **1920 × 1200 câblé**, nom de fichier
`relief-organique-<seed>.png`, `toBlob` + `link.click()`. Pas de JPEG, pas de choix
de résolution, pas de respect du format du projet, pas de transparence, aucun export
3D, aucune dépendance 3D dans le fichier.

## 10. Interface, build, PWA

- À supprimer visuellement (§12) : `.topbar` (l.498-511) avec `.brand-mark`,
  `.eyebrow` « Relief lab » et le `<h1>`. Le `<title>` (l.7) reste.
- L'accent vert `--accent: #d9ff74` (l.16) irrigue une vingtaine de règles CSS :
  presets actifs, valeurs de contrôles, pistes et pouces de sliders, outils actifs,
  interrupteurs, halo de focus. §12 impose une gamme de gris intégrale.
- Les sliders ont un pouce rond de 22 px (l.213-222) ; §12 demande un curseur fin à
  indicateur angulaire, en gardant une cible tactile large — la piste et le pouce
  devront donc être dissociés visuellement de la zone de saisie.
- `brushSize` et `brushStrength` (l.651-652) n'affichent **aucune valeur** ; §13
  l'exige, et exige aussi une valeur flottante pendant le glissement pour tous les
  sliders.
- Aucun `manifest`, aucun service worker, aucune icône, aucun `apple-touch-icon`.
  Un seul `<meta name="theme-color">` (l.6). §19 est intégralement à faire, et un
  service worker impose une origine HTTPS : le fichier local ne peut pas devenir
  une PWA, ce qui confirme l'amendement C.
- Tout le JS est une IIFE unique de 1027 lignes (l.664-1690), sans module, sans
  export, sans build. Aucune dépendance externe, aucun CDN — c'est le seul point
  déjà conforme à §19.

---

## 11. Inventaire de conservation (§23)

À vérifier fonctionnel après chaque lot. Localisation actuelle :

| Fonction | Où | Menacé par |
|---|---|---|
| presets Dunes / Cellules / Archipel | l.682-701, 1206 | lot 2 (nouveau moteur) — les réglages n'auront plus le même sens |
| sculpture 5 outils | l.1302-1343 | lots 1 (espace cm), 3 (gestes), 6 (brosse orientée) |
| pression Apple Pencil | l.1468 | lot 3 |
| événements coalescés | l.1465 | lot 3 |
| undo / redo | l.1346-1380 | lot 1 (doit couvrir plus que la sculpture) |
| gomme | l.1334-1338 | lot 1 |
| lissage | l.1294-1300, 1329 | lot 1 |
| ondulation (outil `warp`) | l.1322-1324 | lot 1 |
| ondulation (slider `wave`) | l.867, 925-929 | **lot 2 — le terme `swell` additif est justement la cause du défaut §4d** |
| animation | l.1503-1587 | lot 2, lot 5 |
| persistance auto | l.1226-1252, 1388-1423 | lot 1 (IndexedDB) |
| couleur matière / mur | l.578, 628, 1003, 1147 | lot 4 |
| lumière (direction, hauteur, contraste, halo) | l.597-612, 1000-1022 | lot 4 |
| découpe des panneaux | l.970-988 | lot 5 (doit exister aussi en 3D) |
| cadre noir | l.990-998 | lot 5 |
| export image | l.1254-1275 | lot 6 |

Le seul cas où « conserver » et « refondre » se contredisent est l'**ondulation**
au sens du slider `wave` : §23 demande de la garder, l'amendement A demande de
supprimer le mécanisme qui la produit. Résolution proposée au lot 2 : conserver le
**réglage** et son effet perçu (une houle qui traverse la pièce), en le
réimplémentant comme **houle porteuse basse fréquence intégrée au champ avant
creusement** — et non plus comme une somme ajoutée après coup. C'est ce que demande
l'amendement A, et c'est ce qui supprime les îlots.

---

## 12. Ce que le lot 1 doit produire

1. dépôt git propre + `.gitignore` + `package.json` + build esbuild → `dist/` ;
2. `project` central : `canvasShape`, `widthCm`, `heightCm`, `depthCm`, `geometry`,
   `sculpt`, `material`, `lighting`, `camera`, `ui`, `baseDesignSnapshot`,
   `history` ;
3. **heightmap canonique** ancrée en cm, seule source de vérité, consommée par le
   rendu 2D actuel — c'est la pièce manquante identifiée au §3 ci-dessus ;
4. écran de création (rectangle / carré / rond + dimensions, clavier numérique,
   validation stricte des bornes) ;
5. suppression des neuf sites 1.6, sans toucher aux deux faux positifs ;
6. persistance IndexedDB + migration des deux clés localStorage existantes ;
7. non-régression : le rendu actuel doit rester identique à réglages identiques.

Le nouveau moteur procédural (amendement A) reste au lot 2 : le lot 1 le prépare
en lui donnant un espace en cm et une heightmap à remplir.
