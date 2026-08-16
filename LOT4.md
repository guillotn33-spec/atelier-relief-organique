# Lot 4 — Ombres, exposition, matières, animation

Objet : §7 (profondeur tonale), §8 (matières), plus l'arbitrage de l'animation
laissé ouvert au lot 3.

---

## §7 — La profondeur tonale

**Ce qui la rendait impossible.** La version 1 interpolait la couleur entre la
matière et une « couleur d'ombre » valant 0,4 × matière + 15 : le pixel le plus
sombre atteignable tournait autour de 108/255. S'y ajoutaient une occlusion
plafonnée à 0,6 et un plancher de lumière à 0,14. Aucun réglage ne pouvait
descendre au noir — c'était verrouillé dans la formule, pas mal réglé.

**Ce qui la porte maintenant.** La luminance MULTIPLIE la couleur de matière et
n'a plus de plancher. L'assombrissement vient de deux termes de profondeur
réelle, jamais d'un voile global :

- **profondeur locale** — écart entre la hauteur et une surface de référence
  obtenue par un flou de grand rayon sur la heightmap. Un point enfoncé sous son
  voisinage est occulté, où qu'il se trouve sur le panneau ;
- **concavité** — laplacien, qui creuse les recoins étroits.

Occlusion exponentielle, non plafonnée : `exp(−(profondeur·1,55·ombres + concavité·1,1·occlusion))`.

**Mesure de la plage tonale** (Dunes, 200 × 120 cm, canal rouge) :

| réglages | min | max | sous 30 | au-dessus de 200 |
|---|---|---|---|---|
| par défaut | **6** | 255 | 8,8 % | 34,2 % |
| dramatique (ombres 100, occlusion 100, −1,2 EV) | 0 | 111 | 49,1 % | 0 % |
| doux (contraste 30) | 21 | 231 | 5,5 % | 11,4 % |

Les fonds approchent le noir pendant que les plateaux restent très clairs, et
cela **aux réglages par défaut**, sans toucher à l'exposition.

Contrôles séparés ajoutés : exposition (−2/+2 EV), intensité des ombres,
occlusion des cavités, contraste.

### Trois calibrations successives, chacune corrigée sur mesure

1. **Occlusion calée sur `geometry.depth`** — l'image tombait en noir et blanc
   sans demi-teintes. `geometry.depth` vaut 0,95 quand l'amplitude mesurée du
   champ dépasse 2,4 : la profondeur locale saturait partout. Corrigé en
   normalisant sur l'amplitude RÉELLE de la heightmap.
2. **Rayon d'occlusion à 0,8 × la taille des cavités** — la surface de référence
   épousait les cavités, l'écart y était constant et l'occlusion devenait un
   masque binaire à bords durs. Porté à 2,5 ×, elle donne le niveau général du
   panneau et l'écart suit la profondeur en dégradé.
3. **Ambiante à 0,09** — toute paroi tournée à l'opposé de la lumière plongeait
   au noir, où qu'elle soit. Un panneau de plâtre dans une pièce reçoit beaucoup
   de lumière rebondie : l'ambiante est franche (0,33) et c'est l'OCCLUSION qui
   la retire, pas son absence.

## §8 — Matières

Quatre finitions, mesurées sur le même relief (Dunes, 200 × 120) :

| finition | min | max | moyenne | pixels saturés |
|---|---|---|---|---|
| mat | 6 | 255 | 139 | 4,69 % |
| satiné | 6 | 255 | 143 | **8,41 %** |
| brillant | 6 | 255 | 140 | 6,45 % |
| chrome | 3 | 255 | **90** | **0,25 %** |

