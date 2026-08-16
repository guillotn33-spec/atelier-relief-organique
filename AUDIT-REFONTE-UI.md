# Audit de la refonte d'interface

Contrôle indépendant des changements livrés par Codex (fichiers touchés le
16 août à 14:14–14:27 : `index.html`, `src/styles.css`, `src/ui/atelier.js`,
`src/ui/exportPanel.js`, `src/ui/proWorkspace.js` — nouveau — et
`AUDIT-FINAL.md`).

**Verdict : le travail est bon et le moteur est intact.** Le rétrécissement du
périmètre est propre — pas de commande menteuse, pas de dépendance oubliée. Un
défaut visible par l'utilisateur, une accessibilité incomplète, et une suite de
tests qui ne prouve plus ce qu'elle semble prouver.

---

## Les affirmations d'`AUDIT-FINAL.md`, vérifiées une à une

| affirmation | verdict | mesure |
|---|---|---|
| `npm run build` réussit | **exact** | `app.js` 85,8 ko, `app.css` 32,9 ko |
| Bundle réduit d'environ 86 % | **exact** | 629,4 ko → 85,8 ko, soit −86,4 % |
| `npm test` 150/150 sur 10 suites | **exact, mais trompeur** | voir « ce que les tests ne prouvent plus » |
| Moteur 3D et animation retirés du bundle | **exact** | zéro occurrence de `three` dans `dist/app.js` |
| Export limité au PNG | **exact** | le sélecteur de format est masqué et ne propose que PNG |
| Aperçu et export partagent la heightmap | **exact** | `renderForExport` part du même `hm` |
| `npm audit` sans vulnérabilité | **exact** | 0 vulnérabilité |
| Interactions détruites au changement de projet | **partiellement faux** | `ProWorkspace` oui ; l'atelier non — défaut n° 1 |
| « Œuvre centrale entièrement dégagée » | **exact** | plus aucun élément flottant ne recouvre l'œuvre ; la poignée de la barre est masquée |
| Quatre molettes reliées aux vrais paramètres | **exact** | glisser, roulette et clavier modifient le relief |
| Variations mémorisées, restaurables, persistées | **exact** | restauration vérifiée : 15 champs de géométrie identiques à l'instantané |

Deux vérifications que je n'ai pas pu faire : le contrôle tactile réel sur iPad,
et le rendu sur un écran haut. Codex les signale lui-même comme résiduelles.

## Défauts trouvés

### 1. Un clic sur « Exporter » produit DEUX fichiers — grave

Mesuré, reproductible :

| situation | fichiers produits par un clic |
|---|---|
| page fraîchement chargée | **1** |
| après avoir ouvert un second projet dans la même page | **2** |

Et le fichier surnuméraire est **faux** : `rectangle-160-100-cm-2048x1283.png`
au rapport de l'ANCIEN projet, à côté du bon `…2048x1280.png`.

**Cause.** L'atelier attache ses écouteurs à des éléments du DOM qui SURVIVENT au
changement de projet — `#exportRun`, les outils, les préréglages, les curseurs,
`#undoBtn`. `Atelier.destroy()` ne les retire pas. Chaque projet ouvert ajoute
donc un jeu complet d'écouteurs, chacun refermé sur l'ANCIEN projet.

**Ce défaut est antérieur à la refonte** — il date du moment où l'application a
su ouvrir un second projet. Il m'appartient : au lot 8 j'ai retiré les écouteurs
posés sur `window` et détruit les barres, et j'ai écrit « 30 posés, 30 retirés ».
C'était vrai de `window`, et seulement de `window`. Les écouteurs posés sur les
éléments du document n'ont jamais été couverts. La refonte n'en est pas la cause,
elle l'a rendu visible.

**Correction.** Le même traitement que pour `ProWorkspace` : un `AbortController`
par atelier, `{ signal }` sur chaque `addEventListener`, `abort()` dans
`destroy()`. C'est une dizaine de lignes et cela couvre tous les cas d'un coup.

### 2. Les molettes ne s'annoncent pas — accessibilité

