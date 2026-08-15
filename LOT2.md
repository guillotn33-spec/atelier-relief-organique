# Lot 2 — Moteur procédural, variation, base, négatif

Objet : refonte complète de la génération (amendement A), plus §4 (variation /
base / retour base) et §5 (négatif). Les deux exigences ajoutées à la commande —
calibration visuelle contre les références, et test d'agrandissement du champ —
sont traitées en §Calibration et §Mesures.

---

## Le moteur

`src/geometry/field.js`, moteur `organic-v2`. Chaîne :

1. **repère de composition** — décalage en cm, rotation, étirement **à aire
   constante** (un axe ×√s, l'autre ÷√s) ;
2. **domain warp** à deux niveaux — c'est lui qui fait serpenter les chenaux ;
3. **houle porteuse** basse fréquence, prise en compte **avant** le creusement :
   elle décale le seuil, donc l'endroit où ça creuse, et porte le plateau ;
4. **creusement** par rampe monotone à épaulement doux, jamais saturée ;
5. **fusion** des bassins et des chenaux par smooth minimum.

Deux propriétés ne sont pas des réglages heureux.

**Le champ est une fonction des centimètres absolus.** Rien dans `field.js` ne
connaît les dimensions de la toile, qui n'en est qu'une fenêtre. Agrandir révèle
du motif sans déplacer ce qui est déjà là.

**La hauteur décroît strictement quand le creusement augmente.** La démonstration
tient en trois lignes et elle est écrite dans le code :
`h = houle × extinction(carve) − profondeur × carve`, avec
|houle| ≤ 0,16 × profondeur et |extinction′| ≤ 1,5 / 0,30 = 5, donc
`dh/dcarve ≤ (0,16 × 5 − 1) × profondeur = −0,20 × profondeur < 0`.

Le remplacement du bruit de valeur par une rampe monotone supprime la cause du
défaut v1 : le creusement ne sature plus jamais, il n'y a donc plus de fond plat
sur lequel poser une ondulation indépendante.

---

## Mesures

`node tests/engine.mjs` — 13/13. `node tests/nonregression.mjs` (architecture du
lot 1) — 12/12, le moteur v1 restant dans le code comme oracle.

**Îlots et anneaux.** Le détecteur est d'abord étalonné sur un relief fabriqué
contenant volontairement un anneau à bosse centrale : il sonne à 5,9 % de
proéminence. Sur les trois préréglages : **zéro îlot enclavé**. Sur 48 variations
tirées des préréglages : 8 îlots, proéminence maximale **2,77 %** de l'amplitude.

**Agrandissement (exigence ajoutée).** Toile 160 × 100 puis 260 × 170 cm, même
géométrie :

| | |
|---|---|
| écart maximal sur la zone commune | **0,187 %** de l'amplitude |
| écart moyen sur la zone commune | 0,027 % |
| motif dans la bande révélée / au centre | rapport **1,10** |

Le motif existant ne bouge pas, et la bande révélée porte autant de relief que le
centre. C'est l'équivalent procédural du test B4 du lot 1.

**Négatif.** Désactiver restitue le relief **bit à bit** ; activer donne le
miroir **exact** autour du plan neutre. Vérifié aussi à l'écran : corrélation
−0,798 entre les deux rendus sur 24 points, retour pixel-identique.

**Base.** Après une variation et une sculpture supplémentaire, `Retour base`
restitue géométrie **et** sculpture bit à bit — vérifié en Node et à l'écran.

**Déterminisme.** Même graine, relief identique. Même géométrie de départ, même
variation. Une variation modifie 15 paramètres sans toucher ni à la graine ni à
la douceur.

---

## Trois bornes qui ne sont pas des goûts

Chacune vient d'une mesure, pas d'une préférence.

1. **`channelRatio ≥ 0,55`.** Des chenaux beaucoup plus fins que les bassins ne
   les relient pas : ils ondulent dedans et y laissent des bosses enclavées.
   Proéminence maximale d'îlot sur 48 variations selon le plancher :
   0,20 → 15,6 % ; 0,45 → 7,2 % ; **0,55 → 2,8 %**.
2. **`density ∈ [0,18 ; 0,72]`.** Au-delà de 0,72, presque toute la surface est
   creusée : le relief s'aplatit faute de plateaux et les minima du bruit
   ressortent en îlots.
3. **Variations par réflexion aux bornes, pas par écrêtage.** Une suite de
   variations est une marche aléatoire ; écrêter rend les bornes collantes et,
   après une dizaine de tirages, l'allongement et l'irrégularité restaient
   bloqués à 1,00 et 0,00 — le dessin dégénérait au lieu de dériver.

## Une limite que je ne peux pas lever

Un îlot enclavé est un minimum local du bruit tombant **dans sa propre zone
creusée**. C'est une propriété de tout champ aléatoire lisse creusé par seuil,
pas un défaut de réglage. L'éliminer exigerait de creuser depuis la distance au
bord — une transformée de distance, donc une opération **globale** sur la grille,
qui dépendrait de la fenêtre et détruirait la continuité en centimètres du champ.

Entre les deux, la continuité en cm compte davantage : c'est une exigence
explicite, l'îlot résiduel est mesuré à 2,77 % de l'amplitude au pire, sous le
seuil de visibilité. Zéro îlot sur les trois préréglages.

---

## Calibration visuelle

Rendus comparés aux trois références sur un panneau de 200 × 120 cm.

**Ce qui est atteint** : formes continues qui fusionnent en chenaux traversants,
plus aucune ellipse isolée, épaulements doux, plateaux clairs et larges, poches
distinctes réparties sur le panneau, aucun anneau visible. Les trois préréglages
sont nettement différenciés — Dunes coule en diagonale, Cellules se resserre en
poches rondes, Archipel disperse des îles reliées par des chenaux — et tous les
trois exploitent la fusion, que le moteur v1 ne savait pas produire.

**Ce qui ne l'est pas** : la profondeur tonale. Les références descendent presque
au noir au fond des cavités ; le rendu reste dans les gris moyens. Vérifié en
poussant le contraste au maximum avec une lumière rasante à 20° — l'ombrage
actuel ne descend pas plus bas. C'est exactement l'objet du **lot 4** (§7 :
« le rendu actuel ne descend pas assez profondément dans les noirs », exposition,
intensité des ombres et occlusion des cavités en contrôles séparés). Je n'ai pas
déformé la géométrie pour compenser un défaut d'ombrage.

Un défaut de composition trouvé pendant cette calibration : la houle porteuse
avait une longueur d'onde de 5,5 fois la taille des cavités, soit 242 cm sur un
panneau de 200 — plus longue que l'œuvre. Elle ne modulait donc rien, elle
coupait le panneau en deux, une moitié creusée et une moitié en plateau nu.
Ramenée à 2,8 fois, elle groupe les cavités en familles. Les trois préréglages y
ont gagné.

---

## Deux réglages de la version 1 ont disparu

« Nombre de cavités » et « Taille des formes » sont remplacés par **« Taille des
cavités », en centimètres**. Ce n'est pas une simplification : un champ continu
ancré en centimètres n'a pas de nombre de cavités — ce nombre dépend de la
fenêtre par laquelle on le regarde, donc du cadrage, pas de l'œuvre. Les
nouveaux réglages exposés sont Taille des cavités, Densité, Chenaux, Allongement,
Orientation, Mouvement du dessin, Irrégularité, Profondeur, Épaulement des bords,
Douceur des arêtes, Ondulation.

L'**irrégularité** ne modifie plus la profondeur mais le **seuil**, c'est-à-dire
la découpe du bord. Deux raisons : mesurée, l'irrégularité appliquée à la
profondeur faisait passer les îlots de 115 à 171 sur 48 variations ; et les
références montrent précisément des contours très découpés sur des intérieurs de
cavité lisses.

La **douceur des arêtes** est devenue une longueur physique en centimètres. Une
fraction de la largeur de la toile aurait signifié qu'élargir le panneau adoucit
le relief déjà en place — « agrandir ne déplace rien » aurait été faux.

---

## Conservation (§23) — vérifié à l'écran sur le nouveau moteur

| Fonction | Vérification | État |
|---|---|---|
| presets Dunes / Cellules / Archipel | recalibrés, distincts, exploitent la fusion | OK |
| creuser | trait synthétique, Δ = 16 niveaux | OK |
| bomber | Δ = 38 après variation | OK |
| onduler / lisser / gomme | inchangés, calque indépendant du moteur | OK |
| pression du stylet, événements coalescés | inchangés | OK |
| undo / redo | inchangés | OK |
| persistance | rechargement : réglages, préréglage, instantané de base | OK |
| lumière, matière, découpe, cadre, mur | inchangés | OK |
| export image | inchangé | OK |
| animation | rebasculée sans erreur ; **mouvement non vérifié** | à revoir |

L'ondulation animée est réimplémentée : le domaine de la **houle porteuse**
défile et le champ est rééchantillonné sur une grille plus grossière. La
structure des creux ne bouge pas, c'est la houle qui traverse la pièce. La v1
gardait une carte statique et ajoutait une sinusoïde par-dessus — le mécanisme
même de l'îlot.

## Limites restantes

1. **Profondeur tonale** : lot 4, mesuré ci-dessus.
2. **Animation** : toujours pas vue tourner (rAF suspendu en onglet inactif).
   Elle coûte désormais une reconstruction de heightmap par image, sur grille
   réduite avec qualité adaptative. À éprouver à l'œil et sur iPad.
3. **Îlots résiduels** : 2,77 % de proéminence au pire sur l'espace des
   variations, zéro sur les préréglages. Non levable sans sacrifier la
   continuité en cm.
4. **Coût de génération** : le champ demande une quinzaine d'évaluations de bruit
   par cellule. §21 (worker, préview adaptative) reste au programme.

## Fichiers

Créés : `src/geometry/noise.js`, `src/geometry/field.js`,
`src/geometry/variation.js`, `tests/engine.mjs`, `tests/calibrate.mjs`, `LOT2.md`.

Modifiés : `src/geometry/heightmap.js` (choix de moteur, flou en cm, grille de
qualité réduite), `src/core/project.js` (paramètres, bornes, préréglages,
instantané de base), `src/sculpt/layer.js` (`serialize` copie, `adopt`),
`src/ui/atelier.js` (contrôles, variation/base/négatif, animation), `index.html`,
`src/styles.css`, `src/main.js` (conversion des projets du lot 1),
`tests/nonregression.mjs` (épingle le moteur v1).

Inchangé : `src/geometry/legacyField.js`, conservé comme oracle de non-régression
de l'architecture. Plus aucun projet ne s'ouvre dessus.
