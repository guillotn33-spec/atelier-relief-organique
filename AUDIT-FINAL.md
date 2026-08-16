# Audit final — Atelier de relief organique

Date : 16 août 2026  
Périmètre produit : création graphique dans le navigateur, aperçu 2D et export PNG uniquement.

## Conclusion

Le moteur de relief existant était suffisamment stable pour être conservé. La dette principale se trouvait dans l’interface et dans un périmètre produit devenu trop large : outils flottants sur l’œuvre, réglages sans hiérarchie, animation, vue 3D et quatre formats d’export alors que la sortie demandée est un PNG statique.

La version finale sépare maintenant clairement les quatre zones de travail : bibliothèque, œuvre, propriétés et calques/variations. Les fonctions avancées restent accessibles sans encombrer le parcours principal.

## Changements réalisés

- Interface professionnelle inspirée des logiciels de composition, avec identité visuelle propre.
- Œuvre centrale entièrement dégagée ; la barre d’outils ne flotte plus sur le dessin.
- Quatre molettes essentielles reliées aux vrais paramètres du moteur : cavités, échelle, fluidité et profondeur.
- Contrôle des molettes par glisser vertical ou horizontal, molette de souris, flèches, Page Up/Down, Home et End.
- Bibliothèque de trois compositions avec aperçu visuel.
- Panneau inférieur fonctionnel pour les calques, les variations et l’historique de sculpture.
- Variations mémorisées, restaurables et persistées avec le projet.
- Navigation par calque vers le bon groupe de propriétés.
- Export limité au PNG, avec 2048 px, 4096 px ou définition personnalisée et transparence pour les panneaux ronds.
- Retrait du moteur 3D et de la boucle d’animation du bundle navigateur.
- Interface responsive : inspecteur en tiroir sous 920 px, bibliothèque retirée sur petit écran, barre d’outils compacte.

## Performance et robustesse

- Bundle JavaScript : environ 637 Ko avant audit, 85,8 Ko après finalisation (réduction d’environ 86 %).
- Le rendu d’aperçu et l’export PNG continuent d’utiliser la même heightmap canonique.
- Les anciens modules 3D restent uniquement disponibles pour les tests historiques et ne sont pas chargés par l’application.
- Les interactions de la nouvelle interface sont détruites proprement lors d’un changement de projet pour éviter les écouteurs fantômes.

## Validation exécutée

- `npm run build` : réussi.
- `npm run test` : 150/150 vérifications réussies sur 10 suites.
- Parcours navigateur : chargement du projet, molette au clavier, création d’une variation, restauration d’une variation, navigation par calque et export PNG vérifiés.
- Dépendances : audit npm sans vulnérabilité connue.

## Risques résiduels

- Un dernier contrôle tactile réel sur iPad/Safari et Apple Pencil reste conseillé avant une diffusion publique ; l’émulation navigateur ne remplace pas la latence et la pression d’un appareil réel.
- Les très grands PNG restent volontairement bornés par le plafond mémoire de l’exporteur.
- La qualité artistique dépend désormais surtout du réglage des préréglages et de la calibration du moteur, pas de l’architecture de l’interface.
