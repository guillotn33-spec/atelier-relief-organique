# Lot 6 bis — Corrections d'audit

Six points, dans l'ordre validé. Tout ce qui suit a été **mesuré**, jamais
déduit. Quand une mesure a contredit une affirmation antérieure, c'est la
mesure qui a gagné et l'affirmation est corrigée ici.

`npm test` — **134/134 sur 9 suites** (contre 0 exécutée avant ce lot).

---

## 1. Bornes de heightmap et surface de référence

**Bornes.** `updateHeightmapRect` entretenait `sum` par différence mais laissait
`min` et `max` à leur valeur de construction. Un trait « bomber » au-dessus du
maximum initial, puis un export, donnaient un panneau **6,982 cm d'épaisseur
pour 6 cm déclarés**, face avant à **+0,982 cm** au lieu de 0. Rien ne le
montrait à l'écran. Les bornes sont désormais recalculées sur toute la grille.

Après correction, même trait, même export : `z` de **−6,000 à −0,000 cm**,
épaisseur **6,000 cm**.

Coût mesuré du recalcul, panneau 200 × 120 (grille 641 × 385, 246 785 cellules),
médiane sur 7 tirs :

| poste | coût |
|---|---|
| champ et flou de tuile | 22,8 ms |
| recalcul des bornes | **2,5 ms** |
| surface de référence | 0,6 ms |
| **patch complet** | **25,9 ms** |

*Ma première mesure annonçait 73 ms : c'était un tir à froid, sans
préchauffage. La médiane sur sept tirs est 25,9 ms, et l'ajout ne pèse que
10 % du patch. Aucune optimisation n'était nécessaire.*

**Surface de référence.** La grille décimée pouvait tomber à deux lignes sur un
format allongé, dont la seconde vide : la « surface de référence locale » n'était
plus locale et l'occlusion se calculait contre une moyenne quasi globale. Un
plancher `AO_MIN_CELLS = 6` et un plafonnement du rayon au demi-panneau
corrigent le cas.

Confrontée à une **moyenne de boîte exacte calculée par image intégrale** —
implémentation indépendante, qui n'emprunte ni la décimation ni le flou du code
éprouvé — sur neuf formats :

| format | grille | occlusion | écart |
|---|---|---|---|
| 200 × 120 | 641 × 385 | 20 × 12 | 3,6 % |
| 200 × 30 | 641 × 97 | 72 × 11 | 4,3 % |
| 500 × 12 | 1668 × 41 | 417 × 11 | 2,4 % |
| 120 × 120 | 641 × 641 | 12 × 12 | 4,1 % |
| **12 × 12** | 641 × 641 | 12 × 12 | **7,4 %** |
| 1 × 1 | 641 × 641 | 12 × 12 | 0,6 % |

Le résidu mélange la perte de décimation et l'écart de forme entre une moyenne
de boîte et un flou à trois passes ; le seuil du test est posé à 12 % sans
prétendre isoler l'une des deux.

## 2 et 3. Survie au démarrage, échecs visibles, cycle de vie

Traités ensemble : même zone de code.

| défaut | état avant | état après, **vérifié dans le navigateur** |
|---|---|---|
| `openDb` mémoïsait son rejet | un incident condamnait la session entière | la promesse échouée est oubliée, la tentative suivante repart |
| `boot()` sans rattrapage | page blanche muette | écran de création démasqué de force + message |
| enregistrement illisible relu à chaque chargement | blocage permanent | reprise abandonnée, création affichée, message |
| calque corrompu | ouverture refusée en silence | projet ouvert **sans** la sculpture, relief préservé |
| cinq `.catch(() => {})` | perte de données silencieuse | ligne d'état dédiée, persistante |
| avertissement écrit dans `#hintText` | effacé au premier changement d'outil | **survit à deux changements d'outil** (mesuré) |
| pas de vidage avant mise en veille | dernier trait perdu | `pagehide` + `visibilitychange` |
| contexte WebGL jamais libéré | plafond du navigateur atteint | `dispose()` au démontage |
| perte de contexte WebGL non gérée | vue figée sur sa dernière image | message, puis reconstruction à la restauration |
| six écouteurs `window` non retirés | deux ateliers pilotés par le même clavier | registre + retrait |
| deux `Dock` fuyants | 4 écouteurs et 2 nœuds par changement de projet | `Dock.destroy()` |