`proWorkspace.js` écrit `aria-valuemin`, `aria-valuemax`, `aria-valuenow` et
`aria-valuetext` sur un `<button>`. Ces attributs n'ont d'effet que sur
`role="slider"` : mesuré, `role` vaut `null` alors que `aria-valuenow` vaut
`"53"`. Un lecteur d'écran annonce donc « Cavités, bouton », jamais la valeur.

Le clavier fonctionne pourtant déjà (flèches, Page Up/Down, Home, End) : il ne
manque que `role="slider"` sur les quatre boutons pour que le travail
d'accessibilité déjà fait devienne audible.

### 3. Ce que les tests ne prouvent plus

`npm test` affiche 150/150. Ventilé :

| suite | vérifications | porte sur du code… |
|---|---|---|
| mesh | 14 | **plus livré** (maillage 3D) |
| export | 23 | **19 sur 23 plus livrées** (USDZ, OBJ, matériau) |
| animation | 4 | **plus livrée** (boucle de houle) |
| les sept autres | 109 | livré (moteur, ombrage, gestes, brosse, dimensions) |

**Environ 37 vérifications sur 150 — un quart — gardent des fonctions retirées
du produit.** Elles restent vertes parce que le code source existe encore, sans
être chargé par l'application.

Et surtout : **aucune vérification ne couvre la nouvelle interface**. Les
molettes, la bande de variations, la navigation par calque, le panneau inférieur
et le tiroir responsive n'ont aucun filet. Le défaut n° 1 en est la
démonstration : il traverse `npm test` sans être vu.

### 4. L'oracle du lot 8 doit être réétalonné

`src/empreinte.js` se charge encore et **tous ses sélecteurs résolvent** — bonne
surprise, la refonte a conservé les identifiants. Mais :

- la référence enregistrée est caduque : la zone de l'œuvre est passée de
  805 × 503 à 570 × 356, donc tous les hachages de pixels diffèrent ;
- deux de ses vingt-huit étapes (`vue-3d`, `retour-2d`) ne testent plus rien,
  `#view3d` étant masqué.

Il faut réenregistrer une référence et retirer ces deux étapes. Tant que ce n'est
pas fait, le lot 8 n'a plus de filet.

## Code devenu orphelin

| fichier | lignes | état |
|---|---|---|
| `src/render3d/viewer.js` | 208 | **importé par personne** |
| `src/ui/animation.js` | 105 | **importé par personne** |
| `src/render3d/mesh.js` | 174 | plus que par les tests et `model.js` |
| `src/export/model.js` | 125 | plus que par les tests |
| `src/geometry/animator.js` | 149 | plus que par `animation.js` (orphelin) et les tests |

Environ **760 lignes** de source ne servent plus l'application. `three` a été
correctement déplacé de `dependencies` vers `devDependencies` — c'est le bon
geste, la bibliothèque ne sert plus qu'aux tests.

Restent aussi des éléments masqués gardés en vie pour que le câblage ne casse
pas : `#animate`, `#view3d`, `#viewer3d`, `#exportFormat`. C'est défendable, mais
`atelier.js` conserve en conséquence des branches mortes — `refresh3d() {}`,
`render3d() {}`, `persistCamera() {}`, la gestion du pincement et de l'orbite en
vue 3D, et un `this.anim` factice dont l'interrupteur écrit toujours
`project.ui.animate` dans le projet enregistré.

## Ce que le rétrécissement de périmètre coûte

Décidé par toi, donc pas un défaut — mais il faut l'écrire quelque part :

- **§9 et §10** (vue en volume, orbite) : plus implémentées.
- **§18** (export USDZ et OBJ pour Procreate) : plus implémenté. C'était le seul
  chemin vers l'impression et la peinture dans Procreate.
- **§23** (ondulation animée) : plus implémentée.

Le seul document décrivant le périmètre courant est `AUDIT-FINAL.md`. Les
rapports de lot 5, 6 et 7 continuent de décrire ces fonctions comme livrées —
ce qui est correct, un rapport de lot rapporte sa date et ne se réécrit pas.

