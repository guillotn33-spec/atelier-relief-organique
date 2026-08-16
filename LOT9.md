# Lot 9 — Direction artistique, boutique d’effets et prototypes

## Point de départ

L’audit du lot 8 a sécurisé le moteur et son contrôleur. La refonte suivante a
recentré le bundle navigateur sur l’export PNG.
Le logiciel fonctionne, mais deux écarts empêchent encore l’interface d’atteindre
la référence visuelle retenue.

1. **L’atelier est trop vide et trop générique.** L’image de référence organise
   le travail comme un véritable logiciel de composition : projet et ressources
   en haut à gauche, effets en bas à gauche, œuvre au centre, contrôles d’effet à
   droite, calques et propriétés liées en bas. La version actuelle reprend les
   colonnes, mais pas cette densité fonctionnelle.
2. **Les trois vignettes promettent plus que le moteur ne livre.** Dunes,
   Cellules et Archipel ont des noms distincts, mais partagent encore la même
   famille de bruit avec des paramètres différents. Ils peuvent donc converger
   visuellement. Une bibliothèque professionnelle doit produire trois signatures
   reconnaissables avant même de lire leur nom.

## Décision produit

La sortie reste une **image PNG fixe**. La zone inférieure reprend la densité
d’un logiciel de compositing, mais ne simule pas une timeline : elle montre les
calques réels, les paramètres liés et les variations restaurables.

La colonne gauche devient une vraie **boutique d’effets locale**. Un effet n’est
pas une décoration ni un bouton factice : il applique un correctif typé à l’un
des blocs du projet — forme, matière ou éclairage — puis déclenche uniquement le
travail nécessaire (reconstruction géométrique ou réombrage).

## Architecture retenue

### Prototypes

Les prototypes représentent une composition complète :

- **Dunes** — longues strates souples, peu de cavités fermées, circulation
  horizontale dominante ;
- **Cellules** — cavités arrondies et rapprochées, tailles légèrement variables,
  parois continues ;
- **Archipel** — grandes masses ouvertes reliées par des chenaux, respiration
  plus importante et contraste plus marqué.

Le champ reste déterministe, défini en centimètres absolus et indépendant de la
taille de la toile. Agrandir le panneau doit révéler la suite du motif sans
déplacer ce qui existe déjà.

### Boutique d’effets

Trois familles sont exposées :

- **Formes organiques** — modifient la géométrie et reconstruisent la heightmap ;
- **Matières** — modifient couleur, grain et finition, puis réombrent ;
- **Éclairage** — modifient lumière et contraste, puis réombrent.

Chaque effet possède un identifiant stable, un nom, une description, un type et
un correctif de projet. L’effet actif est mémorisé avec le document.

## Audit d’interface

| Zone | Écart constaté | Correction lot 9 |
|---|---|---|
| En-tête | trop haut, peu d’outils visibles | chrome plus compact, modes de travail centraux |
| Projet | trois cartes sans pile de ressources | miniature du document et ressources matière/lumière |
| Effets | absent | recherche, catégories, compteurs et effets applicables |
| Composition | bon principe, espace perdu | cadre plus dense et surface utile agrandie |
| Contrôles | molettes réussies | en-tête d’effet actif et paramètres avancés plus compacts |
| Panneau inférieur | calques simples | arbre de calques + paramètres liés + variations |
| Timeline | hors périmètre | aucune animation fictive ; seulement des données utiles au PNG |

## Réactivité

- Une molette géométrique conserve l’aperçu immédiat existant et reconstruit la
  heightmap au niveau de qualité normal.
- Un effet de matière ou de lumière ne reconstruit jamais la géométrie.
- Les effets n’ajoutent aucune dépendance réseau et fonctionnent hors ligne.
- Le moteur 3D et l’animation restent absents du bundle final.

## Critères d’acceptation

- La première vue est reconnaissable comme la référence : projet/effets à
  gauche, composition centrale, effet actif à droite, calques en bas.
- La boutique contient au moins huit formes, six matières et six éclairages.
- Tous les effets visibles sont cliquables et modifient réellement le rendu.
- Dunes, Cellules et Archipel produisent trois silhouettes manifestement
  différentes avec leur graine de référence.
- Les quatre molettes, les variations, la restauration, la sculpture et le PNG
  restent fonctionnels.
- Le build réussit et toutes les vérifications courantes restent vertes, avec
  une suite ciblant la bibliothèque d’effets et les signatures des prototypes.

## Limites assumées