**Preuve du cycle de vie**, trois changements de projet d'affilée :
**30 écouteurs posés, 30 retirés**, et le compte de `.dock-guide` reste à 2 au
lieu de monter à 8. Vue 3D encore vivante après une dizaine de cycles.

**Preuve de la perte de contexte**, provoquée par `WEBGL_lose_context` :
contexte perdu → « Vue 3D suspendue » ; restauré → message effacé, vue
reconstruite, contexte vivant.

Une hiérarchie a été ajoutée après coup : la restauration WebGL effaçait
l'avertissement « stockage indisponible », plus grave. Un message vide retombe
maintenant sur l'avertissement persistant.

## 4. `npm test` exécutait zéro vérification

`"test": "node --test tests/"`. Le lanceur intégré de Node ne retient que les
fichiers dont le NOM suit sa convention, ou tout fichier sous un dossier `test/`
**au singulier**. Nos suites sont dans `tests/` : **aucune n'était
sélectionnée**, et la commande sortait en 0 sans rien exécuter.

*Portée exacte : les rapports de lot citent des invocations directes —
`node tests/export.mjs — 21/21` — qui ont bel et bien tourné. Aucun compte
publié ne venait de `npm test`. Ce qui manquait était le moyen de tout relancer
d'un coup.*

`tests/run-all.mjs` enchaîne les neuf suites, **lit le décompte dans leur
sortie** au lieu de se fier au code de retour, et échoue si une suite n'imprime
pas de bilan. Vérifié en cassant volontairement une vérification : sortie **1**,
suite nommée.

### Oracles faibles corrigés

| suite | avant | après | mesure |
|---|---|---|---|
| `export` C1 | `avant !== apres` sur le texte OBJ | déplacement des sommets, dans le trait **et** loin de lui | 0,49 cm dans le trait, **0,0000 cm** sur 4 644 sommets éloignés |
| `export` D7 | poids entre 10 ko et 40 Mo | octets par triangle | 74,5, stable de 74,2 à 75,9 sur une plage de densité de 1 à 12 |
| `export` E1 / `mesh` C2 | fenêtre [0,70 – 0,85] choisie autour de l'observé | **π/4**, fait géométrique | 0,7723 contre 0,7854 |
| `mesh` E1 | `<= 240000` recopié en clair | plafond **importé** du code + décimation minimale prouvée | pas 2 ; le pas 1 donnerait 491 520 > 240 000 |
| `engine` E3 | `changed.length >= 8` | écart de **relief** rapporté à l'amplitude | 15 paramètres, **18,9 %** d'écart moyen |
| `nonregression` B2 | « sous une demi-cellule » (≈ 3× la valeur réelle) | dérive **calculée** depuis ce que documente `migrate.js` | 0,1875 mesurée contre 0,1871 attendue |
| `engine` B2 | seuil 0,55 sous une étiquette promettant « autant » | seuil 0,85 | rapport mesuré 1,10 |

### Deux suites neuves

**`tests/shading.mjs` — 15/15.** §7 et §8 n'avaient jamais été éprouvés qu'à
l'œil. `shadeParams` et `shadeRegion` ne touchent pas au DOM : tout est
mesurable sans navigateur. Les vérifications portent sur les **propriétés**
exigées, jamais sur une image de référence gelée.

Le résultat le plus net — §7 demandait que la profondeur tonale vienne de la
profondeur réelle et non d'un assombrissement global :

| commande | fonds de creux | plateaux |
|---|---|---|
| ombres au maximum | **−76,2 %** | **−0,1 %** |
| exposition −1 EV | −61,7 % | −53,5 % |

Les ombres ne touchent pas les plateaux ; l'exposition agit sur tout. Ce sont
bien deux commandes distinctes, pas deux noms du même effet.

Plage tonale par défaut : p0,5 à **31,8**, médiane **165,2**, p95 à **246,6**.
Plateaux 217,3 contre fonds de creux 63,1, soit un rapport de **3,45**.

§8, les quatre finitions — comparer des médianes ne suffisait pas, mat et
brillant ont la même (217,3 contre 217,4) :