## Observations, sans gravité

- **L'œuvre est petite sur une fenêtre courte.** Mesuré sur 1536 × 709 :
  456 × 285 px pour une zone de scène de 1002 px de large. Ce sont le panneau
  inférieur et les deux barres qui contraignent la hauteur. Sur un écran haut le
  rapport s'améliore ; à vérifier sur l'iPad visé.
- **CSS propre** : 4 classes inutilisées sur 156 définies.
- Sous 700 px, `.variation-top` est masqué et la bibliothèque disparaît ; la
  création de variation reste accessible par `#variationMobile` dans le tiroir.
  Sans conséquence pour un iPad, dont la largeur reste au-dessus.

## Ce que je recommande, par ordre

1. **Écouteurs de l'atelier** : `AbortController` + `{ signal }` + `abort()` dans
   `destroy()`. Corrige le double export et tout ce qui dort derrière.
2. **`role="slider"`** sur les quatre molettes.
3. **Réétalonner `empreinte.js`** et retirer ses deux étapes 3D — sans quoi plus
   rien ne garde l'interface.
4. **Décider du sort du code 3D** : soit il part du dépôt avec ses suites, soit
   il reste et un mot dans le rapport dit qu'il est conservé sans être livré.
   Aujourd'hui `npm test` laisse croire qu'il est actif.
5. Écrire quelque part, hors `AUDIT-FINAL.md`, que §9, §10, §18 et §23 sont
   retirés du périmètre — pour que le prochain lecteur de `LOT5.md` ne cherche
   pas la vue 3D.

---

# Corrections appliquées

Les trois points ont été corrigés et **vérifiés dans le navigateur, en un seul
passage du harnais**.

## 1. Le double export — corrigé

`Atelier` possède désormais un `AbortController` unique. Ses **26 liaisons**
passent par une seule méthode, `ecouter(cible, type, handler, options)`, qui
ajoute le signal ; `destroy()` appelle `abort()`. Le registre manuel des
écouteurs de `window` disparaît, devenu inutile. `ExportPanel` reçoit le même
signal — ses six écouteurs vivent et meurent avec l'atelier qui l'a construit.

Mesuré par l'étape `un-seul-fichier-par-export`, désormais dans le harnais :

| situation | avant | après |
|---|---|---|
| page fraîchement chargée | 1 fichier | **1 fichier** |
| après un second projet dans la même page | **2 fichiers** | **1 fichier** |

## 2. Les molettes s'annoncent — corrigé

`role="slider"` et `aria-orientation="vertical"` sur les quatre boutons. Les
`aria-value*` que `proWorkspace.js` écrivait déjà deviennent effectifs :
l'empreinte relève `molette:role = "slider"` et `molette:valeur = "35"` après
cinq flèches haut.

## 3. Les tests disent ce qu'ils couvrent — corrigé

`npm test` ne rend plus un total unique :

```
  produit livré : 109/109
  code conservé :  41/41
  total         : 150/150

  ⚠ Aucune de ces suites ne couvre l'interface : elle est éprouvée
    par `src/empreinte.js`, dans un navigateur.
```

Et le harnais couvre maintenant l'interface. Les deux étapes 3D, devenues
muettes, sont retirées ; cinq étapes les remplacent : molette au clavier,
molette à la roulette, variation enregistrée, variation restaurée, et le
comptage des fichiers d'export. **31 étapes, aucune erreur, toutes stabilisées**,
et **0 écart entre deux passages sur des chargements distincts** — la référence
est reproductible.

## Trouvé en corrigeant

**En mode `--serve`, modifier `index.html` n'avait aucun effet.** La surveillance
d'esbuild ne suit que le graphe des modules ; les actifs statiques n'étaient
copiés qu'au démarrage. C'est ce qui a fait passer la correction n° 2 pour
inopérante : le balisage servi restait celui du lancement. `build.mjs` surveille
désormais ces fichiers et les recopie — `[watch] copié : index.html`.

## Précision sur une observation de l'audit

