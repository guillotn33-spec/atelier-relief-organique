# Lot 6 — Exports PNG, JPEG, USDZ, OBJ

Objet : §17 (export image) et §18 (export 3D pour Procreate).

Un principe commun aux quatre formats : **il n'existe pas de géométrie
d'export**. Images et modèles partent de la même heightmap canonique que
l'écran. C'est la seule façon sûre de ne jamais livrer ce que §18 interdit —
une image plaquée sur un rectangle plat présentée comme du relief.

`node tests/export.mjs` — **21/21**.

---

## §17 — Image

La version 1 exportait un PNG de 1920 × 1200 quel que soit le projet : déformé
sur un carré, minuscule sur un panneau de 500 cm. Désormais la définition est
choisie par son **grand côté** et le rapport vient du projet.

| projet | grand côté demandé | sortie | rapport image / projet |
|---|---|---|---|
| rectangle 200 × 120 | 2048 | 2048 × 1229 | 1,6664 / 1,6667 |
| portrait 90 × 180 | 2048 | 1024 × 2048 | 0,5000 / 0,5000 |
| carré 120 | 4096 | 4096 × 4096 | 1,0000 / 1,0000 |
| rond 130 | 2048 | 2048 × 2048 | 1,0000 / 1,0000 |
| bandeau 500 × 60 | 4096 | 4096 × 492 | 8,3252 / 8,3333 |

**Le plafond est explicite et signalé.** §17 interdit les définitions délirantes
tirées d'un calcul en 300 points par pouce sur plusieurs mètres : une demande de
40 000 px est ramenée sous 40 Mpx, et l'interface le **dit** au lieu de le taire.

**Transparence.** Vérifié dans le navigateur sur un rond de 130 cm exporté en
PNG : alpha **0** au coin hors du disque, **255** au centre. En JPEG, l'option
disparaît et le fond est obligatoire — mesuré à rgba(215, 211, 200, 255), soit la
couleur de mur du projet, pas du noir.

## §18 — Modèles 3D

Les deux exporteurs viennent de Three.js, comme l'impose l'amendement B.

**Unités.** Le projet raisonne en centimètres, les deux formats sortent en
**mètres**. USDZ déclare `metersPerUnit = 1` : un panneau de 200 cm exporté tel
quel arriverait à 200 mètres en réalité augmentée. Le test relit les coordonnées
**dans l'archive produite** plutôt que de faire confiance au code qui vient de
les écrire — coordonnée maximale 1,000 pour un panneau de 2 m.

**OBJ.** `OBJExporter` écrit `usemtl` mais ne produit ni le fichier de matériau
ni la ligne `mtllib` qui le déclare : sans elles l'OBJ s'ouvre en gris. Le MTL
est donc fabriqué ici — dix lignes de texte, ce qui n'a rien à voir avec écrire
un exporteur USDZ maison — et la déclaration ajoutée en tête.

Emballage : deux fichiers de même racine, l'OBJ pointant sur le MTL. Pas
d'archive : sur iPad, deux fichiers déposés côte à côte dans Fichiers s'ouvrent
directement, là où un ZIP demanderait une manipulation de plus.

**Mesures sur un panneau de 200 × 120 × 6 cm :**

| vérification | résultat |
|---|---|
| sommets / normales / UV | 15 617 chacun, égaux et complets |
| faces | 30 720, une par triangle |
| emprise exportée | **2,000 × 1,200 × 0,060 m** |
| ce n'est pas un plan | amplitude en Z de 0,0600 m |
| sculpter change le fichier | oui, l'OBJ diffère |
| USDZ | ZIP valide, `#usda 1.0`, `def Mesh`, `points`, `normals`, `primvars:st`, `UsdPreviewSurface` |
| rond | 12 849 sommets contre 16 641 pour le carré — rapport 0,772 |

**Densité d'export.** Mesuré : 400 000 triangles donnent un USDZ de 9,3 Mo et un
OBJ de 16 Mo, pénibles à ouvrir sur un iPad. Ramenée à 200 000, l'USDZ retombe
sous 5 Mo et le relief reste très détaillé pour un panneau mural. L'interface
annonce le nombre de triangles et le poids attendu.

## Vérifié dans le navigateur, sans rien écrire sur le disque

Les quatre formats ont été déclenchés depuis l'interface avec les
téléchargements **interceptés** — `URL.createObjectURL` et le clic d'ancre
détournés — de sorte qu'aucun fichier n'a été écrit.

| format | fichier produit | poids |
|---|---|---|
| PNG 2048 | `rectangle-200-120-cm-2048x1229.png` | 2,8 Mo, 2048 × 1229 |
| JPEG 4096 | `rectangle-200-120-cm-4096x2458.jpg` | 577 Ko, 4096 × 2458 |
| OBJ + MTL | `.obj` (16 Mo à 400 k) + `.mtl` (139 octets) | `mtllib` apparié |
| USDZ | `rectangle-200-120-cm.usdz` | 9,3 Mo à 400 k, ZIP valide |

Le MTL relu fait 139 octets et contient bien `newmtl relief_mat`, la couleur
diffuse et l'exposant spéculaire déduits de la finition.

## Limites

1. **Aucun fichier n'a été ouvert dans Procreate.** Je peux montrer que l'USDZ
   est une archive valide contenant un maillage, des normales, des UV et un
   `UsdPreviewSurface`, et que ses coordonnées sont en mètres. Que Procreate
   l'accepte et le laisse peindre est une vérification qui t'appartient.
2. **La conversion PBR → Phong du MTL est une approximation assumée.** Les deux
   modèles ne se correspondent pas ; l'exposant est déduit de la rugosité, et le
   tableau de correspondance de `shade.js` reste la référence.
3. **Pas de texture exportée.** Le matériau est uni : couleur, rugosité,
   métallicité. Peindre est précisément ce que Procreate apportera.
4. **L'export de très grandes images reste coûteux en mémoire.** Le plafond de
   40 Mpx protège, mais un export 4096 sur un iPad ancien peut échouer ; l'échec
   est rapporté dans le panneau, pas avalé.

## Suites

Export 21/21 · Mesh 13/13 · Gestes 32/32 · Animation 4/4 · Moteur 15/15 ·
Architecture 12/12. Bundle de production : 620 ko.

## Fichiers

Créés : `src/export/image.js`, `src/export/model.js`, `tests/export.mjs`,
`LOT6.md`.

Modifiés : `src/ui/atelier.js` (panneau d'export en remplacement du bouton PNG
unique), `index.html`, `src/styles.css`.
