# Historique des accès à une source

Le propriétaire d’un domaine peut consulter les changements effectifs des lecteurs d’une source avec `GET /v1/domains/{domain}/sources/{source_id}/access-events`, ou l’outil MCP `api_sources_access_events`. Il doit encore avoir accès à la source. Être l’auteur d’un ancien changement ne donne aucun droit supplémentaire.

Le contrat de modification `PUT /sources/{source_id}/access` reste inchangé et exige sa confirmation signée habituelle. PostgreSQL enregistre automatiquement l’état avant/après dans la même transaction que la modification. Si l’écriture du journal échoue, la modification des droits échoue aussi. La réorganisation d’une liste ou la suppression de doublons sans changement de lecteurs ne crée pas d’événement. La création initiale d’une source n’est pas un changement d’accès.

## Données retournées et frontend

La réponse contient `source_id`, `current_allowed_subjects`, `history_scope`, `items` et `next_after`. Chaque événement contient son `id`, `created_at`, `previous_allowed_subjects`, `allowed_subjects`, `actor` et `actor_source`.

- `runtime_context` : l’acteur provient du contexte transactionnel fourni par le runtime après authentification. Cette valeur n’est pas une signature cryptographique autonome ; les identifiants SQL applicatifs demeurent une frontière de confiance.
- `unattributed` et `actor=null` : l’écriture ne renseignait pas ce contexte, par exemple un ancien backend. Afficher « Auteur non renseigné » ; ne pas déduire un auteur de la dernière confirmation ou du rôle SQL partagé.

Après une modification, invalider l’historique, la fiche source et les vues ou reçus dont la visibilité dépend de cette source. Une suppression de son propre accès peut réussir avec200, puis rendre l’historique inaccessible avec404. Le frontend doit pouvoir fermer cette vue et rafraîchir ses listes.

`limit` vaut20 par défaut, de1 à100. `after` reçoit le UUID opaque `next_after` de la page précédente. Les événements sont triés par ordinal interne croissant, pas par ordre lexical des UUID ni uniquement par horodatage. Un curseur d’une autre source, d’un autre domaine ou d’un autre tenant est refusé404. `next_after=null` marque la fin actuellement observée ; les nouvelles écritures peuvent allonger l’historique. Une actualisation depuis le début permet de les afficher.

Un membre non propriétaire reçoit403 ; un propriétaire sans accès courant à la source reçoit404. Les paramètres invalides donnent422. HTTP et MCP appliquent les mêmes contrôles ; en MCP, lire `structuredContent.http_status` et `isError`, pas seulement le HTTP200 de transport.

## Migration et limites

La migration0025 ajoute `cf_source_access_events`, avec RLS forcée, lecture seule pour le rôle applicatif et protection contre la modification ou suppression d’un événement. Un déclencheur PostgreSQL capture également les modifications d’anciens exécutables. Il utilise une fonction à privilèges définis, un chemin de recherche fixe et une table explicitement qualifiée ; le rôle applicatif ne reçoit pas le droit de fabriquer des événements.

L’installation prend un verrou sur les sources et attend les écritures déjà engagées. L’historique commence à cette installation : `history_scope=changes_since_audit_migration`. Les écritures terminées auparavant ne sont pas reconstruites. Prévoir une fenêtre de migration adaptée à l’activité ; le mécanisme ne constitue pas une migration sans interruption garantie. Aucune révision optimiste, motif obligatoire ou clé d’idempotence supplémentaire n’est ajoutée au PUT.

Cette livraison concerne le journal des droits des sources ; les décisions sur les rôles restent dans l’historique des appartenances, et les publications dans leurs propres reçus. La sauvegarde coordonnée inclut cette table comme les autres données SQL.