Deux pastilles restent posées sur le coin bas-droit de l'œuvre : ce sont
`#ratioLock` et `#resizeHandle`, les prises de redimensionnement de §3, placées
là volontairement. Ce ne sont pas des restes de barre flottante, et la
description de Codex reste exacte.

# Suppression du code 3D orphelin

Décision prise : le code retiré du produit part du dépôt.

## Supprimé

| fichier | lignes |
|---|---|
| `src/render3d/viewer.js` | 208 |
| `src/render3d/mesh.js` | 174 |
| `src/export/model.js` | 125 |
| `src/geometry/animator.js` | 149 |
| `src/ui/animation.js` | 105 |
| `tests/mesh.mjs` | 14 vérifications |
| `tests/animation.mjs` | 4 vérifications |
| `tests/export.mjs` | 19 vérifications sur 23 |

Plus, dans le code restant : les quatre méthodes fantômes d'`atelier.js`
(`refresh3d`, `render3d`, `persistCamera`, l'objet `anim` factice), les branches
3D des gestionnaires de pincement et de déplacement, l'interrupteur d'animation,
et les quatre éléments masqués du balisage (`#view3d`, `#viewer3d`, `#animate`,
`#exportFormat`). `three` quitte les dépendances de développement — plus rien ne
l'importe.

## Conservé, et pourquoi

Les **quatre vérifications de définition d'image** de l'ancienne suite `export`
portaient sur `outputSizeFor`, dont l'export PNG dépend. Elles vivent désormais
dans `tests/image.mjs`.

`tests/heightmap.mjs` prouvait qu'une borne périmée déforme le résultat en
mesurant le maillage exporté — 6,982 cm pour 6 cm déclarés. Le maillage
n'existant plus, la conséquence est ré-ancrée sur ce qui reste : `shadeParams`
reçoit `hm.max − hm.min` comme amplitude d'occlusion. Mesuré, des bornes
périmées **éclaircissent les fonds de cavité de 8,9 %**. L'invariant est le
même, la démonstration porte sur du code livré.

## Vérification

Le harnais tourne sur le code purgé, **31 étapes, aucune erreur, toutes
stabilisées**. Comparé au relevé d'avant la suppression, hors pixels — la
fenêtre ayant changé de hauteur entre les deux, la comparaison de pixels était
refusée par le garde-fou du harnais :

| famille d'écart | nombre | cause |
|---|---|---|
| `exportFormat`, `animate` devenus absents | 62 | les deux commandes supprimées |
| dimensions, à partir de l'étape `redimensionner` | 36 | le glisser se fait en pixels d'écran, dont l'échelle dépend de la hauteur de fenêtre |
| **tout le reste** | **0** | — |

Puis, sur le code final, **deux passages complets consécutifs : 0 écart**.

## Un dernier défaut, trouvé par le harnais

Entre les deux passages, l'empreinte a signalé `undoBtn:inactif` divergent sur
les premières étapes. Les boutons d'historique appartiennent au DOCUMENT et
survivent au changement de projet : `SculptHistory` ne les remettait pas à plat
à sa construction. Ouvrir un second projet après avoir sculpté dans le premier
laissait donc « Annuler » actif sur une pile vide. Une ligne, corrigée.

## Comptes

| | avant | après |
|---|---|---|
| suites | 10 | **8** |
| vérifications | 150, dont 41 sur du code non livré | **113, toutes sur du code livré** |
| `app.js` | 85,8 ko | **84,5 ko** |
| dépendances de développement | esbuild, three | **esbuild** |

## Reste ouvert

Consigner quelque part que §9, §10, §18 et §23 sortent du périmètre — les
rapports des lots 5, 6 et 7 continuent de les décrire comme livrés, ce qui est
correct pour un rapport daté, mais aucun document courant ne le dit hors
`AUDIT-FINAL.md`.

---

⚠ **Rien n'est en ligne.** Aucune commande git n'a été passée. Les changements de
Codex comme cet audit n'existent que sur le disque tant que
`git add / commit / push` n'a pas été fait, et le déploiement Vercel n'est
effectif qu'une fois le build confirmé.
