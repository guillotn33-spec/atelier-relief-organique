# Lot 7 — §6, sculpture directionnelle

§6 n'avait jamais été attribué à un lot. Le constat de départ, vérifié avant
d'écrire une ligne :

- `src/sculpt/brush.js` implémentait déjà une brosse **elliptique et
  orientable** depuis le lot 1, et son en-tête annonçait « l'interface des
  paramètres allongement/angle est branchée au lot 3 » ;
- `defaultUi()` portait `brushElongation` et `brushAngle`, tous deux à 0 ;
- `stampAt` les transmettait fidèlement à la brosse ;
- **rien, nulle part, ne les écrivait.** Aucune commande, aucun geste. La brosse
  est restée un disque pendant six lots, et la ligne du lot 3 était fausse.

`npm test` — **150/150 sur 10 suites**.

---

## Ce que §6 apporte

| commande | plage | affichage |
|---|---|---|
| Allongement | disque → 5 pour 1 | le RAPPORT, « 4,0 : 1 », pas un pourcentage |
| Orientation | 0 à 179° | degrés, ou « du geste » |
| Suit le tracé | oui / non | grise l'orientation manuelle |
| Aperçu | — | l'ellipse réelle, dessinée par la fonction du moteur |

L'allongement est aussi dans la mini-palette (§15), qui est le chemin Pencil.

**Pourquoi 0 à 179° et pas 0 à 359.** Une ellipse est identique à elle-même
après un demi-tour. Offrir 360° serait offrir deux fois le même réglage.
Vérifié : à 20° et à 200°, la matière déposée est identique au bit près.

## L'aire de la brosse ne change plus quand on l'allonge

La première écriture de l'ellipse — `a = r·s`, `b = r/√s` avec `s = 1 + 2,2·e` —
faisait **croître l'aire de 79 %** entre le disque et l'allongement maximal,
alors que le commentaire du fichier annonçait une aire « comparable ». Allonger
la brosse aurait creusé plus fort sans que rien ne le dise.

| allongement | ancien : aire | ancien : rapport | nouveau : aire | nouveau : rapport |
|---|---|---|---|---|
| 0 | 1,000 | 1,00 | 1,000 | 1,00 |
| 0,50 | 1,449 | 3,04 | **1,000** | **3,00** |
| 1,00 | **1,789** | 5,72 | **1,000** | **5,00** |

`brushAxes` conserve exactement `a × b = r²`, et le rapport vaut
`1 + e × (MAX_BRUSH_ASPECT − 1)` — donc « allongement 50 % » veut dire
« ellipse 3 pour 1 », ce que l'interface affiche telle quelle. À allongement
nul les deux formules coïncident : aucun projet existant ne change d'aspect.

Mesuré dans le calque, empreinte réelle d'un coup unique : **aire constante à
0,3 % près** sur toute la plage, rapport déposé conforme à l'annoncé à **0,5 %**.

## L'orientation reprise du geste

`src/sculpt/direction.js`, module pur, sans DOM ni brosse : il transforme une
suite de déplacements en un angle.

**Le lissage travaille sur l'ANGLE DOUBLE**, et ce n'est pas un raffinement.
Une ellipse étant identique à elle-même après un demi-tour, un tracé qui repart
en arrière — une hachure, le geste le plus courant — ne doit pas faire pivoter
la brosse de 180°. En représentant la direction par `(cos 2θ, sin 2θ)`, les deux
sens deviennent le même point.

Mesuré sur un aller-retour horizontal de 40 échantillons :

| lissage | amplitude de l'orientation |
|---|---|
| naïf, sur l'angle | **50,1°** |
| sur l'angle double | **0,0000°** |

La contre-épreuve est dans la suite : elle vérifie que le lissage naïf bascule
bel et bien, pour que la précaution ne passe pas pour une décoration.

## Vérifié dans le navigateur, pas seulement en unitaire

Même trait vertical, trois réglages, empreinte mesurée sur les pixels du rendu :

| réglage | empreinte | rapport largeur/hauteur |
|---|---|---|
| ellipse horizontale (0°) | 115 × 138 | 0,83 |
| ellipse verticale (90°) | 38 × 200 | **0,19** |
| **suit le tracé** | 36 × 201 | **0,18** |

Le mode automatique reproduit seul ce que l'orientation manuelle à 90° donnait :
la brosse s'est couchée dans le sens du geste sans que l'angle soit touché.

Vérifié aussi : le curseur d'orientation se grise et se désactive en mode suivi,
l'aperçu se met à plat plutôt que d'afficher un angle qui ne sert plus, et la
mini-palette reste en phase avec la barre principale.

## L'aperçu, parce que trois réglages sur quatre étaient aveugles

Avant ce lot, **rien n'indiquait la taille du pinceau** — on réglait 12 cm sans
rien voir. Un allongement et une orientation par-dessus auraient été
inutilisables.

- **Pastille dans la barre** : un disque mis à l'échelle `√aspect` sur un axe et
  `1/√aspect` sur l'autre, puis pivoté. C'est la construction exacte de
  l'ellipse du moteur, avec les facteurs rendus par `brushAxes` : la forme
  montrée EST la forme appliquée, pas une illustration à côté.
