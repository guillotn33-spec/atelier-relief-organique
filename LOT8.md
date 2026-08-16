# Lot 8 — Découpage d'`atelier.js`

`npm test` — **150/150 sur 10 suites**. `atelier.js` : **1 499 → 1 221 lignes**.

Un découpage n'a qu'un seul critère de réussite : **rien ne change**. Ce lot a
donc commencé par construire l'oracle, pas par déplacer du code. Cette décision
a coûté plus cher que le découpage lui-même, et elle a rapporté davantage : elle
a mis au jour un défaut que six lots d'essais manuels n'avaient pas vu.

---

## L'empreinte comportementale

`src/empreinte.js`, servi en développement seulement, comme le banc de mesure.

Vingt-huit étapes — préréglage, réglages, traits au stylet allongé, annuler,
rétablir, lumière, base, négatif, matière, exposition, redimensionnement
verrouillé, vue 3D, export. Après chacune : un **hachage des pixels de l'œuvre**
et **l'état de toutes les commandes portant un identifiant**.

Le harnais **ne touche à aucun interne** : il clique, il glisse, il tape, puis
il regarde ce qu'un utilisateur verrait. C'est ce qui lui permet de survivre au
découpage qu'il doit éprouver.

L'empreinte est utile avant même d'avoir servi à comparer : elle établit des
invariants au pixel près.

| invariant | preuve |
|---|---|
| annuler restitue l'état exact | `annuler-2` = `trait-horizontal`, `7ee809d8` |
| rétablir aussi | `retablir-1` = `trait-vertical`, `472577b3` |
| « Retour base » restitue l'exact | `retour-base` = `deplacer-lumiere`, `e0683df6` |
| retirer le négatif restitue l'exact | `negatif-retire` = `e0683df6` |

Quinze images distinctes pour vingt-huit étapes : les étapes qui ne doivent rien
changer ne changent rien.

## Le défaut trouvé par l'oracle

**Un atelier détruit repeignait le canvas du suivant.**

`rebuild()` diffère son calcul d'une image — `requestAnimationFrame` en onglet
visible, `setTimeout` en onglet caché. `destroy()` n'invalidait pas ce travail en
vol. Comme `#reliefCanvas` est PARTAGÉ entre ateliers successifs, la
reconstruction d'un atelier mort arrivait après coup et peignait le relief du
projet **précédent**.

Mesuré : un même projet, aux champs identiques au bit près (relu depuis
IndexedDB), affichait deux images stables et différentes selon qu'un rendu
fantôme était encore en vol — `4f7c3192` ou `719051f9`. Le premier projet
rouvert d'une page montrait le relief de l'ancien.

Corrigé en une ligne : `destroy()` incrémente `renderToken`, ce que la
callback différée vérifie déjà.

C'est un défaut d'usage réel — ouvrir un projet, en ouvrir un autre — et il est
d'autant plus probable sur iPad, où le bridage des onglets d'arrière-plan
retarde le `setTimeout` de plusieurs secondes.

## Ce qui est sorti

| module | lignes | ce qu'il possède |
|---|---|---|
| `src/ui/bindings.js` | 54 | tables commande → projet, et ce qu'il faut refaire ensuite |
| `src/ui/persistence.js` | 120 | `ProjectStore` : temporisations, vidage, ligne d'état |
| `src/ui/animation.js` | 105 | `SwellAnimation` : boucle, qualité adaptative |
| `src/ui/exportPanel.js` | 126 | `ExportPanel` : formats, définitions, téléchargements |
| `src/sculpt/history.js` | 60 | `SculptHistory` : pile d'annulation |

Chacun a une **interface étroite** et lit ce dont il a besoin par un rappel
plutôt que de garder une référence : choisir un préréglage REMPLACE l'objet
projet de l'atelier, et un magasin qui aurait mémorisé l'ancien aurait
enregistré indéfiniment le mauvais.

## Ce qui n'est PAS sorti, et pourquoi

- **Les gestes (283 lignes).** `bindGestures` mappe des rôles de geste sur des
  actions de l'atelier : le sortir demanderait de lui passer presque tout
  l'atelier. Ce serait déplacer le problème, pas le résoudre.
