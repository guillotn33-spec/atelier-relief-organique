# Lot 5 — Mesh 3D et navigation

Objet : §9 (vue 3D réelle depuis la heightmap), §10 (orbite autour de l'œuvre),
et l'amendement B (Three.js bundlé localement, matériaux PBR).

---

## §9 — Le mesh

`src/render3d/mesh.js` **ne connaît pas Three.js** : il produit des tableaux
typés bruts. Deux raisons, et elles ont toutes deux servi. D'abord le mesh reste
éprouvable en Node, sans navigateur ni WebGL — c'est ce qui permet de vérifier
par la mesure, et non à l'œil, que la 3D porte le même relief que la 2D. Ensuite
les exports USDZ et OBJ du lot 6 consommeront ces mêmes tableaux, donc la même
géométrie, sans repasser par la scène.

`node tests/mesh.mjs` — **13/13**.

| exigence | mesure |
|---|---|
| même relief que la 2D | écart sommet / heightmap **1,5·10⁻⁵ cm** |
| Z dérive de `depthCm` | plage exacte −6,000 … 0,000 cm pour un panneau de 6 cm |
| X/Y aux dimensions physiques | emprise 200,00 × 120,00 cm |
| une sculpture 2D apparaît en 3D | sommet déplacé de 0,583 cm après un trait |
| rond : pas de sommets inutiles | 80 377 sommets contre 103 041 pour le carré, **rapport 0,780** (π/4 ≈ 0,785) |
| aucun sommet hors du disque | 0 |
| UV dans [0,1], sans couture | saut maximal **0,0031** entre voisins |
| densité bornée | 81 920 triangles sur un panneau de 500 × 200 cm |
| normales unitaires, orientées | 0 normale inversée |

Choix d'axe Z : le plateau le plus haut est la face avant, à z = 0 ; le point le
plus creux descend à −`depthCm`. C'est la lecture physique d'un panneau taillé
dans une dalle — on enlève de la matière, on n'en ajoute pas.

Les normales sont **analytiques**, prises sur la heightmap, et non reconstruites
depuis les faces : elles décrivent la surface réelle plutôt que la facette du
maillage sous-échantillonné.

## §10 — Navigation

Caméra orbitale visant toujours le centre géométrique de la toile. Rotation
horizontale complète, verticale bornée à ±75°. Le rendu est **à la demande** :
une boucle permanente viderait la batterie de l'iPad pour afficher une image
fixe.

Vérifié dans le navigateur, en lisant l'état de caméra réellement persisté :

| geste | résultat |
|---|---|
| glisser (un pointeur) | azimut **0 → 1,841**, élévation **0 → 0,590** |
| pinch | distance **314,9 → 173,2 cm** |
| bouton « Vue face » | retour exact à `dist 314,9  az 0,000  el 0,000` |
| élévation | bornée à 1,309 rad = 75°, conforme |

La caméra ne touche jamais à la géométrie : orbite, distance et cadrage vivent
dans `Viewer3D`, le relief vit dans la heightmap.

## Ce qui n'est PAS livré : la double tape de recentrage

§10 demande aussi « double tap sur l'extérieur = recentrer la caméra ». **Ce
n'est pas implémenté**, et le code correspondant a été retiré plutôt que laissé
en place.

Trois montages successifs ont été essayés — détection à la fin du rôle « orbite »,
puis sur le `pointerup` de la fenêtre, puis sur le `pointerdown` de la scène — et
aucun ne s'est déclenché avec des évènements synthétiques, sans erreur ni trace.
La mise au point a tout de même produit un résultat utile : `event.timeStamp` est
**fortement quantifié** par Chrome sur les évènements synthétiques (155 ms réels
rapportés comme 2000 ms), ce qui condamnait la première version ; le passage à
`performance.now()` est conservé partout où le temps compte. Mais la cause du
dernier échec reste inconnue, et je n'ai pas de tactile réel pour trancher entre
un défaut de mon code et une limite de la simulation.

Le recentrage lui-même est assuré par le bouton « Vue face », qui est l'exigence
explicite de §10 et qui est vérifié.

## Ce que la 3D ne fait pas, par décision

**On ne sculpte pas en volume.** La sculpture reste l'affaire de la 2D ; en 3D
l'œuvre se regarde et s'exportera. Le dire est plus honnête que de proposer un
pinceau dont chaque trait tomberait à côté faute de projection inverse. En
conséquence, tout glisser à un pointeur en vue 3D tourne la caméra.

## Amendement B — Three.js

`three@0.185.1` en dépendance de production, bundlé par esbuild. Aucune
dépendance à un CDN. Le bundle passe de 50 ko à **588 ko** : c'est le prix de la
3D, payé une fois et mis en cache par le service worker au lot 7.

Correspondance PBR appliquée, celle documentée dans `shade.js` au lot 4 :

| finition | roughness | metalness |
|---|---|---|
| mat | 1,00 | 0 |
| satiné | 0,55 | 0 |
| brillant | 0,22 | 0 |
| chrome | 0,08 | 1 |

## Deux défauts trouvés et corrigés en cours de lot

1. **Le pinch était impossible en vue 3D.** La fenêtre d'arbitrage tactile de
   §22 ne couvrait que l'œuvre ; hors d'elle, le premier doigt verrouillait
   immédiatement « orbite » et le second arrivait trop tard. Un doigt posé
   n'importe où peut être le premier d'un pinch : l'attente vaut désormais
   partout. Les 32 séquences de `tests/gestures.mjs` restent vertes.
2. **La caméra n'était jamais enregistrée hors d'un geste.** Le bouton « Vue
   face » changeait la vue sans la sauver : un rechargement ramenait le cadrage
   précédent.

S'y ajoute un défaut que je me suis infligé : un remplacement de texte dupliqué
avait injecté la remise à zéro de la vue dans `endResize`, si bien que terminer
un redimensionnement faisait quitter la 3D et jetait le contexte WebGL. Corrigé.

## Une lumière rasante, pas frontale

La première version ajoutait un terme vers l'observateur « pour éclairer » : la
lumière devenait frontale et la vue plate. Un relief de 6 cm sur un panneau de
200 cm est géométriquement ténu — seule une lumière réellement rasante le
révèle, exactement comme sur les photographies de référence. Le terme a été
supprimé.

## Suites

Mesh 13/13 · Gestes 32/32 · Animation 4/4 · Moteur 15/15 · Architecture 12/12.

Le test E de l'architecture a d'ailleurs attrapé un `1.6` nu dans `viewer.js` —
une intensité de lumière, pas un rapport d'image. Il est désormais nommé
`KEY_LIGHT_BASE`, conformément à la règle posée au lot 1.

## Fichiers

Créés : `src/render3d/mesh.js`, `src/render3d/viewer.js`, `tests/mesh.mjs`,
`LOT5.md`.

Modifiés : `src/ui/atelier.js` (vue 3D, routage des gestes vers la caméra),
`src/ui/gestures.js` (arbitrage tactile étendu hors de l'œuvre), `index.html`,
`src/styles.css`, `package.json` (three en dépendance).
