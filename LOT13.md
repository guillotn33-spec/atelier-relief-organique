# Lot 13 — affichage épuré et mode Prompt

Deux ajouts sans rapport l'un avec l'autre, livrés ensemble parce qu'ils
partagent une porte : le menu **Affichage**.

Vérifications : **168** hors navigateur (douze suites) et **30** dans un
navigateur réel, contre 147 et 15 avant ce lot.

---

## Affichage épuré — `Ctrl B`

Tout ce qui n'est pas l'œuvre disparaît : titre, menus, onglets d'espace,
colonne de projet, boutique d'effets, inspecteur, panneau du bas, fil d'Ariane,
pied de page. Il reste trois choses.

**La barre d'outils complète, repliable.** Le bouton de repli existait depuis le
lot 7 — avec un attribut `hidden` que rien ne levait. Il était donc
inatteignable, et la barre ne s'est jamais repliée une seule fois. Il est
maintenant branché, son état est enregistré, et il n'apparaît que dans ce mode :
replier une barre au milieu d'une interface complète ne gagne rien.

**Une palette flottante** portant les quatre commandes dont on se sert en
sculptant — creuser, bomber, taille, force — et un bouton *Mode Prompt*. Elle
n'a aucune logique propre : elle clique les commandes existantes, comme la barre
de menus. Un outil qui change de comportement change partout à la fois.

**L'œuvre, en plein écran**, avec une marge resserrée.

### La palette flottante est une récidive assumée

`src/ui/dock.js` faisait déjà flotter des barres et a été supprimé au lot 9.
Ressusciter la fonctionnalité veut dire ne pas ressusciter ses deux défauts.

*Elle positionnait par `top` et `left`.* La règle « mouvement réduit » posait
`transition-duration: .01ms !important` sur `*`, et comme `transition-property`
vaut `all` par défaut, `top` et `left` devenaient transitionnables : chaque
placement lançait deux transitions que Chrome laissait à l'état *running* sans
les appliquer. Mesuré à l'époque : barre écrite à 381 px, rendue à 615 px, puis
une écriture de 120 px sans le moindre effet à l'écran.
→ **Ici on positionne par `transform`.** Aucune transition n'est déclarée
dessus, et `transform` ne déclenche pas de recalcul de mise en page.

*Elle ne recadrait pas au redimensionnement.* Une palette posée en bas à droite
d'un grand écran devenait inatteignable sur un petit.
→ **`contraindre` est une fonction pure**, appelée au dépôt et à chaque
changement de taille, et éprouvée hors DOM par `tests/benito.mjs` — quarante-deux
positions demandées sur sept tailles d'écran, plus les cas NaN, Infini et
champs absents. Même choix que l'arbitre de gestes du lot 3 : le défaut n'était
pas dans l'écoute du pointeur mais dans l'arithmétique, et une arithmétique se
vérifie sans navigateur.

Un cas mérite d'être nommé : **une fenêtre plus étroite que la palette**. La
borne naïve `min(fenêtre − largeur − marge, …)` donne alors un maximum négatif,
et la palette part par la gauche — invisible et inatteignable. C'est exactement
ce qui arrivait après un redimensionnement.

---

## Mode Prompt — `Ctrl M`

Les curseurs deviennent un langage. Le déplacement d'un réglage fabrique
**instantanément et localement** un prompt, sans aucun appel réseau.

### Pourquoi pas un modèle pour rédiger le prompt

Traduire « profondeur = 87 % » en une phrase ne demande pas d'intelligence :
cela demande une table. Une règle déterministe est gratuite, instantanée et
reproductible ; demander la même chose à un modèle coûterait une seconde
d'attente à chaque cran de curseur pour un résultat qui varierait d'une fois sur
l'autre. **Le modèle sert à produire l'image, pas à convertir des curseurs en
phrases.**

### Trois sorties pour un seul état

| | |
|---|---|
| `json` | Ce que l'utilisateur a demandé, sous forme structurée. **C'est la référence** : indépendante de tout moteur, elle survit au changement de fournisseur et se range dans le fichier de projet. |
| `sections` | Le prompt découpé en six fragments nommés et modifiables. |
| `text` | Les fragments assemblés, prêts à coller. |

Le texte est une **traduction** du JSON vers un moteur donné, pas l'inverse. Si
demain un autre modèle demande une autre formulation, seule la traduction
change ; le projet ne bouge pas. C'est ce qui rend le moteur interchangeable.

### On ne traduit pas les nombres, on traduit l'intention

`shadow = 90 %` n'a aucun sens pour un modèle d'image. Ce que le compilateur
écrit à la place :

> the deepest cavities fall into near-black shadow while raised surfaces stay
> bright, producing strong depth separation without crushing the intermediate
> surface detail

Trente-huit paliers sémantiques couvrent profondeur, douceur, ondulation,
irrégularité, allongement, chenaux, morphologie de famille, clarté, teinte,
finition, grain, azimut, élévation, ombres, occlusion, contraste, exposition,
halo, découpe et cadre.

