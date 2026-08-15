# Lot 3 — Interactions iPad

Objet : §3 (redimensionnement à la poignée), §11 (pinch), §14 (barre principale),
§15 (mini-palette), §22 (verrouillage d'intention).

---

## Verrouillage d'intention (§22)

`src/ui/gestures.js` — arbitre **sans DOM**. Le rôle est décidé à l'ouverture du
geste et ne se libère que lorsque TOUS les pointeurs sont relevés. Priorité :
interface → poignée → deux doigts (caméra) → stylet sur l'œuvre (sculpture) →
glisser à l'extérieur (déplacement de vue).

Deux nuances, l'une et l'autre mesurées :

- **fenêtre d'arbitrage de 70 ms pour le TOUCHER seul** — un doigt posé peut être
  le premier d'un pinch. Aucun effet de bord pendant l'attente ;
- **mais un déplacement de 8 px tranche avant l'échéance**, et les points
  mémorisés sont rejoués à leurs coordonnées d'origine. Le stylet, lui, n'attend
  jamais : retarder le Pencil de 70 ms se sentirait à chaque trait.

Écrire cet arbitre hors DOM n'est pas une coquetterie : les séquences adverses
sont pénibles à produire à la main dans un navigateur et impossibles à reproduire
à l'identique. En logique pure, ce sont six lignes déterministes.

**`node tests/gestures.mjs` — 32/32 sur sept séquences.** Chacune vérifie, en
plus de son objet propre, qu'un seul rôle a été pris et que l'état final est
neutre (aucun rôle, aucun pointeur retenu).

| Séquence | Résultat |
|---|---|
| stylet posé pendant un pinch | reste `camera`, zéro événement de sculpture |
| second doigt pendant un trait | reste `sculpt`, zéro caméra, le trait continue |
| doigt levé hors de la toile | 0 pointeur retenu, geste suivant non bloqué |
| pinch amorcé sur la barre | rôle `ui`, aucun événement sur l'œuvre |
| doigt qui part vite | décidé à **12 ms**, points rejoués exactement |
| deux pointeurs même frame | pinch d'emblée, distance initiale transmise |
| `pointercancel` en plein trait | clos une fois, **une seule** entrée d'annulation |

Le cas 7bis vérifie qu'une annulation survenue pendant la fenêtre d'arbitrage ne
laisse **aucune** entrée d'annulation orpheline.

## Vérifié dans le navigateur

| Point | Mesure |
|---|---|
| pinch, centre stable | zoom 1 → 2,222 ; dérive du point sous les doigts **0,001 cm** |
| poignée de redimensionnement | +60 cm / +10 cm exacts, étiquette « 260 × 130 cm » pendant le glisser, curseurs synchronisés, étiquette masquée au relâché |
| cadenas de ratio | 312 × 156 cm, rapport **2,000** conservé |
| glisser la barre au-dessus de l'œuvre | pixel central **identique**, aucune entrée d'annulation — la barre ne sculpte jamais |
| second doigt en plein trait au stylet | le trait aboutit (Δ=6), zoom **inchangé** |
| persistance après rechargement | dimensions, cadenas, mini-palette visible, position flottante de la barre, outil actif |

## Choix d'implémentation

**La transformation de vue porte sur l'œuvre elle-même.** Conséquence :
`getBoundingClientRect()` renvoie la boîte déjà transformée, donc la conversion
pointeur → centimètres est restée exactement celle d'avant le zoom. Aucun code de
sculpture n'a eu à connaître la caméra.

**Le redimensionnement ne déforme rien.** Pendant le glisser, le relief est
réévalué sur la nouvelle fenêtre à qualité réduite (0,35) ; au relâché, la
reconstruction est complète. Le champ étant ancré en centimètres depuis le lot 2,
agrandir révèle du motif au lieu d'étirer celui qui est là.

**Poignée dédiée pour les barres.** C'est le seul point de saisie : le reste de
la barre garde ses boutons cliquables, et l'arbitre classe ces pointeurs
« interface », donc l'œuvre ne les voit jamais.

**Réancrage au défilement.** Les barres sont en position fixe et la toile défile :
sans réancrage, une barre aimantée à un bord de la TOILE s'en détachait au
premier mouvement de page. Corrigé pendant les essais.

## Animation — mesures et sort provisoire

Banc `bench.html` (servi en développement seulement), panneau 200 × 120 cm,
sortie 1020 × 612.

| qualité | grille | cellules | heightmap | ns/cellule | rééch. | ombrage | TOTAL | im/s |
|---|---|---|---|---|---|---|---|---|
| 1,00 | 641 × 385 | 246 785 | 267,5 ms | 1084 | 27,0 ms | 82,0 ms | 376,5 ms | 2,7 |
| 0,45 | 289 × 174 | 50 286 | 53,9 ms | 1072 | 4,1 ms | 12,9 ms | 70,9 ms | 14,1 |
| 0,30 | 193 × 117 | 22 581 | 18,9 ms | 837 | 2,9 ms | 5,9 ms | 27,7 ms | 36,1 |
| 0,18 | 117 × 71 | 8 307 | 10,4 ms | 1252 | 0,7 ms | 2,9 ms | 14,0 ms | 71,4 |

Coût linéaire en cellules (~1000 ns/cellule sur trois qualités sur quatre ;
l'écart à 0,18 porte sur 8 307 cellules et 10,4 ms, où les coûts fixes pèsent
proportionnellement plus). **La reconstruction de heightmap pèse 74 % du coût par
image**, l'ombrage et le rééchantillonnage réunis 26 %.

Rien n'a été supprimé (§23) : qualité de départ abaissée de 0,45 à 0,22, et
l'interrupteur porte la mention « expérimental » en attendant l'arbitrage du
lot 4. L'animation est simplement suspendue pendant tout geste actif, quel que
soit son rôle — il n'y a donc aucune interaction animation × pinch × trait.

### Note pour l'arbitrage du lot 4, à vérifier avant de compter le gain

L'option (b) — ne déplacer que la phase de houle sur une heightmap partielle mise
en cache — vise bien le poste dominant, mais **le flou complique le cache**.
Avec `h = A(x)·houle(x,t) + B(x)` et A, B statiques : `flou(B)` se met en cache
une fois, mais `flou(A·houle)` doit être recalculé à chaque image puisque la
houle varie spatialement. Le gain doit donc compter **2 évaluations de bruit + un
flou par image** sur le terme de houle, pas seulement les 2 évaluations.

Si le flou par image mange le gain, alternative à mesurer : flouter A une seule
fois et accepter `houle·flou(A)` comme approximation. La houle étant très basse
fréquence devant le rayon de flou, l'erreur devrait être faible — **à mesurer,
pas à supposer**.

## Limites restantes

1. **Animation jamais vue tourner dans un onglet actif.** L'onglet piloté par
   l'automatisation n'est jamais l'onglet au premier plan, et `animFrame` sort
   sur `document.hidden`. Les mesures du banc sont des boucles synchrones, donc
   indépendantes de la visibilité, et le relief bouge bien avec la phase
   (signatures −345,57 et −349,00) — mais le mouvement n'a pas été vu.
2. **Orbite (§10) non faite** : c'est le lot 5. Le glisser hors de l'œuvre
   déplace la vue ; le rôle `pan` sera remplacé par l'orbite le moment venu.
3. **Valeur flottante des curseurs (§13)** toujours absente pendant le glisser ;
   elle arrive avec la refonte des curseurs au lot 7.
4. **Interface toujours celle de la v1** — bandeau, accent vert, gros curseurs :
   §12 est le lot 7.

## Fichiers

Créés : `src/ui/gestures.js`, `src/ui/viewport.js`, `src/ui/dock.js`,
`src/bench.js`, `bench.html`, `tests/gestures.mjs`, `LOT3.md`.

Modifiés : `src/ui/atelier.js` (arbitre branché en remplacement du traitement
direct des pointeurs, redimensionnement, barres), `src/core/project.js`
(`ui.ratioLocked`, `ui.viewport`, `ui.docks`), `index.html`, `src/styles.css`,
`build.mjs` (entrées nommées, banc en développement seulement).
