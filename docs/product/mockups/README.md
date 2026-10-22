# Maquettes de conception Open Br**AI**n

Ces fichiers appartiennent à la spécification, pas à l’application. Ils ne lisent aucune base et ne publient aucune donnée. Les identités, documents, chiffres, tâches et résultats sont fictifs. Les thèmes et le format mobile sont examinables ; les actions produisent uniquement des états locaux de démonstration.

- `openbrain-chat-central.html` : proposition actuelle, huit parcours dans un layout à chat central et dossier latéral ; boutons et demandes guidées partagent des actions locales. Aucun modèle ou service connecté.
- `openbrain-chat-central.fragment.html` : source de la proposition actuelle, identique au fragment livré dans la conversation. Orbes vectorielles inspirées de la référence choisie, sans bibliothèque installée.
- `openbrain-ux.html` : atlas antérieur conservé de26 écrans,9 états d’atelier et parcours de correction ; fichier à ouvrir pour examiner la proposition. Aucun CDN ni appel réseau requis.
- `openbrain-ux.fragment.html` : même maquette, source éditable et affichable dans la conversation. Le wrapper autonome ajoute uniquement document HTML, titre, viewport, fond et CSP. Après modification, remplacer le fragment à l’identique dans le wrapper ; vérifier leur égalité avant livraison.
- `openbrain-users-use-cases.html` : export autonome de l’analyse précédente,26 UC, passages de relais et arbitrages. Le wrapper d’export fourni par l’outil de visualisation inclut des utilitaires et des bibliothèques d’interface optionnelles via CDN ; le contenu et les données sont embarqués.
- `openbrain-users-use-cases.fragment.html` : copie exacte de la source précédente, conservée pour traçabilité.

Les choix d’atelier ne sont pas des permissions ni des décisions produit. Le sélecteur d’écran permet de représenter différents acteurs fictifs. La version autonome de la nouvelle maquette conserve le scénario seulement pendant la vie de la page ; recharger réinitialise la simulation. L’affichage conversationnel peut mémoriser écran/thème/format, jamais un secret, un texte du corpus ou une approbation.

La navigation donne accès à tous les gabarits de référence ; les objets secondaires sont des exemples représentatifs, pas une base de démonstration exhaustive. Le schéma d’exploration n’implémente pas la caméra BrainMap. Les écrans de chatbot illustrent ce qu’un client externe doit restituer, sans imposer une console au viewer.

Pour examiner localement les exports sans ouvrir de service applicatif :

```sh
.venv/bin/python -m http.server 60268 --bind 127.0.0.1 --directory docs/product/mockups
```

Puis ouvrir `http://127.0.0.1:60268/openbrain-ux.html`. Arrêter ce serveur de prévisualisation à la fin. Cette commande ne lance ni frontend de production ni backend.

Le [dossier UX/UI](../openbrain-ux-ui-spec.fr.md), le [catalogue d’écrans](../openbrain-screen-spec.fr.md) et les [contrats](../openbrain-experience-contracts.fr.md) portent les règles normatives proposées. La maquette sert à discuter et vérifier la compréhension ; elle ne prouve ni droits serveur, ni performance, ni conformité d’accessibilité du futur produit.