- **Fantôme sur l'œuvre** : l'empreinte réelle, en centimètres convertis à
  l'échelle d'affichage courante, le temps du réglage. Mesuré à 93,9 × 23,5 px
  pour une brosse de 12 cm allongée à 4 : 1 sur un panneau de 500 cm affiché à
  1,956 px/cm — soit 48 × 12 cm, exactement `2a × 2b`.

---

## Trouvé en vérifiant : deux défauts préexistants

### 1. Le placement des barres flottantes était cassé en « mouvement réduit »

Le plus grave des deux, et il ne doit rien à §6 — c'est en mesurant la position
de la barre élargie que je suis tombé dessus.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: .01ms !important; }
}
```

`transition-property` vaut `all` par défaut : cette règle rendait **toutes** les
propriétés transitionnables, `top` et `left` comprises. Les barres flottantes
sont placées en écrivant `top`/`left` ; chaque placement lançait donc deux
transitions, que Chrome laissait à l'état « running » sans jamais appliquer la
nouvelle valeur.

Symptôme mesuré : barre écrite à `top: 381px`, **rendue à 615 px**, bord bas 9 px
sous la fenêtre — et une écriture ultérieure de `120px` restée **sans le moindre
effet à l'écran**. `getAnimations()` montrait deux `CSSTransition` sur `left` et
`top`, bloquées.

Cela touchait tout utilisateur ayant activé « réduire les animations », un
réglage d'ACCESSIBILITÉ : la barre d'outils et la mini-palette se plaçaient au
petit bonheur. Corrigé par `transition: none !important` — supprimer la
transition plutôt que la raccourcir — et complété par la neutralisation des
animations, qui manquait.

Après correction : position rendue **381 px**, égale à la position écrite,
barre aimantée au bas de l'œuvre, entièrement dans l'écran.

### 2. Les barres ne suivaient plus l'œuvre redimensionnée

Depuis que le lot 6 bis recadre l'œuvre après la première mise en page, une
barre aimantée à un bord de la toile s'accrochait au bas d'une œuvre encore trop
haute et n'en repartait jamais. `Dock` observe maintenant la taille de l'œuvre.

**Ne pas s'observer soi-même** : je l'ai essayé, pour rattraper les variations
tardives de la hauteur de la barre, et **cela fige la page**. La barre est en
position fixe sans largeur explicite ; sa largeur utilisable vaut
« fenêtre − `left` », donc écrire `left` change sa taille, ce qui relance
l'observateur. La boucle est immédiate. C'est écrit dans le code, à l'endroit où
la tentation reviendra.

### Un essai abandonné, et pourquoi

Les commandes de §6 portent la barre d'outils de **958 à 1 328 px** — au-delà
d'un iPad en paysage (1 180 px). J'ai voulu la faire passer à la ligne. C'était
une erreur : `touch-action: pan-x` et `overflow-x: auto` datent du lot 3, le
défilement horizontal est un choix, pas un oubli. Et le passage à la ligne
rendait la hauteur de la barre dépendante de sa position, si bien que le calage
dans l'écran ne convergeait plus.

Revenu au défilement. **Conséquence assumée : sur un iPad, les dernières
commandes de la barre demandent un défilement horizontal.** L'allongement est
aussi dans la mini-palette, qui ne l'exige pas.

## Limites

1. **Rien n'a été essayé au Pencil.** Les tracés de vérification sont des
   `PointerEvent` synthétiques de type `pen` avec une pression constante de 0,9.
   Le comportement du lissage sous une vraie cadence Pencil — 240 Hz, pression
   variable, événements groupés — t'appartient.
2. **L'aperçu fantôme se montre au CENTRE de l'œuvre**, pas sous le doigt. Le
   survol du Pencil n'est disponible que sur les iPad M2 et suivants ; un
   curseur suiveur n'aurait donc rien montré sur le reste du parc.
3. **`MAX_BRUSH_ASPECT = 5` est un choix, pas une mesure.** Au-delà, le petit
   axe passe sous la maille du calque sur une brosse fine et le trait crénèle.
   Si 5 pour 1 est trop peu, la constante est nommée et documentée.

## Suites

| suite | avant | après |
|---|---|---|
| brush | — | **16** |
| les neuf autres | 134 | 134 |
| **total** | 134 | **150 sur 10 suites** |

Bundle de production : `app.js` 628,7 ko, `app.css` 15,9 ko.

## Fichiers

Créés : `src/sculpt/direction.js`, `tests/brush.mjs`, `LOT7.md`.

Modifiés : `src/sculpt/brush.js`, `src/core/project.js`, `src/ui/atelier.js`,
`src/ui/dock.js`, `src/styles.css`, `index.html`, `tests/run-all.mjs`.

---

⚠ **Rien n'est en ligne.** Aucune commande git n'a été passée. Ce lot n'existe
que sur le disque tant que `git add / commit / push` n'a pas été fait, et le
déploiement Vercel n'est effectif qu'une fois le build confirmé.