Satiné et brillant se distinguent par la LARGEUR du spéculaire (satiné en étale
davantage, d'où plus de pixels saturés ; brillant les concentre). Le chrome
n'est pas du contraste poussé : sa diffuse est remplacée par une réflexion
d'environnement de studio lue dans la normale — d'où une moyenne à 90 contre
139 et presque aucun pixel saturé, alors que le relief est le même.

« Mat » reste le défaut et la référence : son chemin de code n'ajoute aucun
spéculaire.

**Correspondance PBR documentée dans `shade.js`** pour que le lot 5 les fasse
coïncider :

| finition | roughness | metalness |
|---|---|---|
| mat | 1,00 | 0 |
| satiné | 0,55 | 0 |
| brillant | 0,22 | 0 |
| chrome | 0,08 | 1 |

## Animation — option (b) implémentée et mesurée

Le champ se décompose en `h = A·houle + B`, A et B statiques. Seule la houle est
réévaluée par image : deux évaluations de bruit par cellule au lieu d'une
quinzaine.

**La note du lot 3 sur le flou a été mesurée, pas supposée** :

| variante | coût / image (qualité 0,45) | écart au rendu exact |
|---|---|---|
| reconstruction complète (lot 3) | 22,7 ms | — |
| **(b) exacte** — `flou(A·houle) + flou(B)` | **4,2 ms** (×5,4) | référence |
| (b) approchée — `houle·flou(A) + flou(B)` | 2,6 ms (×8,9) | 0,030 % de l'amplitude |

**L'approximation n'est pas retenue.** Elle est bel et bien négligeable
(0,030 %), mais la variante exacte tient déjà l'objectif avec de la marge : avec
l'ombrage (17 ms), **47,2 im/s** contre 51,1. Gagner 4 im/s en introduisant une
approximation n'a pas de contrepartie. Le code de la variante approchée reste en
place, mesuré et documenté, au cas où l'iPad changerait l'arbitrage.

Vérifié aussi : à phase nulle, l'animateur reproduit la heightmap du rendu fixe
à 6·10⁻⁸ près — l'animation ne part pas d'un relief différent.

L'objectif du lot (25 im/s à qualité 0,45 sur desktop) étant tenu, la mention
« expérimental » est retirée et la qualité de départ revient à 0,45.

⚠ Sur iPad, 2 à 4 × plus lent, 47 im/s desktop donne 12 à 24 im/s. Le critère
que tu as fixé porte sur le desktop et il est tenu ; l'épreuve sur cible reste
à faire.

---

## Re-vérification des îlots — une correction à apporter au lot 2

C'est le point le plus important de ce rapport.

Le lot 2 concluait : « plancher `channelRatio` à 0,55 → proéminence maximale
2,8 % ». **Cette mesure ne valait que pour le panneau de 160 × 100 cm sur lequel
elle avait été prise.** Mesuré depuis sur trois formats, 48 variations chacun :

| panneau | îlots | maximum | médiane | au-dessus de 10 % |
|---|---|---|---|---|
| 160 × 100 | 6 | 2,26 % | 0,66 % | 0 |
| 200 × 120 | 20 | 7,52 % | 2,77 % | 0 |
| 300 × 180 | 74 | 16,72 % | 4,88 % | 5 |

**Et relever le plancher n'y change rien** — il aggrave même : à 0,62 le maximum
monte à 9,90 % sur 200 × 120. Testé aussi avec un plafond sur `channelWeight` :
sans effet notable.

Le facteur n'est pas le rapport des échelles mais le **nombre de cavités dans la
fenêtre**. Plus il y en a, plus la probabilité qu'une contienne un minimum local
du bruit est grande : c'est un effet de valeur extrême. La borne à 0,55 reste
justifiée — des chenaux trop fins ondulent visiblement dans les bols — mais pas
par l'argument que le lot 2 lui donnait.

**À l'œil, sous lumière rasante à 16° et ombres à 95 %** : sur 200 × 120 je ne
distingue aucun anneau. Sur 300 × 180 avec la pire variation, de petites bosses
enclavées sont discernables dans les chenaux sombres. Elles lisent comme de la
texture dans un relief déjà très dense, pas comme des défauts francs — mais
elles sont là, et je ne vais pas prétendre le contraire.

Je n'ai donc PAS remonté le plancher, puisque la mesure montre que ce serait
inefficace. Le commentaire de `GEOMETRY_BOUNDS` et le test `engine.mjs` sont
corrigés : le test mesure désormais **trois formats** et enregistre l'état réel
au lieu d'une garantie qui n'en était pas une.

**Piste de correction, hors périmètre** : dériver la bande de chenaux DU champ
des bassins (transformée en crête du même bruit) au lieu d'un bruit indépendant.
Deux champs corrélés ne peuvent plus produire de minima intérieurs indépendants.
C'est une modification de moteur, donc un arbitrage à part.

## Calibration visuelle contre ref-1/2/3

Planches jointes au rapport. « Avant » = planche du lot 2, mêmes préréglages,
mêmes réglages par défaut, même panneau : seul l'ombrage diffère entre les deux.

**Acquis** : plage tonale complète, fonds de cavité profonds, plateaux
lumineux, épaulements doux, matière plâtre mate sans reflet, formes continues
fusionnées.

**Pas acquis** : je ne dirais pas le rendu confondable avec les références. Les
refs ont des formes plus grandes, plus calmes, avec des dégradés plus longs ; le
rendu reste plus dense et ses ombres plus franches. C'est une différence de
composition et de douceur, pas de plage tonale — celle-ci est mesurée et tenue.

## Défaut trouvé pendant la calibration

Les préréglages ne portaient pas les nouveaux réglages de lumière : après un
passage en réglages extrêmes, `shadowStrength` et `cavityOcclusion` restaient
coincés d'un préréglage à l'autre. Les trois préréglages portent désormais leur
lumière complète.

## Suites

Animation 4/4 · Moteur 15/15 · Gestes 32/32 · Architecture 12/12.

## Fichiers

Créés : `src/geometry/animator.js`, `tests/animation.mjs`, `LOT4.md`.

Modifiés : `src/render2d/shade.js` (modèle d'ombrage et matières refaits),
`src/render2d/renderer.js` (tampon d'occlusion), `src/geometry/heightmap.js`
(surface de référence locale), `src/geometry/field.js` (`evalParts`),
`src/core/project.js` (réglages de lumière, préréglages, borne corrigée),
`src/ui/atelier.js` (nouveaux contrôles, animateur), `index.html`,
`src/bench.js`, `tests/engine.mjs` (mesure sur trois formats).