- Il n’y a ni marketplace distante, ni compte, ni paiement : « boutique »
  désigne une bibliothèque d’effets intégrée au logiciel.
- La ressemblance artistique est obtenue par des familles procédurales et une
  calibration contrôlée, pas par une image préfabriquée plaquée sur le canvas.
- La validation tactile finale sur iPad et Apple Pencil reste une étape matériel.

## Bilan de réalisation

- La première vue suit désormais la structure de la référence : projet et
  ressources, boutique, composition, contrôles d'effet, calques et valeurs liées.
- La boutique livre **21 effets réels** : 8 formes, 7 matières et 6 éclairages.
- Dunes, Cellules et Archipel reposent sur trois champs spécialisés ; leur plus
  petite distance normalisée mesurée est de 14,4 %, ce qui scelle leur séparation.
- Le panneau inférieur n'est pas une fausse timeline : les trois pistes vertes
  reflètent les valeurs courantes de taille, densité et fluidité et ouvrent leur
  vrai contrôle.
- Le bundle final reste local et compact : 110,2 ko de JavaScript et 43,9 ko de
  CSS avant compression.
- Validation finale : **122/122 vérifications** sur 9 suites, build réussi et
  parcours navigateur forme → matière → éclairage → recherche sans erreur console.

## REV 2026-08-16 — calibration sur les photos, audit du catalogue

Le bilan ci-dessus rapporte l'état du lot 9 à sa date ; il n'est pas réécrit.
Ce bloc rapporte ce qu'une passe de calibration et d'audit a mesuré ensuite.

**Calibration des trois prototypes sur `ref-1/2/3.jpg`.** La distance mesurée par
`tests/calibrate-refs.mjs` passe de 25,25 / 22,72 / 5,02 % à **6,84 / 4,76 /
4,65 %**. Le levier décisif n'est ni l'exposition ni le contraste mais la
HAUTEUR DE LUMIÈRE : à 48° l'étendue tonale plafonnait à 123 contre 169 sur la
photo, parce que baisser l'exposition éteint les plateaux en même temps que les
creux. Une lumière rasante creuse les cavités sans toucher aux sommets — à 20°,
p95 219 pour 221 visés.

**Trois défauts du catalogue, mesurés et corrigés.**

1. La vignette d'un prototype déclarait un effet qui ne le reproduisait pas :
   « Dunes » annonçait « Dunes fluides » (autre famille, bassins de 43 cm au lieu
   de 38) et « Archipel » annonçait « Relief organique ». Les trois prototypes
   ont désormais leur propre entrée, lue dans `PRESETS`. Scellé par `effects D1`.
2. Un effet de forme se fondait dans la géométrie courante ; quatre des huit
   n'énonçaient pas `channelRatio`. « Vagues douces » rendait donc 0,58 après
   Dunes et 0,62 après Archipel. Le socle est maintenant `defaultGeometry()`.
   Scellé par `effects D2`.
3. La molette « Chenaux » ne pilotait rien sur Cellules et Archipel : douze
   combinaisons rendaient la même image à trois décimales. Étendre le réseau de
   chenaux à ces familles a été essayé — les variations portant une bosse
   enclavée passent de 2 % à 48 %. La molette est donc grisée hors de la famille
   `organic`, avec sa raison.

**Oracle A2 corrigé.** Il prenait la médiane des proéminences des îlots TROUVÉS,
les variations propres étant absentes de la liste : six petits îlots notaient
mieux qu'un seul gros. La grandeur est désormais la part des variations portant
un îlot visible — 0 %, 2,1 % et 4,2 % selon le format.

**Boutique.** Chaque article porte une vignette RENDUE par le moteur, via
`applyEffect` puis `renderFull`, et la description que la table portait déjà et
que l'interface jetait. L'étoile « favori », qui n'était branchée sur rien, est
retirée.

**Ce qui reste ouvert, et pourquoi.** Les trois photos montrent UN SEUL langage
plastique — grandes poches fermées et arrondies dans un plateau lisse — à trois
réglages près : taille, allongement, densité. Le lot 9 leur a donné trois
familles procédurales distinctes, et `organic`, dont les lignes de niveau d'un
fbm sont des traînées fractales, ne sait pas produire une poche fermée à bord
net : mesuré sur sept jeux de paramètres, agrandir les bassins délave l'image
sans jamais fermer les formes. La primitive à champ de distance (`cells`) y
arrive. Réunir les trois prototypes sur cette primitive renverserait la décision
« trois champs spécialisés » du lot 9 et le test `effects C1` qui la scelle :
l'arbitrage n'appartient pas à cette passe.