### Trois niveaux, parce qu'il y a trois usages

**Simple** — un champ, on copie. **Détaillé** — six sections modifiables une par
une. **Expert** — negative prompt, JSON, graine.

Une section retouchée à la main **cesse de suivre les curseurs** et le dit ; les
autres continuent en direct. Sans cette règle, toucher un curseur effacerait la
phrase que l'utilisateur vient d'écrire, et il ne le découvrirait qu'après.

### Trois fidélités

`Géométrie stricte` demande de préserver exactement le nombre, la position, la
taille et la topologie des cavités — c'est le mode à utiliser quand on fournit
la heightmap ou l'export en référence. `Interprétation` autorise une
réinterprétation locale. `Créatif` traite la composition comme un point de
départ.

### Le negative prompt

À ne pas confondre avec le **relief négatif**, qui est un mode de géométrie.
Celui-ci empêche le modèle de transformer un panneau sculpté en photo de
décoration — le défaut vers lequel ils glissent tous, faute d'instruction
contraire. Il s'adapte : sans cadre il refuse `frame` et `border` ; en finition
mate il refuse `specular highlights`.

---

## Le nombre de cavités est une estimation, et elle se dit comme telle

Le moteur n'a **pas** de « nombre de cavités » : le paramètre a été retiré au
lot 2 parce qu'un champ continu ancré en centimètres n'en a pas — ce nombre
dépend de la fenêtre par laquelle on regarde le champ. Un modèle d'image, lui,
raisonne beaucoup mieux sur un nombre d'objets. On le dérive donc, et le prompt
écrit toujours « roughly 11 », jamais « 11 ».

**Calibration.** Comptage des composantes connexes du domaine creusé — même
définition de « creusé » que l'oracle d'îlots de `tests/engine.mjs` — sur
**1 280 configurations** : huit formats de 80 × 60 à 400 × 200 cm, huit tailles
de cavité de 16 à 120 cm, cinq densités, les quatre familles.

Quatre modèles ont été ajustés. **La loi d'aire — n ∝ surface / taille², qui est
l'intuition naturelle — se trompe de 73 à 84 % en médiane. Elle est fausse.**
Ce qui marche est une loi de ligne, n ∝ (√aire / taille)^p : les cavités
s'organisent en bandes et en chaînes, pas en pavage. Sauf dans la famille
Cellules, où l'exposant remonte vers le pavage (1,35) — ce qui est exactement ce
qu'on attend d'un réseau alvéolaire.

| famille | k | p | écart médian | dans ±50 % |
|---|---|---|---|---|
| organic | 2,2 | 0,70 | 16 % | 95 % |
| dunes | 1,55 | 1,05 | 9 % | 96 % |
| cells | 1,8 | 1,35 | 27 % | 82 % |
| archipelago | 1,27 | 0,95 | 14 % | 95 % |

**La densité n'entre pas dans la formule.** Elle déplace le compte de moins de
35 % sur toute sa course — moins que la dispersion de l'estimateur lui-même.
Elle change la *surface* creusée, pas le *nombre* de creux.

`tests/prompt.mjs` confronte l'estimation au comptage réel sur trente-six
panneaux à chaque exécution : écart médian 20 %, aucun cas hors d'un facteur
deux.

---

## Ce que le navigateur a trouvé, encore

Deux défauts que seule `npm run fumee` pouvait sortir.

**Le prompt ne suivait pas les curseurs.** Il ne se recompilait que sur
`syncControlsFromProject`, appelée au chargement et au changement de préréglage —
jamais pendant un réglage. Le prompt restait figé sur l'état d'ouverture de la
feuille, ce qui est exactement le contraire de ce qu'on lui demande.

**Et la cause de la deuxième moitié du défaut valait le détour** : le champ
assemblé était protégé contre l'écrasement « tant qu'il a le focus ». Or
`ouvrir()` lui donnait le focus. La protection s'appliquait donc en permanence.
Avoir le focus n'est pas écrire — la protection ne se déclenche plus que sur une
modification réelle, et elle l'affiche.

**Le repli de la barre d'outils ne changeait pas sa hauteur.**
`#atelier .toolbar.dock` porte `min-height: 48px` avec une spécificité de
(1,2,0) ; la règle de repli était en (1,1,0). La barre se vidait de son contenu
et gardait sa hauteur.

---

## Ce qui reste

- **Le bouton « Générer » n'existe pas encore**, et c'est délibéré : brancher un
  moteur demande de choisir lequel, où va la clé d'API, et ce qu'on fait de
  l'image qui revient. Le prompt et le JSON sont là ; le pipeline est une
  décision à prendre, pas une ligne à écrire.
- **La heightmap et la carte de normales ne sont pas encore exportées** comme
  images de référence. C'est ce qui donnerait tout son sens au mode « Géométrie
  stricte », qui pour l'instant décrit une contrainte sans fournir la référence
  sur laquelle elle porte.
- Le mode épuré ne mémorise pas le repli de la palette (elle n'en a pas).
