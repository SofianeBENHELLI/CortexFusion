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