| finition | écart moyen vs mat | écart max | pixels saturés |
|---|---|---|---|
| mat | 0,00 | 0,0 | 3 455 |
| satiné | **6,14** | 31,0 | 7 905 |
| brillant | 1,99 | **84,0** | 5 972 |
| chrome | **58,75** | 132,3 | 365 |

Satiné diffuse large, brillant concentre, chrome bascule entièrement.

**La couture patch / rendu complet est saine.** `renderFull` remplit la carte
par `resampleTo` (séparable, poids précalculés), `renderPatch` par
`sampleHeight` (bicubique ponctuel) : deux implémentations indépendantes du même
interpolant. Écart mesuré **2,51 × 10⁻⁷ cm** sur 2,426 cm d'amplitude, et
l'ombrage d'une fenêtre intérieure est **identique octet pour octet** au rendu
complet sur 11 088 pixels.

**`tests/heightmap.mjs` — 10/10.** Scelle les deux défauts du point 1.

## 5. Verrou de rapport contre des bornes asymétriques

Le rectangle admet 500 cm de large pour 200 cm de haut. Le redimensionnement
plafonnait **chaque dimension séparément** — le verrou cédait en silence,
exactement quand on s'appuie dessus :

| départ | tiré vers | avant | après |
|---|---|---|---|
| 160 × 100 (1,600) | 500 cm | 500 × 200 → **2,500** | 320 × 200 → **1,600** |
| 160 × 100 (1,600) | 1 cm | 1 × 1 → **1,000** | 8 × 5 → **1,600** |
| 100 × 180 (0,556) | 400 cm | 400 × 200 → **2,000** | 111 × 200 → 0,555 |

`fitLockedSize` borne la **largeur** dans l'intervalle où la hauteur induite
reste légale, puis parcourt tous les entiers de cet intervalle pour retenir le
plus proche de la valeur visée dont l'arrondi tient la tolérance.