- **Le redimensionnement (94 lignes).** Même raison : il mute les dimensions du
  projet, le calque, les commandes, la forme dans le DOM et déclenche la
  reconstruction. Interface trop large.
- **Les affichages de brosse et la vue 3D.** Sortables, mais je me suis arrêté :
  l'effort de ce lot est parti dans l'oracle, et livrer un découpage vérifié
  vaut mieux qu'un découpage plus large mal éprouvé.

`atelier.js` reste un **contrôleur** : son travail est de câbler. Qu'il fasse
plusieurs centaines de lignes n'est pas anormal ; qu'il en fasse 1 221 l'est
encore. §20 n'est pas soldé.

## Ce que l'oracle a prouvé, et ce qu'il n'a pas prouvé

**Prouvé.** À l'étape « quatre modules sortis + correction du rendu fantôme »,
la séquence complète a été rejouée contre la référence enregistrée AVANT tout
découpage : **0 écart sur 28 étapes**, pixels et commandes compris.

**Non prouvé de la même façon.** La sortie de l'historique, faite ensuite, n'a
pas eu de passage complet vert. La comparaison est devenue instable pour une
raison que je n'ai pas élucidée : sur un onglet caché depuis plus de cinq
minutes, Chrome brise les minuteurs à un déclenchement par MINUTE, et l'atelier
diffère justement sa reconstruction par un minuteur. La séquence a fini par
diverger sur des étapes qui n'ont rien à voir avec le découpage — jusqu'à
`depart`, qui ne fait rien.

L'historique a donc été vérifié **séparément et directement**, au pixel près :

| étape | hachage |
|---|---|
| avant le trait | `5a4318c` |
| après le trait | `85d90d08` |
| après annuler | **`5a4318c`** — retour exact |
| après rétablir | **`85d90d08`** — retour exact |

Et les autres modules sortis ont été exercés à la main : les quatre formats
d'export produisent leurs quatre notes et la bonne visibilité de commandes,
l'animation démarre et s'arrête, un réglage se retrouve bien dans IndexedDB,
la ligne d'état reste muette quand tout va bien.

**Limite du harnais, écrite noir sur blanc :** il est fiable dans un onglet
VISIBLE. Piloté sur un onglet caché, il court après un atelier dont les
minuteurs sont bridés, et ses relevés deviennent des photos d'états
intermédiaires. Deux corrections l'ont beaucoup amélioré — attendre le repos de
l'atelier (`#rendering`) plutôt qu'une durée, et jeter un projet de
préchauffage — sans le rendre insensible au cas extrême.

## Autre chose vue en passant

Le commentaire d'en-tête de `build.mjs` invoquait « le service worker (lot 7) »
pour justifier le mode `--serve`. **Il n'existe aucun service worker dans ce
dépôt** — la PWA de l'amendement C n'a jamais été commencée. Commentaire
corrigé.

La note d'export affiche toujours le **budget** de triangles et non le maillage
réellement produit — « 200 k triangles, environ 4,7 Mo » pour un panneau qui en
livrera bien moins. C'est le point d'arbitrage laissé ouvert au lot 6 bis ; je
ne l'ai pas tranché ici, un lot de découpage n'ayant pas à changer ce qui
s'affiche.

## Fichiers

Créés : `src/empreinte.js`, `src/ui/bindings.js`, `src/ui/persistence.js`,
`src/ui/animation.js`, `src/ui/exportPanel.js`, `src/sculpt/history.js`,
`LOT8.md`.

Modifiés : `src/ui/atelier.js`, `src/main.js`, `build.mjs`.

## Suites

150/150 sur 10 suites, inchangées. Bundle : `app.js` 629,4 ko, `app.css` 15,9 ko.

---

⚠ **Rien n'est en ligne.** Aucune commande git n'a été passée. Ce lot n'existe
que sur le disque tant que `git add / commit / push` n'a pas été fait, et le
déploiement Vercel n'est effectif qu'une fois le build confirmé.
