# Lot 1 — Modèle de projet, formes libres, heightmap canonique

Objet du lot (§24) : « nouveau modèle de projet + dimensions/formes + compatibilité
avec rendu actuel », plus les amendements C (dépôt git, multi-fichiers, build) et
E (IndexedDB). Le nouveau moteur procédural (amendement A) reste au lot 2.

---

## Ce qui a été fait

**Dépôt et build.** Dépôt git initialisé sur place, premier commit `f446b84`
figeant l'état v1 avant toute modification. Build esbuild vers `dist/`,
`npm run dev` sert l'application sur `:4321`. Aucune dépendance à l'exécution,
aucun CDN. Le HTML v1 est déplacé sous `legacy/` et n'est plus chargé.

**Modèle de projet** (`src/core/project.js`). Toutes les clés exigées par §1,
plus `presentation`. Les pourcentages sont stockés normalisés 0..1, les angles en
degrés ; l'interface convertit à l'affichage. Les préréglages sont désormais
découpés en `geometry` / `material` / `lighting` / `presentation` : la séparation
que §4 exige est structurelle, pas déclarative.

**Heightmap canonique** (`src/geometry/heightmap.js`). La pièce qui manquait. Une
grille à cellules CARRÉES en centimètres, centrée sur la toile, indépendante de
toute résolution d'affichage. Le rendu 2D ne calcule plus de champ : il
rééchantillonne cette grille (Catmull-Rom séparable) puis l'ombre. C'est l'objet
que consommeront le mesh 3D (§9), le négatif (§5), l'instantané de base (§4) et
les exports (§18) — pour que tous montrent le même relief et non quatre
évaluations qui se ressemblent.

**Calque de sculpture ancré en cm** (`src/sculpt/layer.js`, `brush.js`). La grille
déborde la toile, sa taille de cellule est figée à la création et n'est jamais
rééchantillonnée. Réduire la toile ne détruit rien, ré-agrandir fait réapparaître
le relief à sa place exacte (amendement D). La brosse est elliptique et orientable
dès maintenant dans le moteur ; l'interface des paramètres arrive au lot 3.

**Écran de création** (§2) avec validation stricte et clavier numérique iPad.
Carré et rond verrouillent le ratio 1:1 par définition, pas par réglage. Le rond
est une vraie découpe géométrique : hors du disque, les pixels ont un alpha nul.

**Persistance IndexedDB** (amendement E) : trois magasins, tableaux typés stockés
nativement, plus aucun base64. Reprise des deux clés localStorage de la v1 au
premier lancement.

**Les neuf sites en 1.6 sont supprimés.** Un seul littéral `1.6` subsiste dans
`src/`, sous forme de constante nommée `DOSE_GAIN` — c'est le gain de dose du
creusement, identifié comme faux positif au lot 0. Le test E interdit toute
réapparition d'un `1.6` anonyme.

---

## Mesures

Toutes obtenues en exécutant le code, pas en le lisant.

**Non-régression du relief** (`node tests/nonregression.mjs`). L'oracle extrait et
exécute les fonctions pures de `legacy/atelier-relief-organique.html` : ce n'est
pas une réécriture à la main.

| | écart moyen | écart maximal |
|---|---|---|
| champ nu, v1 contre lot 1 | **0,004 %** de l'amplitude | 0,076 % |
| champ + sculpture | **0,009 %** | 0,167 % |

La bascule d'architecture ne change pas l'image.

**Coût d'interaction**, mesuré dans Chrome sur un canvas de 818 px :

| action | coût moyen |
|---|---|
| changement de lumière (réombrage seul) | 75 ms |
| changement de géométrie (heightmap reconstruite) | 687 ms |

La v1 réévaluait tout le champ dans les deux cas. Le rapport ×9,2 est l'effet
direct de la séparation géométrie / ombrage.

**Autres vérifications** : correspondance u/v ↔ cm exacte à 5,7·10⁻¹⁴ cellule sur
l'axe horizontal ; agrandissement de la grille de sculpture bit à bit ; grille
canonique couvrant toujours la toile sur six formats de 1×1 à 500×200 cm.

---

## Défauts trouvés et corrigés pendant le lot

Cinq, tous découverts en exécutant, aucun en relisant.

1. **Décalage d'une demi-cellule à l'agrandissement.** Les deux grilles étant
   centrées, le décalage vaut (nouveau − ancien)/2 ; sur une différence impaire il
   devenait un demi-pas et déplaçait silencieusement toute la sculpture. La
   croissance est désormais forcée paire. Test B4 le verrouille.
2. **`hidden` battu par `display: grid`.** La liste de projets vide s'affichait et
   le champ Hauteur restait visible sur un carré. Réglé par une règle
   `[hidden] { display: none !important }`.