*Deux versions intermédiaires ont échoué et le balayage large les a prises :
une recherche montante ratait le plafond (rapport 143 → 500 × 3, 16 % d'écart),
une recherche bidirectionnelle à portée bornée ratait le plancher (rapport 2,04
→ 3 × 1, 47 %). Le parcours complet — quelques centaines d'entiers, coût sans
commune mesure avec le rendu qui suit — est optimal par construction.*

**7 452 combinaisons éprouvées, pire écart de rapport 2,00 %, aucune sortie de
bornes.** Vérifié aussi par la poignée dans le navigateur : verrouillé, le
glisser s'arrête à **320 × 200, rapport 1,600 exact** ; déverrouillé, les deux
dimensions restent indépendantes (500 × 130).

## 6. Commentaires faux

**Le plus grave, dans `model.js` et `LOT6.md`.** Ces deux textes annonçaient :
« *mesuré, 400 000 triangles donnent un USDZ de 9,3 Mo* » et « *ramenée à
200 000, l'USDZ retombe sous 5 Mo* ».

Mesuré aujourd'hui sur le panneau de 200 × 120 (grille canonique 641 × 385) :

| budget | pas | triangles réels | USDZ | OBJ |
|---|---|---|---|---|
| 200 000 | 2 | **122 880** | **9,32 Mo** | 16,47 Mo |
| 400 000 | 2 | **122 880** | **9,32 Mo** | 16,47 Mo |

`EXPORT_MAX_TRIANGLES` est un **budget**, pas un décompte. Le « 400 000 » était
le budget, et les 9,3 Mo correspondaient en réalité à 122 880 triangles. La
seconde affirmation est simplement fausse : les deux budgets rendent le **même
fichier**. Les deux textes sont corrigés avec les chiffres mesurés.

Autres purges : dédoublement du commentaire de `AO_MIN_CELLS`, annotation
trompeuse dans la sortie de `nonregression`, deux derniers `.catch(() => {})`
de `main.js` reroutés vers le canal visible, et mon propre commentaire de
`run-all.mjs` qui surestimait la portée du défaut de `npm test`.

---

## Hors liste : trouvé en vérifiant, corrigé

**L'atelier s'ouvrait sous la ligne de flottaison sur toute fenêtre de bureau.**
Constaté en mesurant, pas en lisant : scène de **2 155 px pour une fenêtre de
1 042 px**, œuvre à 884 px du haut. Au-delà de 980 px la colonne de réglages est
en ligne dans la grille, et `align-items: stretch` faisait de la hauteur de
rangée le maximum des deux colonnes — soit les ~2 200 px de réglages dépliés.

Trois planchers se succédaient une fois le premier levé : `.workspace`, puis
`.stage-shell { min-height: 720px }`, puis `.stage { min-height: 620px }`. Et
même tous levés, `.art-wrap` gardait `width: min(100%, 1080px)` avec
`aspect-ratio` : sa hauteur se déduit de sa largeur et le `max-height: 100%`
prévu pour la borner n'était pas honoré — mesuré **978 × 612 dans une scène de
510 px de haut**.

`fitArtWrap()` calcule donc la largeur utile depuis la scène **réellement
mesurée** : la plus petite des deux contraintes gagne. Vérifié à 1 536 × 695 :

| toile | taille obtenue | rapport | entièrement visible |
|---|---|---|---|
| 160 × 100 | 727 × 454 | 1,600 | oui |
| 500 × 60 | 978 × 117 | 8,334 | oui |
| 90 × 180 | 227 × 454 | 0,500 | oui |

Le parcours sous 980 px — tiroir, page qui défile — n'est pas touché.

## Ce qui reste à trancher

1. **Densité d'export.** Passer réellement sous 5 Mo demanderait un budget
   inférieur à 122 880, ce qui ferait basculer au **pas 3** et diviserait le
   détail par deux. §18 n'impose aucune taille : c'est un arbitrage, pas un
   défaut. Rien n'a été changé.
2. **§6, sculpture directionnelle.** Toujours attribuée à aucun lot. Le moteur
   accepte `elongation` et `angleDeg` ; aucune commande d'interface n'existe.
3. **`atelier.js` pèse 1 246 lignes.** Dette reconnue face à §20, non traitée
   ici.

## Ménage

Le banc instrumenté servant à simuler un refus de stockage a été servi depuis le
répertoire de travail temporaire, sur un port séparé — origine distincte, donc
base de données distincte. Il est supprimé, et le dépôt ne porte aucune trace
d'injection.

**Une donnée locale a été détruite pendant les essais :** le calque de
sculpture du projet `pmsuustud2` (« Rectangle 200 × 120 cm ») a été écrasé par
un enregistrement volontairement illisible, pour éprouver la survie au
démarrage. La ligne corrompue a été retirée ; le projet s'ouvre désormais avec
un calque vierge. Les quatre projets de la base locale sont des artefacts de mes
propres essais de lots, aucun n'a été supprimé.

## Suites

| suite | avant le lot | après |
|---|---|---|
| nonregression | 12 | 12 |
| engine | 15 | **16** |
| animation | 4 | 4 |
| gestures | 32 | 32 |
| dimensions | — | **8** |
| mesh | 13 | **14** |
| export | 21 | **23** |
| shading | — | **15** |
| heightmap | — | **10** |
| **total** | 97, lancées à la main | **134, par `npm test`** |

Bundle de production : `app.js` 624,6 ko, `app.css` 14,8 ko.

## Fichiers

Créés : `tests/run-all.mjs`, `tests/shading.mjs`, `tests/heightmap.mjs`,
`tests/dimensions.mjs`, `LOT6BIS.md`.

Modifiés : `src/geometry/heightmap.js`, `src/render3d/mesh.js`,
`src/render3d/viewer.js`,
`src/export/model.js`, `src/core/project.js`, `src/ui/atelier.js`,
`src/ui/dock.js`, `src/persistence/db.js`, `src/main.js`, `src/styles.css`,
`index.html`, `package.json`, `tests/engine.mjs`, `tests/mesh.mjs`,
`tests/export.mjs`, `tests/nonregression.mjs`, `LOT6.md`.

---

⚠ **Rien n'est en ligne.** Aucune commande git n'a été passée. Ce lot n'existe
que sur le disque tant que `git add / commit / push` n'a pas été fait, et le
déploiement Vercel n'est effectif qu'une fois le build confirmé.
