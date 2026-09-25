# Consultation réelle des propositions

En mode `VITE_DATA_MODE=api`, après connexion et sélection d’un domaine, l’espace des propositions affiche la liste paginée, le motif et le statut. Sélectionner une proposition charge son détail et sa comparaison avant/après. Le mode mock conserve ses propres parcours.

| Interaction | Endpoint | Effet |
| --- | --- | --- |
| Liste, puis page suivante | `GET /v1/domains/{domain}/proposals?limit=20&after=…` | Parcourt les propositions accessibles. |
| Ouvrir un élément | `GET /v1/domains/{domain}/proposals/{proposal_id}` | Relit l’état, la révision de revue et la proposition remplacée. |
| Comparer | `GET /v1/domains/{domain}/proposals/{ident}/diff` | Affiche ajouts, modifications et retraits, avec maturité et relations. |
| Lire une preuve | `GET /v1/domains/{domain}/sources/{source_id}` | Charge la source autorisée puis affiche seulement la plage citée, son titre, son emplacement et son empreinte. |

Le backend indique si la comparaison utilise l’état précédant l’approbation ou l’état actuellement publié. L’interface reprend cette distinction et avertit lorsque la base est obsolète. « Approuvée » et « Publiée » sont deux états distincts. Les positions des preuves comptent des caractères Unicode, pas les unités UTF-16 de JavaScript.

Cette étape permet la consultation uniquement. La correction, la décision et la publication depuis cet écran restent à raccorder. Aucune clé de confirmation n’est stockée dans le navigateur ; les contrôles backend existants restent obligatoires pour ces actions.

L’actualisation relit liste, détail et comparaison. Une erreur de lecture masque les données de la zone concernée plutôt que présenter un ancien résultat comme valide. La déconnexion purge le cache API. Les preuves sont chargées à la demande ; leur contenu ne devient ni un lien actif automatique ni du HTML exécutable. Les API appliquent les droits, y compris lorsque l’identité a perdu son accès.

Validation : tests de composants sur données synthétiques pour pagination, état obsolète, refus d’accès, absence de mélange entre deux détails et plage Unicode. Les tests de contrats comparent méthodes et chemins à OpenAPI. La vérification sur le corpus privé reste hors dépôt.

## Historique des décisions et confirmations

« Consulter les décisions » charge à la demande `GET /v1/domains/{domain}/proposals/{ident}/reviews`, avec pagination `limit`/`after`. Chaque événement affiche l’action, le motif, l’auteur, la date et la révision. Une erreur d’accès masque les événements précédemment chargés.

Les décisions `reject`, `defer`, `request_changes` et `reopen` passent par `POST /v1/domains/{domain}/proposals/{ident}/reviews` ou le tool MCP `api_proposals_review`. Elles exigent, comme l’approbation, une confirmation signée : elles ne peuvent pas être raccordées à un simple bouton envoyant uniquement le JWT utilisateur. Un hôte de confiance doit confirmer la commande exacte (action, chemin et corps). La clé privée ne doit jamais être embarquée dans le frontend. L’absence de preuve donne HTTP428 ; une révision/digest périmé donne409. Une reprise conserve la clé d’idempotence et le corps, avec une nouvelle preuve de confirmation valable.

Le cycle de revue ne publie aucun savoir. La consultation des décisions est disponible ; leur déclenchement depuis le navigateur attend l’intégration explicite à un hôte de confirmation. L’hôte local de recette permet déjà d’exécuter et vérifier ce cycle via MCP sans modifier ces contrôles.

## Préparer une commande de revue

Depuis une proposition prête, différée ou en correction, le frontend peut préparer les transitions autorisées sous forme de commande MCP `api_proposals_review`. Le JSON inclut l’identifiant, le digest, la révision attendue, le motif et la clé d’idempotence. Il est affiché dans une zone de texte sélectionnable. Modifier le motif efface la commande précédente ; une nouvelle préparation crée une nouvelle intention.

Cette étape n’exécute rien, ne fournit aucune signature et ne remplace pas une confirmation de l’hôte. L’hôte doit relire la proposition, faire confirmer l’action exacte et transmettre la preuve signée selon le protocole existant. Après exécution, actualiser le détail et l’historique. L’approbation et la publication restent des opérations distinctes ; elles ne sont pas ajoutées à ce formulaire de préparation.