3. **Derniers coups de brosse perdus.** `endStroke` jetait le rectangle sali en
   attente : si le trait finissait avant l'image différée, les stamps restaient
   dans le calque mais jamais dans la heightmap. La zone en attente est maintenant
   soldée avant le réombrage.
4. **`getCoalescedEvents()` peut renvoyer une liste vide**, et le trait était alors
   ignoré sans le moindre signe. Repli sur l'événement lui-même.
5. **Onglet en arrière-plan.** `requestAnimationFrame` n'y est jamais appelé : un
   projet rouvert dans un onglet inactif ne se construisait pas du tout. Bascule
   sur un timer quand `document.hidden`.

---

## Inventaire de conservation (§23) — état vérifié

| Fonction | Vérifié comment | État |
|---|---|---|
| presets Dunes / Cellules / Archipel | appliqués, graines 2749 / 8315 / 5172 relues | OK |
| creuser | trait synthétique, Δ=31 niveaux sous le trait | OK |
| bomber | Δ=187 sur l'empreinte du rendu | OK |
| onduler (warp) | Δ=71 | OK |
| lisser | Δ=23 sur une entaille à la brosse de 4 cm | OK, effet faible |
| gomme | Δ=271 | OK |
| pression du stylet | `pressure` transmise jusqu'à la brosse | OK |
| événements coalescés | conservés, avec repli | OK |
| undo / redo | retour exact à 215,211,203 puis à 185,180,173 | OK |
| persistance | rechargement complet : forme, dimensions, préréglage, graine | OK |
| couleur matière / mur | `--wall` = #8a5a3a appliqué | OK |
| lumière (direction, contraste) | Δ=189 et Δ=414 | OK |
| découpe des panneaux | 3×2 appliqué, Δ=124 | OK |
| cadre | Δ=9335 | OK |
| export image | blob PNG intercepté, 2048×2048 pour une toile ronde de 130 cm | OK |
| animation | bascule sans erreur ; **mouvement non vérifié** | à revoir |

---

## Limites restantes, assumées

1. **L'animation n'a pas été vue tourner.** `requestAnimationFrame` est suspendu
   dans un onglet en arrière-plan et `animFrame` sort sur `document.hidden` : le
   mouvement est invérifiable dans les conditions de test. Le basculement ne lève
   aucune erreur et l'état d'animation se construit. À confirmer à l'œil.
2. **Le lissage a un effet faible**, comme en v1 : le flou de la heightmap domine
   le geste. Ce n'est pas une régression, c'est un héritage. À revoir au lot 3.
3. **Agrandir la toile n'ajoute pas encore de motif.** Le calque de sculpture est
   bien ancré en cm — c'est mesuré — mais le générateur v1 place ses formes en u/v
   normalisé : élargir les répartit au lieu d'en révéler d'autres. Il n'y a pas de
   correctif partiel possible ; c'est le moteur du lot 2 qui règle ça, un champ
   continu étant infini par construction.
4. **687 ms pour un changement de géométrie** sur ce poste. C'est le coût de
   l'évaluation du champ v1 sur la grille canonique. Sur iPad ce sera plus lourd.
   Le moteur du lot 2 doit être plus économe, ou passer dans un worker (§21).
5. **La reprise localStorage ne peut aboutir que sur la même origine.** Si la v1 a
   été utilisée en `file://`, ses données sont invisibles depuis l'application
   servie en http. Limite du navigateur, pas du code.
6. **§13 partiellement tenu.** Tous les curseurs affichent leur valeur en
   permanence, Taille et Force compris. La petite valeur flottante près du curseur
   pendant le glissement arrive avec la refonte des curseurs (lot 3 / §12).
7. **L'interface est celle de la v1.** Bandeau, logo, accent vert, gros curseurs
   ronds : §12 est le lot 7. Les mélanger à cette bascule aurait rendu toute
   non-régression invérifiable.

---

## Fichiers

Créés : `package.json`, `build.mjs`, `.gitignore`, `.gitattributes`, `index.html`,
`LOT1.md`, `src/main.js`, `src/styles.css`, `src/core/{math,project}.js`,
`src/geometry/{legacyField,heightmap}.js`, `src/sculpt/{layer,brush}.js`,
`src/render2d/{shade,renderer}.js`, `src/persistence/{db,migrate}.js`,
`src/ui/{creation,atelier}.js`, `tests/nonregression.mjs`.

Déplacé : `atelier-relief-organique.html` → `legacy/atelier-relief-organique.html`
(inchangé, sert d'oracle de non-régression).

Inchangés : `AUDIT-LOT0.md`, `ref-1.jpg`, `ref-2.jpg`, `ref-3.jpg`.
