# Extensions natives Rust — graphes et gouvernance

Généré par `scripts/export_rust_contracts.py` depuis `services/rust-core/contracts/extensions.json`. Ne pas modifier directement. Le catalogue machine est `packages/contracts/rust-extensions.json` (section `functional` pour les descriptions françaises).

Ces **77 opérations HTTP et MCP** complètent les 79 opérations de référence. Lire le [guide frontend](frontend-guide.fr.md) et les contrats servis par le runtime Rust.

## Règles communes

- Les rôles listés sont des prérequis ; tenant, domaine, droits sur les preuves et propriété des objets personnels restent contrôlés par le serveur.
- Sur les routes protégées, envoyer `Authorization: Bearer …` et `X-Tenant-ID`. Le jeton provient de l'hôte authentifié, jamais d'un modèle.
- En Rust, les actions sensibles requièrent toujours `X-Cortex-Confirmation` en HTTP et MCP. La référence Python applique aussi cette règle par défaut (`CORTEX_HTTP_CONFIRMATION_MODE=required`). Son mode HTTP `trusted_host` est une compatibilité explicite réservée à un hôte qui recueille les décisions ; il ne concerne pas Rust et ne désactive jamais les confirmations MCP.
- Pour une reprise, conserver la clé d'idempotence uniquement si le schéma ou les paramètres la prévoient. Sans clé, ne pas répéter aveuglément une écriture.
- Les réponses d'erreur sont `{error, message?, details?}`. Les statuts ci-dessous sont le contrat déclaré commun, pas la preuve que chaque erreur est atteignable sur chaque route.
- Les champs absents et `null` sont distincts. Les bornes et champs requis sont repris du schéma ; des règles métier supplémentaires sont contrôlées à l'exécution.

## Index

| Action | HTTP | Fonction |
|---|---|---|
| [proposals.publication_attempts](#action-proposals-publication_attempts) | `GET /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts` | Inspecte les tentatives de publication de cette proposition et celle encore active. |
| [proposals.retry_publication](#action-proposals-retry_publication) | `POST /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts` | Prépare une nouvelle tentative de publication pour remplacer cette préparation incertaine. |
| [proposals.publication_events](#action-proposals-publication_events) | `GET /v1/domains/{domain}/proposals/{proposal_id}/publication-events` | Montre les événements de préparation et de reprise de cette publication. |
| [graph.import_published](#action-graph-import_published) | `POST /v1/domains/{domain}/graph-import` | Enregistre cette version publiée et son contenu exact dans le graphe immuable. |
| [graph.import_attempts](#action-graph-import_attempts) | `GET /v1/domains/{domain}/graph-import-attempts` | Inspecte la migration de cette version et la concordance entre journal et projection. |
| [graph.retry_import](#action-graph-retry_import) | `POST /v1/domains/{domain}/graph-import-attempts` | Remplace cette tentative d’import incertaine par une nouvelle tentative du contenu confirmé. |
| [graph.import_events](#action-graph-import_events) | `GET /v1/domains/{domain}/graph-import-events` | Affiche le journal des tentatives de migration de cette version. |
| [sources.access_events](#action-sources-access_events) | `GET /v1/domains/{domain}/sources/{source_id}/access-events` | Montre qui a changé les accès à cette source et les droits avant/après. |
| [publications.list](#action-publications-list) | `GET /v1/domains/{domain}/publications` | Consulter les publications récentes de ce domaine. |
| [graph.window](#action-graph-window) | `GET /v1/domains/{domain}/graph/window` | Explorer une page de concepts ou le voisinage d’un concept publié. |
| [proposals.diff_summary](#action-proposals-diff_summary) | `GET /v1/domains/{domain}/proposals/{proposal_id}/diff/summary` | Consulter les changements et leurs preuves sans télécharger le texte complet des concepts. |
| [graph.map](#action-graph-map) | `GET /v1/domains/{domain}/graph/map` | Naviguer spatialement entre les concepts publiés et leurs liens sourcés. |
| [graph.scene](#action-graph-scene) | `GET /v1/domains/{domain}/graph/scene` | Explorer progressivement une zone du cerveau et retrouver tous ses concepts et liens autorisés. |
| [graph.map_nodes](#action-graph-map_nodes) | `GET /v1/domains/{domain}/graph/map/nodes` | Explorer progressivement une zone du cerveau et retrouver tous ses concepts et liens autorisés. |
| [drafts.read](#action-drafts-read) | `GET /v1/domains/{domain}/conversation-drafts/{draft_key}` | Lis mon brouillon personnel. |
| [drafts.save](#action-drafts-save) | `POST /v1/domains/{domain}/conversation-drafts/{draft_key}` | Enregistre ce brouillon personnel sans poser la question. |
| [tasks.list](#action-tasks-list) | `GET /v1/domains/{domain}/tasks` | Consulter ou traiter ma tâche de travail de domaine. |
| [tasks.create](#action-tasks-create) | `POST /v1/domains/{domain}/tasks` | Consulter ou traiter ma tâche de travail de domaine. |
| [tasks.read](#action-tasks-read) | `GET /v1/domains/{domain}/tasks/{task_id}` | Consulter ou traiter ma tâche de travail de domaine. |
| [tasks.command](#action-tasks-command) | `POST /v1/domains/{domain}/tasks/{task_id}/commands` | Consulter ou traiter ma tâche de travail de domaine. |
| [tasks.events](#action-tasks-events) | `GET /v1/domains/{domain}/tasks/{task_id}/events` | Consulter ou traiter ma tâche de travail de domaine. |
| [tasks.candidates](#action-tasks-candidates) | `GET /v1/domains/{domain}/tasks/candidates` | Consulter ou traiter ma tâche de travail de domaine. |
| [task_notifications.list](#action-task_notifications-list) | `GET /v1/domains/{domain}/task-notifications` | Consulter ou traiter ma tâche de travail de domaine. |
| [task_notifications.read](#action-task_notifications-read) | `POST /v1/domains/{domain}/task-notifications/{event_id}/read` | Consulter ou traiter ma tâche de travail de domaine. |
| [cases.list](#action-cases-list) | `GET /v1/domains/{domain}/shared-cases` | Prépare, partage ou suis explicitement un extrait minimal avec des coordinateurs nommés. |
| [cases.recipients](#action-cases-recipients) | `GET /v1/domains/{domain}/shared-cases/recipients` | Prépare, partage ou suis explicitement un extrait minimal avec des coordinateurs nommés. |
| [cases.prepare](#action-cases-prepare) | `POST /v1/domains/{domain}/shared-cases/prepare` | Prépare, partage ou suis explicitement un extrait minimal avec des coordinateurs nommés. |
| [cases.share](#action-cases-share) | `POST /v1/domains/{domain}/shared-cases/share` | Prépare, partage ou suis explicitement un extrait minimal avec des coordinateurs nommés. |
| [cases.read](#action-cases-read) | `GET /v1/domains/{domain}/shared-cases/{case_id}` | Prépare, partage ou suis explicitement un extrait minimal avec des coordinateurs nommés. |
| [cases.command](#action-cases-command) | `POST /v1/domains/{domain}/shared-cases/{case_id}/commands` | Prépare, partage ou suis explicitement un extrait minimal avec des coordinateurs nommés. |
| [cases.events](#action-cases-events) | `GET /v1/domains/{domain}/shared-cases/{case_id}/events` | Prépare, partage ou suis explicitement un extrait minimal avec des coordinateurs nommés. |
| [task_proposals.list](#action-task_proposals-list) | `GET /v1/domains/{domain}/tasks/{task_id}/proposals` | Relier une proposition à ma tâche et rendre un avis expert non décisionnel. |
| [task_proposals.link](#action-task_proposals-link) | `POST /v1/domains/{domain}/tasks/{task_id}/proposals` | Relier une proposition à ma tâche et rendre un avis expert non décisionnel. |
| [expert_reviews.list](#action-expert_reviews-list) | `GET /v1/domains/{domain}/tasks/{task_id}/proposals/{proposal_id}/expert-reviews` | Relier une proposition à ma tâche et rendre un avis expert non décisionnel. |
| [expert_reviews.submit](#action-expert_reviews-submit) | `POST /v1/domains/{domain}/tasks/{task_id}/expert-reviews` | Relier une proposition à ma tâche et rendre un avis expert non décisionnel. |
| [proposals.expert_reviews](#action-proposals-expert_reviews) | `GET /v1/domains/{domain}/proposals/{proposal_id}/expert-reviews` | Lire les avis experts autorisés avant une décision de domaine. |
| [imports.command_state](#action-imports-command_state) | `GET /v1/domains/{domain}/imports/{import_id}/command-state` | Relire le lot personnel, son empreinte et ses actions éligibles. |
| [imports.command](#action-imports-command) | `POST /v1/domains/{domain}/imports/{import_id}/commands` | Traiter, remettre en attente les échecs ou arrêter les éléments en attente, avec état attendu et reçu idempotent. |
| [tasks.brief](#action-tasks-brief) | `GET /v1/domains/{domain}/work-brief` | Que dois-je faire dans ce domaine ? |
| [contribution_drafts.read](#action-contribution_drafts-read) | `GET /v1/domains/{domain}/contribution-draft` | Lire mon brouillon de contribution. |
| [contribution_drafts.save](#action-contribution_drafts-save) | `POST /v1/domains/{domain}/contribution-draft` | Enregistrer explicitement mon brouillon de contribution privé. |
| [case_tasks.list](#action-case_tasks-list) | `GET /v1/domains/{domain}/shared-cases/{case_id}/tasks` | Suivre ou associer explicitement le travail lié à un dossier partagé. |
| [case_tasks.command](#action-case_tasks-command) | `POST /v1/domains/{domain}/shared-cases/{case_id}/tasks` | Suivre ou associer explicitement le travail lié à un dossier partagé. |
| [work_overview.read](#action-work_overview-read) | `GET /v1/domains/{domain}/work-overview` | Quel travail autorisé dois-je traiter ou suivre ? |
| [tasks.plan](#action-tasks-plan) | `POST /v1/domains/{domain}/tasks/{task_id}/plan` | Planifier explicitement la priorité et l’échéance d’une tâche |
| [task_receipts.list](#action-task_receipts-list) | `GET /v1/domains/{domain}/task-command-receipts` | Retrouver mes actions de travail enregistrées après interruption. |
| [task_receipts.read](#action-task_receipts-read) | `GET /v1/domains/{domain}/task-command-receipts/{command_id}` | Retrouver mes actions de travail enregistrées après interruption. |
| [reference_drafts.list](#action-reference_drafts-list) | `GET /v1/domains/{domain}/reference-drafts` | Préparer mes questions de référence privées et sourcées. |
| [reference_drafts.read](#action-reference_drafts-read) | `GET /v1/domains/{domain}/reference-drafts/{question}` | Préparer mes questions de référence privées et sourcées. |
| [reference_drafts.save](#action-reference_drafts-save) | `POST /v1/domains/{domain}/reference-drafts/{question}` | Préparer mes questions de référence privées et sourcées. |
| [reference_draft_receipts.read](#action-reference_draft_receipts-read) | `GET /v1/domains/{domain}/reference-draft-receipts/{command_id}` | Vérifier ma sauvegarde privée sans la renvoyer. |
| [reference_reviewers.list](#action-reference_reviewers-list) | `GET /v1/domains/{domain}/reference-drafts/{question}/reviewers` | Soumettre une version figée à un responsable nommé et suivre son avis. |
| [reference_reviews.prepare](#action-reference_reviews-prepare) | `POST /v1/domains/{domain}/reference-reviews/prepare` | Soumettre une version figée à un responsable nommé et suivre son avis. |
| [reference_reviews.submit](#action-reference_reviews-submit) | `POST /v1/domains/{domain}/reference-reviews/submit` | Soumettre une version figée à un responsable nommé et suivre son avis. |
| [reference_reviews.list](#action-reference_reviews-list) | `GET /v1/domains/{domain}/reference-reviews` | Soumettre une version figée à un responsable nommé et suivre son avis. |
| [reference_reviews.read](#action-reference_reviews-read) | `GET /v1/domains/{domain}/reference-reviews/{review}` | Soumettre une version figée à un responsable nommé et suivre son avis. |
| [reference_reviews.command](#action-reference_reviews-command) | `POST /v1/domains/{domain}/reference-reviews/{review}/commands` | Soumettre une version figée à un responsable nommé et suivre son avis. |
| [reference_review_receipts.read](#action-reference_review_receipts-read) | `GET /v1/domains/{domain}/reference-review-receipts/{command_id}` | Soumettre une version figée à un responsable nommé et suivre son avis. |
| [reference_reviews.events](#action-reference_reviews-events) | `GET /v1/domains/{domain}/reference-reviews/{review}/events` | Lire l’historique de cette revue de référence. |
| [agent_missions.list](#action-agent_missions-list) | `GET /v1/domains/{domain}/agent-missions` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.candidates](#action-agent_missions-candidates) | `GET /v1/domains/{domain}/agent-missions/candidates` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.prepare](#action-agent_missions-prepare) | `POST /v1/domains/{domain}/agent-missions/prepare` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.create](#action-agent_missions-create) | `POST /v1/domains/{domain}/agent-missions/create` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.read](#action-agent_missions-read) | `GET /v1/domains/{domain}/agent-missions/{mission}` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.command](#action-agent_missions-command) | `POST /v1/domains/{domain}/agent-missions/{mission}/commands` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.read_source](#action-agent_missions-read_source) | `POST /v1/domains/{domain}/agent-missions/{mission}/read-source` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.complete](#action-agent_missions-complete) | `POST /v1/domains/{domain}/agent-missions/{mission}/complete` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.events](#action-agent_missions-events) | `GET /v1/domains/{domain}/agent-missions/{mission}/events` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.receipt](#action-agent_missions-receipt) | `GET /v1/domains/{domain}/agent-mission-receipts/{command}` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.controls](#action-agent_missions-controls) | `GET /v1/domains/{domain}/agent-mission-controls` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.control](#action-agent_missions-control) | `GET /v1/domains/{domain}/agent-mission-controls/{mission}` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [agent_missions.evidence](#action-agent_missions-evidence) | `GET /v1/domains/{domain}/agent-missions/{mission}/evidence/{index}` | Préparer, suivre ou exécuter un mandat borné de lecture et rapport candidat. |
| [work_activity.list](#action-work_activity-list) | `GET /v1/domains/{domain}/work-activity` | Lire les événements personnels et marquer leur lecture, sans transition métier. |
| [work_activity.read](#action-work_activity-read) | `POST /v1/domains/{domain}/work-activity/{event}/read` | Lire les événements personnels et marquer leur lecture, sans transition métier. |
| [companion_guides.list](#action-companion_guides-list) | `GET /v1/companion-guides` | Lire six guides publics de parcours MCP, sans exécuter une action. |
| [sources.passage](#action-sources-passage) | `GET /v1/domains/{domain}/sources/{source_id}/passage` | Lire une source progressivement ou son passage exact sous droits courants. |
| [sources.locate](#action-sources-locate) | `POST /v1/domains/{domain}/sources/{source_id}/locate` | Localiser ou vérifier un extrait exact sans transporter le corps source. |

<a id="action-proposals-publication_attempts"></a>
## proposals.publication_attempts

Liste les tentatives immuables d’une proposition acceptée, leur génération, leur auteur et leur état connu. Recontrôle le rôle propriétaire et l’accès actuel aux preuves. Ne contacte pas TerminusDB et ne relance aucun traitement.

**Utilisation frontend :** Présenter l’historique de reprise et la tentative active ; conserver son UUID, sa génération et la version publiée pour préparer une décision exacte.

- HTTP : `GET /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts`.
- MCP : `api_proposals_publication_attempts` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `proposal_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `50` |
| query | `after` | non | entier | minimum : `0`; maximum : `9223372036854775806` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [GraphPublicationAttemptPage](#schema-graphpublicationattemptpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-retry_publication"></a>
## proposals.retry_publication

Après confirmation signée du propriétaire, vérifie la tentative attendue, crée si nécessaire une nouvelle tentative durable et une base Terminus privée, puis tente de publier. Une préparation complète doit être rapprochée par la publication normale. Les anciens workers ne peuvent plus activer leur ancien état. Le reçu peut rester unresolved sans publication réussie. Le statut201 est également retourné au rejeu d’une clé personnelle déjà enregistrée. Le motif doit contenir un caractère non blanc.

**Utilisation frontend :** Faire confirmer cible, version publiée, UUID/génération à remplacer et motif. Conserver la clé par intention. Afficher published seulement si le reçu le dit ; après une incertitude, relire le reçu et ne jamais inventer une nouvelle clé automatiquement.

- HTTP : `POST /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts`.
- MCP : `api_proposals_retry_publication` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Acceptation ou publication selon l'opération ; consulter le reçu.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `proposal_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [GraphPublicationRetryInput](#schema-graphpublicationretryinput).
- Succès HTTP 201, `application/json` : [GraphPublicationRetryReceipt](#schema-graphpublicationretryreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-proposals-publication_events"></a>
## proposals.publication_events

Parcourt le journal immuable des réservations, résultats incertains, activations et remplacements de tentatives, filtré par les droits courants sur la proposition. Les événements décrivent l’état applicatif connu, pas une preuve que toute ancienne requête moteur est terminée.

**Utilisation frontend :** Afficher la chronologie de reprise avec auteur, date et génération ; poursuivre le curseur reçu pour charger l’historique suivant.

- HTTP : `GET /v1/domains/{domain}/proposals/{proposal_id}/publication-events`.
- MCP : `api_proposals_publication_events` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `proposal_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `50` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [GraphPublicationEventPage](#schema-graphpublicationeventpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-graph-import_published"></a>
## graph.import_published

Après confirmation signée du propriétaire, reconstruit le graphe entier depuis le journal et vérifie chaque preuve accessible, les relations et la concordance de la projection SQL. Réserve une tentative durable avant tout transfert. Une tentative déjà scellée est seulement relue dans TerminusDB ; un manifeste existant est retourné sans écriture moteur. Ne modifie ni les versions métier, ni les validations, ni le journal de connaissance. registered signifie manifeste enregistré, sans certifier la disponibilité instantanée du moteur.

**Utilisation frontend :** Lire le diagnostic des tentatives pour obtenir version et empreinte exactes, puis faire confirmer ces deux valeurs. Afficher le reçu registered/unresolved. Une réponse incertaine se rapproche avec la même action et le même contenu ; un nouveau transfert exige une reprise distincte et explicite.

- HTTP : `POST /v1/domains/{domain}/graph-import`.
- MCP : `api_graph_import_published` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Acceptation ou publication selon l'opération ; consulter le reçu.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [GraphImportInput](#schema-graphimportinput).
- Succès HTTP 200, `application/json` : [GraphImportReceipt](#schema-graphimportreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-graph-import_attempts"></a>
## graph.import_attempts

Retourne l’identité canonique du graphe publié, la présence du manifeste et les tentatives d’import uniquement. Sans version, cible la version publiée courante ; une version historique est autorisée avec accès actuel à toutes ses preuves. Le diagnostic de projection vaut null pour une version historique. Une tentative héritée non scellée expose une empreinte et un nombre de concepts null. Aucun appel moteur.

**Utilisation frontend :** Afficher les divergences avant de proposer un import. Conserver UUID/génération de la tentative active, version cible et empreinte du journal pour une reprise. Ne pas interpréter manifest_registered comme un contrôle de santé TerminusDB.

- HTTP : `GET /v1/domains/{domain}/graph-import-attempts`.
- MCP : `api_graph_import_attempts` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `version` | non | entier | minimum : `0`; maximum : `9223372036854775807` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `50` |
| query | `after` | non | entier | minimum : `0`; maximum : `9223372036854775806`; défaut : `0` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [GraphImportAttemptPage](#schema-graphimportattemptpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-graph-retry_import"></a>
## graph.retry_import

Confirme la version courante, l’empreinte désirée, l’UUID/génération attendus et un motif non blanc. Crée un nouvel UUID de base privée et une génération, en conservant les intentions anciennes immuables. Peut remplacer une préparation héritée non scellée ou une ancienne empreinte après réparation de la projection, uniquement sans manifeste à la version courante. Une clé personnelle déjà enregistrée ne recrée jamais la base. Une préparation identique complète exige un rapprochement par l’import normal. Le statut 201 est aussi retourné au rejeu ; seul outcome indique le résultat.

**Utilisation frontend :** Expliquer le changement d’empreinte éventuel et faire confirmer la décision exacte. Conserver une clé stable par intention, relire après timeout, afficher registered/unresolved/superseded. Ne pas créer une autre clé ou remplacer une tentative automatiquement.

- HTTP : `POST /v1/domains/{domain}/graph-import-attempts`.
- MCP : `api_graph_retry_import` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Acceptation ou publication selon l'opération ; consulter le reçu.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [GraphImportRetryInput](#schema-graphimportretryinput).
- Succès HTTP 201, `application/json` : [GraphImportReceipt](#schema-graphimportreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-graph-import_events"></a>
## graph.import_events

Liste les événements immuables d’import et de reprise du graphe, à la version courante par défaut ou à une version historique autorisée. Exclut les événements de publication. Pagination par curseur opaque, bornée à 100 éléments. Les états décrivent ce que l’application sait, pas la terminaison de toutes les anciennes requêtes moteur.

**Utilisation frontend :** Afficher date, acteur et génération ; utiliser next_after pour poursuivre le journal. Le curseur appartient au domaine et à la version sélectionnés.

- HTTP : `GET /v1/domains/{domain}/graph-import-events`.
- MCP : `api_graph_import_events` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `version` | non | entier | minimum : `0`; maximum : `9223372036854775807` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `50` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [GraphPublicationEventPage](#schema-graphpublicationeventpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-access_events"></a>
## sources.access_events

Liste les changements effectifs des accès à une source depuis la migration0025. Le journal est enregistré atomiquement avec chaque modification SQL, y compris par les anciens exécutables. actor_source=runtime_context indique le contexte déclaré par le runtime ; unattributed et actor=null indiquent un auteur non renseigné. Aucun passé ni auteur inconnu n’est reconstruit.

**Utilisation frontend :** Afficher avant/après, date et auteur ou « Auteur non renseigné ». Après un changement d’accès, invalider cette liste et les vues dépendantes de la source. Paginer avec next_after ; le curseur appartient à cette source. Un propriétaire qui retire son propre accès reçoit ensuite404 sur cet historique.

- HTTP : `GET /v1/domains/{domain}/sources/{source_id}/access-events`.
- MCP : `api_sources_access_events` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SourceAccessEventPage](#schema-sourceaccesseventpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-publications-list"></a>
## publications.list

Lire les publications récentes autorisées, par séquence décroissante, à version publiée fixe. Chaque requête examine au plus 100 commits et retourne au plus 50 résumés ; une page peut être vide avec un curseur de continuation. Les droits sont revérifiés à chaque page.

**Utilisation frontend :** BrainMap et Chronique : fixer at_version, since et until pour parcourir les pages avec next_before. Une publication sans audit est retournée avec publication null ; ne pas inventer sa date. Un curseur non nul indique une couverture partielle. Le graphe et les différences sont lus séparément.

- HTTP : `GET /v1/domains/{domain}/publications`.
- MCP : `api_publications_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50`; défaut : `20` |
| query | `at_version` | non | entier | minimum : `0`; maximum : `9007199254740990` |
| query | `before` | non | entier | minimum : `1`; maximum : `9007199254740991` |
| query | `since` | non | texte | format : `"date-time"` |
| query | `until` | non | texte | format : `"date-time"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [PublicationWindow](#schema-publicationwindow).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-graph-window"></a>
## graph.window

Lire une page du graphe publié autorisé, ou du voisinage entrant et sortant d’un concept. Au plus 50 résumés sans corps ni preuves et 120 relations entre les concepts de la page. Les compteurs incluent uniquement les objets accessibles. Le serveur lit encore le snapshot complet.

**Utilisation frontend :** BrainMap : conserver at_version et visibility avec next_after. Une modification de version ou de visibilité retourne 409 et impose de remplacer les anciennes pages. Le voisinage inclut son concept central et ses voisins directs. L’ordre est celui des UUID, pas un classement sémantique. Les relations tronquées et les relations sortant de la page sont comptées séparément. Cette fenêtre ne constitue pas encore une agrégation de territoires. Le focus est conservé dans chaque page (limit inclut ce résumé). previous_before permet le retour, locate positionne une sélection hors page. direction=outgoing fournit aussi tous les scope_ids du voisinage, au plus 101 identifiants. search effectue une recherche littérale Unicode sans distinction de casse dans le titre ou le corps, sans retirer les accents.

- HTTP : `GET /v1/domains/{domain}/graph/window`.
- MCP : `api_graph_window` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, contributor, corpus_manager, viewer, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50`; défaut : `24` |
| query | `at_version` | non | entier | minimum : `0`; maximum : `9007199254740990` |
| query | `visibility` | non | texte | motif : `"^[0-9a-f]{64}$"` |
| query | `after` | non | texte | format : `"uuid"` |
| query | `focus` | non | texte | format : `"uuid"` |
| query | `before` | non | texte | format : `"uuid"` |
| query | `locate` | non | texte | format : `"uuid"` |
| query | `direction` | non | `"both"`, `"outgoing"` | défaut : `"both"` |
| query | `search` | non | texte | longueur min. : `1`; longueur max. : `100` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [GraphWindow](#schema-graphwindow).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-diff_summary"></a>
## proposals.diff_summary

Lire une différence de proposition autorisée sans transmettre les corps des concepts. Chaque corps est remplacé par son empreinte SHA-256 UTF-8 ; titres, maturité, références de preuves et relations restent identiques. Au plus 50 éléments de changement. Cette lecture partage les contrôles de droits et de version de proposals.diff.

**Utilisation frontend :** Chronique : comparer body_sha256 pour détecter un changement de contenu sans télécharger le texte. Garder les identités et compteurs inchangés. Lire le corps courant avec concepts.read et les extraits avec sources.read sur sélection. Seules les publications auditées deviennent des événements ; une proposition approuvée ne constitue pas un apprentissage publié. Les liens et les coûts de lecture serveur ne sont pas réduits par cette projection.

- HTTP : `GET /v1/domains/{domain}/proposals/{proposal_id}/diff/summary`.
- MCP : `api_proposals_diff_summary` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, agent, contributor, corpus_manager.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `proposal_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ProposalDifferenceSummary](#schema-proposaldifferencesummary).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-graph-map"></a>
## graph.map

Lire la topologie compacte du savoir publié accessible, sans corps de concepts. Limites explicites : 10 000 concepts, 200 000 relations publiées, 200 000 références documentaires et 8 Mo. Refus au-delà ; aucune troncature silencieuse.

**Utilisation frontend :** Carte spatiale à zoom continu. Les références documentaires proviennent d’un index privé optionnel et sont exposées uniquement si les empreintes des corps et de toutes les sources correspondent encore. Elles ne sont pas des relations Cortex approuvées. Les droits sur les deux extrémités sont revérifiés à chaque lecture. Ce contrat charge les métadonnées globales ; il ne remplace pas une future lecture par tuiles ni la qualification de charge.

- HTTP : `GET /v1/domains/{domain}/graph/map`.
- MCP : `api_graph_map` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, contributor, corpus_manager, viewer, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [GraphMap](#schema-graphmap).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-graph-scene"></a>
## graph.scene

Lire une zone spatiale agrégée ou une page de concepts/voisins autorisés, sans corps, avec borne de réponse 64 Kio. Chaque requête revérifie les droits des sources et des deux extrémités. Les coordonnées sont déterministes pour une publication et une disposition.

**Utilisation frontend :** La scène contient au plus 24 glyphes, dont au plus huit repères individuels supplémentaires, et 120 tracés. Les regroupements gardent leur population pendant le déplacement. Une recherche non vide contient au plus huit éléments, les autres pages au plus 16. Utiliser page_size retourné par le serveur pour paginer ; offset positif exige version et empreinte de visibilité. Les totaux sont autorisés et distincts des seuls objets dessinés. Le calcul serveur utilise encore la projection globale bornée ; ce contrat ne qualifie pas son coût ni la capacité Step 1.

- HTTP : `GET /v1/domains/{domain}/graph/scene`.
- MCP : `api_graph_scene` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, contributor, corpus_manager, viewer, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `layout` | non | `"territories"`, `"fireworks"`, `"circle"`, `"lines"` | — |
| query | `focus` | non | texte | format : `"uuid"` |
| query | `at_version` | non | entier | minimum : `0` |
| query | `visibility` | non | texte | motif : `"^[a-f0-9]{64}$"` |
| query | `x` | non | nombre | — |
| query | `y` | non | nombre | — |
| query | `w` | non | nombre | — |
| query | `h` | non | nombre | — |
| query | `target` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [GraphScene](#schema-graphscene).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-graph-map_nodes"></a>
## graph.map_nodes

Lire une zone spatiale agrégée ou une page de concepts/voisins autorisés, sans corps, avec borne de réponse 64 Kio. Chaque requête revérifie les droits des sources et des deux extrémités. Les coordonnées sont déterministes pour une publication et une disposition.

**Utilisation frontend :** La scène contient au plus 24 glyphes, dont au plus huit repères individuels supplémentaires, et 120 tracés. Les regroupements gardent leur population pendant le déplacement. Une recherche non vide contient au plus huit éléments, les autres pages au plus 16. Utiliser page_size retourné par le serveur pour paginer ; offset positif exige version et empreinte de visibilité. Les totaux sont autorisés et distincts des seuls objets dessinés. Le calcul serveur utilise encore la projection globale bornée ; ce contrat ne qualifie pas son coût ni la capacité Step 1.

- HTTP : `GET /v1/domains/{domain}/graph/map/nodes`.
- MCP : `api_graph_map_nodes` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, contributor, corpus_manager, viewer, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `layout` | non | `"territories"`, `"fireworks"`, `"circle"`, `"lines"` | — |
| query | `focus` | non | texte | format : `"uuid"` |
| query | `at_version` | non | entier | minimum : `0` |
| query | `visibility` | non | texte | motif : `"^[a-f0-9]{64}$"` |
| query | `search` | non | texte | longueur max. : `200` |
| query | `offset` | non | entier | minimum : `0`; maximum : `400000` |
| query | `kind` | non | `"all"`, `"reference"`, `"structural"`, `"associative"` | — |
| query | `direction` | non | `"both"`, `"in"`, `"out"` | — |
| query | `target` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [MapNodePage](#schema-mapnodepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-drafts-read"></a>
## drafts.read

Lire le brouillon privé courant.

**Utilisation frontend :** Accès personnel, sans dérogation owner. Ne pas écraser le texte local à la lecture. Un conflit 409 impose une comparaison explicite. Aucun envoi de question ni partage. Un reçu ne contient pas le texte ; le réessai identique ne remplace jamais une sauvegarde ultérieure.

- HTTP : `GET /v1/domains/{domain}/conversation-drafts/{draft_key}`.
- MCP : `api_drafts_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `draft_key` | oui | texte | motif : `"^(?:new&#124;[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})$"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ConversationDraft](#schema-conversationdraft).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-drafts-save"></a>
## drafts.save

Enregistrer explicitement un brouillon privé avec révision attendue et reçu idempotent.

**Utilisation frontend :** Accès personnel, sans dérogation owner. Ne pas écraser le texte local à la lecture. Un conflit 409 impose une comparaison explicite. Aucun envoi de question ni partage. Un reçu ne contient pas le texte ; le réessai identique ne remplace jamais une sauvegarde ultérieure.

- HTTP : `POST /v1/domains/{domain}/conversation-drafts/{draft_key}`.
- MCP : `api_drafts_save` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `draft_key` | oui | texte | motif : `"^(?:new&#124;[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})$"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ConversationDraftInput](#schema-conversationdraftinput).
- Succès HTTP 200, `application/json` : [ConversationDraftReceipt](#schema-conversationdraftreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-tasks-list"></a>
## tasks.list

File visible triée par création puis identifiant croissants, total exact dans ce périmètre. Curseur opaque15min lié à identité, filtres, taille et révisions ; changement de travail/droits retourne409 et impose de recommencer.

**Utilisation frontend :** Contrôler les capacités courantes. Préparer puis confirmer toute transition de travail ; timeout = résultat inconnu. Une tâche terminée ne publie pas de savoir. Activité personnelle filtrée par les droits actuels ; aucun message externe.

- HTTP : `GET /v1/domains/{domain}/tasks`.
- MCP : `api_tasks_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | longueur max. : `200` |
| query | `active_only` | non | booléen | — |
| query | `assigned_to_me` | non | booléen | — |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [WorkTaskPage](#schema-worktaskpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-tasks-create"></a>
## tasks.create

Créer explicitement une tâche autonome de domaine, sans copier de conversation ou signal personnel.

**Utilisation frontend :** Contrôler les capacités courantes. Préparer puis confirmer toute transition de travail ; timeout = résultat inconnu. Une tâche terminée ne publie pas de savoir. Activité personnelle filtrée par les droits actuels ; aucun message externe.

- HTTP : `POST /v1/domains/{domain}/tasks`.
- MCP : `api_tasks_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [WorkTaskCreate](#schema-worktaskcreate).
- Succès HTTP 200, `application/json` : [WorkTaskReceipt](#schema-worktaskreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-tasks-read"></a>
## tasks.read

Lire une tâche et ses actions actuellement autorisées.

**Utilisation frontend :** Contrôler les capacités courantes. Préparer puis confirmer toute transition de travail ; timeout = résultat inconnu. Une tâche terminée ne publie pas de savoir. Activité personnelle filtrée par les droits actuels ; aucun message externe.

- HTTP : `GET /v1/domains/{domain}/tasks/{task_id}`.
- MCP : `api_tasks_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `task_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [WorkTask](#schema-worktask).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-tasks-command"></a>
## tasks.command

Enregistrer une transition motivée, avec révision attendue et reçu idempotent, sans publier de savoir.

**Utilisation frontend :** Contrôler les capacités courantes. Préparer puis confirmer toute transition de travail ; timeout = résultat inconnu. Une tâche terminée ne publie pas de savoir. Activité personnelle filtrée par les droits actuels ; aucun message externe.

- HTTP : `POST /v1/domains/{domain}/tasks/{task_id}/commands`.
- MCP : `api_tasks_command` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `task_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [WorkTaskCommand](#schema-worktaskcommand).
- Succès HTTP 200, `application/json` : [WorkTaskReceipt](#schema-worktaskreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-tasks-events"></a>
## tasks.events

Lire le journal immuable de la tâche selon les droits courants.

**Utilisation frontend :** Contrôler les capacités courantes. Préparer puis confirmer toute transition de travail ; timeout = résultat inconnu. Une tâche terminée ne publie pas de savoir. Activité personnelle filtrée par les droits actuels ; aucun message externe.

- HTTP : `GET /v1/domains/{domain}/tasks/{task_id}/events`.
- MCP : `api_tasks_events` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `task_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | longueur max. : `200` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [WorkTaskEventPage](#schema-worktaskeventpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-tasks-candidates"></a>
## tasks.candidates

Lister les membres humains éligibles à une affectation, pour le coordinateur.

**Utilisation frontend :** Contrôler les capacités courantes. Préparer puis confirmer toute transition de travail ; timeout = résultat inconnu. Une tâche terminée ne publie pas de savoir. Activité personnelle filtrée par les droits actuels ; aucun message externe.

- HTTP : `GET /v1/domains/{domain}/tasks/candidates`.
- MCP : `api_tasks_candidates` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | longueur max. : `200` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [TaskCandidatePage](#schema-taskcandidatepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-task_notifications-list"></a>
## task_notifications.list

Activité personnelle des tâches encore visibles, événements les plus récents en premier. Compteurs exacts du périmètre, curseur opaque15min ; une lecture personnelle modifiée invalide aussi sa pagination.

**Utilisation frontend :** Contrôler les capacités courantes. Préparer puis confirmer toute transition de travail ; timeout = résultat inconnu. Une tâche terminée ne publie pas de savoir. Activité personnelle filtrée par les droits actuels ; aucun message externe.

- HTTP : `GET /v1/domains/{domain}/task-notifications`.
- MCP : `api_task_notifications_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | longueur max. : `200` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [TaskNotificationPage](#schema-tasknotificationpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-task_notifications-read"></a>
## task_notifications.read

Marquer un événement personnel comme lu, sans transition métier. Répéter le même événement conserve read_at ; une clé réutilisée pour une autre cible est refusée.

**Utilisation frontend :** Contrôler les capacités courantes. Préparer puis confirmer toute transition de travail ; timeout = résultat inconnu. Une tâche terminée ne publie pas de savoir. Activité personnelle filtrée par les droits actuels ; aucun message externe.

- HTTP : `POST /v1/domains/{domain}/task-notifications/{event_id}/read`.
- MCP : `api_task_notifications_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `event_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [TaskNotificationRead](#schema-tasknotificationread).
- Succès HTTP 200, `application/json` : [TaskNotificationReceipt](#schema-tasknotificationreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-cases-list"></a>
## cases.list

Dossier volontaire distinct du signal personnel. DTO déclarant/équipe séparés et témoin sans contenu après retrait. Préparation5min liée à charge, acteur et droits ; partager seulement après accord explicite sur extrait et destinataires.

**Utilisation frontend :** Afficher exactement titre/extrait/destinataires/politique avant accord. Ne jamais copier une conversation automatiquement. Préparer puis partager la même charge ; retry exact de clé si résultat inconnu. Une clôture sans changement ne publie rien.

- HTTP : `GET /v1/domains/{domain}/shared-cases`.
- MCP : `api_cases_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | format : `"uuid"` |
| query | `scope` | non | `"mine"`, `"team"` | — |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SharedCasePage](#schema-sharedcasepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-cases-recipients"></a>
## cases.recipients

Dossier volontaire distinct du signal personnel. DTO déclarant/équipe séparés et témoin sans contenu après retrait. Préparation5min liée à charge, acteur et droits ; partager seulement après accord explicite sur extrait et destinataires.

**Utilisation frontend :** Afficher exactement titre/extrait/destinataires/politique avant accord. Ne jamais copier une conversation automatiquement. Préparer puis partager la même charge ; retry exact de clé si résultat inconnu. Une clôture sans changement ne publie rien.

- HTTP : `GET /v1/domains/{domain}/shared-cases/recipients`.
- MCP : `api_cases_recipients` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SharedCaseRecipients](#schema-sharedcaserecipients).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-cases-prepare"></a>
## cases.prepare

Dossier volontaire distinct du signal personnel. DTO déclarant/équipe séparés et témoin sans contenu après retrait. Préparation5min liée à charge, acteur et droits ; partager seulement après accord explicite sur extrait et destinataires.

**Utilisation frontend :** Afficher exactement titre/extrait/destinataires/politique avant accord. Ne jamais copier une conversation automatiquement. Préparer puis partager la même charge ; retry exact de clé si résultat inconnu. Une clôture sans changement ne publie rien.

- HTTP : `POST /v1/domains/{domain}/shared-cases/prepare`.
- MCP : `api_cases_prepare` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [SharedCaseContent](#schema-sharedcasecontent).
- Succès HTTP 200, `application/json` : [SharedCasePreparation](#schema-sharedcasepreparation).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-cases-share"></a>
## cases.share

Dossier volontaire distinct du signal personnel. DTO déclarant/équipe séparés et témoin sans contenu après retrait. Préparation5min liée à charge, acteur et droits ; partager seulement après accord explicite sur extrait et destinataires.

**Utilisation frontend :** Afficher exactement titre/extrait/destinataires/politique avant accord. Ne jamais copier une conversation automatiquement. Préparer puis partager la même charge ; retry exact de clé si résultat inconnu. Une clôture sans changement ne publie rien.

- HTTP : `POST /v1/domains/{domain}/shared-cases/share`.
- MCP : `api_cases_share` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [SharedCaseShare](#schema-sharedcaseshare).
- Succès HTTP 200, `application/json` : [SharedCaseReceipt](#schema-sharedcasereceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-cases-read"></a>
## cases.read

Dossier volontaire distinct du signal personnel. DTO déclarant/équipe séparés et témoin sans contenu après retrait. Préparation5min liée à charge, acteur et droits ; partager seulement après accord explicite sur extrait et destinataires.

**Utilisation frontend :** Afficher exactement titre/extrait/destinataires/politique avant accord. Ne jamais copier une conversation automatiquement. Préparer puis partager la même charge ; retry exact de clé si résultat inconnu. Une clôture sans changement ne publie rien.

- HTTP : `GET /v1/domains/{domain}/shared-cases/{case_id}`.
- MCP : `api_cases_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `case_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SharedCase](#schema-sharedcase).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-cases-command"></a>
## cases.command

Dossier volontaire distinct du signal personnel. DTO déclarant/équipe séparés et témoin sans contenu après retrait. Préparation5min liée à charge, acteur et droits ; partager seulement après accord explicite sur extrait et destinataires.

**Utilisation frontend :** Afficher exactement titre/extrait/destinataires/politique avant accord. Ne jamais copier une conversation automatiquement. Préparer puis partager la même charge ; retry exact de clé si résultat inconnu. Une clôture sans changement ne publie rien.

- HTTP : `POST /v1/domains/{domain}/shared-cases/{case_id}/commands`.
- MCP : `api_cases_command` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `case_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [SharedCaseCommand](#schema-sharedcasecommand).
- Succès HTTP 200, `application/json` : [SharedCaseReceipt](#schema-sharedcasereceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-cases-events"></a>
## cases.events

Dossier volontaire distinct du signal personnel. DTO déclarant/équipe séparés et témoin sans contenu après retrait. Préparation5min liée à charge, acteur et droits ; partager seulement après accord explicite sur extrait et destinataires.

**Utilisation frontend :** Afficher exactement titre/extrait/destinataires/politique avant accord. Ne jamais copier une conversation automatiquement. Préparer puis partager la même charge ; retry exact de clé si résultat inconnu. Une clôture sans changement ne publie rien.

- HTTP : `GET /v1/domains/{domain}/shared-cases/{case_id}/events`.
- MCP : `api_cases_events` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `case_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SharedCaseEvents](#schema-sharedcaseevents).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-task_proposals-list"></a>
## task_proposals.list

Références et avis relus avec les droits actuels sur la tâche et toutes les sources de la proposition. Avis lié au digest et à la révision, distinct de la décision owner.

**Utilisation frontend :** Préparer puis confirmer explicitement. Réessai exact après résultat inconnu ; refus de la propre proposition de l’expert. Un lien ne donne aucun accès et un avis ne publie rien.

- HTTP : `GET /v1/domains/{domain}/tasks/{task_id}/proposals`.
- MCP : `api_task_proposals_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `task_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [TaskProposalReferences](#schema-taskproposalreferences).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-task_proposals-link"></a>
## task_proposals.link

Références et avis relus avec les droits actuels sur la tâche et toutes les sources de la proposition. Avis lié au digest et à la révision, distinct de la décision owner.

**Utilisation frontend :** Préparer puis confirmer explicitement. Réessai exact après résultat inconnu ; refus de la propre proposition de l’expert. Un lien ne donne aucun accès et un avis ne publie rien.

- HTTP : `POST /v1/domains/{domain}/tasks/{task_id}/proposals`.
- MCP : `api_task_proposals_link` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `task_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [TaskProposalLinkInput](#schema-taskproposallinkinput).
- Succès HTTP 200, `application/json` : [WorkTaskReceipt](#schema-worktaskreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-expert_reviews-list"></a>
## expert_reviews.list

Références et avis relus avec les droits actuels sur la tâche et toutes les sources de la proposition. Avis lié au digest et à la révision, distinct de la décision owner.

**Utilisation frontend :** Préparer puis confirmer explicitement. Réessai exact après résultat inconnu ; refus de la propre proposition de l’expert. Un lien ne donne aucun accès et un avis ne publie rien.

- HTTP : `GET /v1/domains/{domain}/tasks/{task_id}/proposals/{proposal_id}/expert-reviews`.
- MCP : `api_expert_reviews_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `task_id` | oui | texte | format : `"uuid"` |
| path | `proposal_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | longueur max. : `200` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ExpertReviewPage](#schema-expertreviewpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-expert_reviews-submit"></a>
## expert_reviews.submit

Références et avis relus avec les droits actuels sur la tâche et toutes les sources de la proposition. Avis lié au digest et à la révision, distinct de la décision owner.

**Utilisation frontend :** Préparer puis confirmer explicitement. Réessai exact après résultat inconnu ; refus de la propre proposition de l’expert. Un lien ne donne aucun accès et un avis ne publie rien.

- HTTP : `POST /v1/domains/{domain}/tasks/{task_id}/expert-reviews`.
- MCP : `api_expert_reviews_submit` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `task_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ExpertReviewInput](#schema-expertreviewinput).
- Succès HTTP 200, `application/json` : [ExpertReviewReceipt](#schema-expertreviewreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-expert_reviews"></a>
## proposals.expert_reviews

Liste paginée des avis sur cette proposition, limitée aux tâches actuellement visibles et aux sources autorisées.

**Utilisation frontend :** Afficher la validité de révision et les limites du périmètre, sans transformer un avis en approbation.

- HTTP : `GET /v1/domains/{domain}/proposals/{proposal_id}/expert-reviews`.
- MCP : `api_proposals_expert_reviews` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `proposal_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | longueur max. : `200` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ProposalExpertReviewPage](#schema-proposalexpertreviewpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-imports-command_state"></a>
## imports.command_state

Relire le lot personnel, son empreinte et ses actions éligibles.

**Utilisation frontend :** Présenter les éléments concernés et les accès ; confirmation explicite. Après réponse perdue, même charge et même clé, jamais une nouvelle commande. Un import ne publie pas de savoir.

- HTTP : `GET /v1/domains/{domain}/imports/{import_id}/command-state`.
- MCP : `api_imports_command_state` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `import_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ImportCommandState](#schema-importcommandstate).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-imports-command"></a>
## imports.command

Traiter, remettre en attente les échecs ou arrêter les éléments en attente, avec état attendu et reçu idempotent.

**Utilisation frontend :** Présenter les éléments concernés et les accès ; confirmation explicite. Après réponse perdue, même charge et même clé, jamais une nouvelle commande. Un import ne publie pas de savoir.

- HTTP : `POST /v1/domains/{domain}/imports/{import_id}/commands`.
- MCP : `api_imports_command` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `import_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ImportCommandInput](#schema-importcommandinput).
- Succès HTTP 200, `application/json` : [ImportCommandReceipt](#schema-importcommandreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-tasks-brief"></a>
## tasks.brief

Brief factuel de cinq tâches actives au plus, compteurs complets dans le périmètre autorisé et horodatage commun. Personnel par défaut ; domaine réservé owner/corpus manager. Ordre : échéance dépassée, priorité explicite, revue à décider, offre personnelle, blocage, non affectée, en cours, attente ; puis échéance, création et identifiant. Ne mesure ni qualité ni couverture du savoir.

**Utilisation frontend :** Afficher le périmètre, le rôle réel, la date et le dénominateur complet. Ouvrir une tâche ne la modifie pas. Relire avant commande ; masquer le brief lors de toute relecture échouée. Aucun partage implicite des dossiers privés.

- HTTP : `GET /v1/domains/{domain}/work-brief`.
- MCP : `api_tasks_brief` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `scope` | non | `"assigned"`, `"domain"` | défaut : `"assigned"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [WorkBrief](#schema-workbrief).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-contribution_drafts-read"></a>
## contribution_drafts.read

Un brouillon privé par auteur et domaine. Contenu incomplet autorisé ; aucune création de proposition. Lecture des droits actuels sur la source et son empreinte. Source inaccessible ou changée : contenu masqué, révision personnelle seule disponible. Sauvegarde concurrente refusée, reçu idempotent sans texte. content:null efface explicitement le brouillon courant. Conservation jusqu’à effacement explicite ; aucune purge automatique.

**Utilisation frontend :** Inspecter avant restauration explicite. Ne jamais soumettre au chargement ni écraser une saisie concurrente. Revalider source et droits avant préparation. Après réponse perdue conserver même corps et clé.

- HTTP : `GET /v1/domains/{domain}/contribution-draft`.
- MCP : `api_contribution_drafts_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ContributionDraft](#schema-contributiondraft).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-contribution_drafts-save"></a>
## contribution_drafts.save

Un brouillon privé par auteur et domaine. Contenu incomplet autorisé ; aucune création de proposition. Lecture des droits actuels sur la source et son empreinte. Source inaccessible ou changée : contenu masqué, révision personnelle seule disponible. Sauvegarde concurrente refusée, reçu idempotent sans texte. content:null efface explicitement le brouillon courant. Conservation jusqu’à effacement explicite ; aucune purge automatique.

**Utilisation frontend :** Inspecter avant restauration explicite. Ne jamais soumettre au chargement ni écraser une saisie concurrente. Revalider source et droits avant préparation. Après réponse perdue conserver même corps et clé.

- HTTP : `POST /v1/domains/{domain}/contribution-draft`.
- MCP : `api_contribution_drafts_save` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ContributionDraftInput](#schema-contributiondraftinput).
- Succès HTTP 200, `application/json` : [ContributionDraftReceipt](#schema-contributiondraftreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-case_tasks-list"></a>
## case_tasks.list

Référence réversible, sans copie de contenu ni transfert de droits. Le déclarant voit uniquement le nombre de tâches liées ; le coordinateur destinataire voit les références et états courants. Vingt liens actifs maximum, refus explicite au-delà. Historique minimal du dossier. Une tâche terminée ne clôture ni ne publie le dossier.

**Utilisation frontend :** Préparer puis confirmer le lien ou son retrait sur les deux révisions relues. Ne copier aucun extrait dans une tâche. Après réponse perdue reprendre même corps et même clé. Masquer après retrait du partage.

- HTTP : `GET /v1/domains/{domain}/shared-cases/{case_id}/tasks`.
- MCP : `api_case_tasks_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `case_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [CaseTaskReferences](#schema-casetaskreferences).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-case_tasks-command"></a>
## case_tasks.command

Référence réversible, sans copie de contenu ni transfert de droits. Le déclarant voit uniquement le nombre de tâches liées ; le coordinateur destinataire voit les références et états courants. Vingt liens actifs maximum, refus explicite au-delà. Historique minimal du dossier. Une tâche terminée ne clôture ni ne publie le dossier.

**Utilisation frontend :** Préparer puis confirmer le lien ou son retrait sur les deux révisions relues. Ne copier aucun extrait dans une tâche. Après réponse perdue reprendre même corps et même clé. Masquer après retrait du partage.

- HTTP : `POST /v1/domains/{domain}/shared-cases/{case_id}/tasks`.
- MCP : `api_case_tasks_command` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `case_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [CaseTaskCommand](#schema-casetaskcommand).
- Succès HTTP 200, `application/json` : [SharedCaseReceipt](#schema-sharedcasereceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-work_overview-read"></a>
## work_overview.read

Accueil factuel : tâches, dossiers ouverts reçus nominativement, propres partages ouverts et propres imports non annulés contenant des éléments en attente ou en échec. Un snapshot PostgreSQL, compteurs complets et cinq éléments par catégorie. Domaine élargit seulement les tâches. Aucun texte source ni origine privée sélectionné. Revues nominatives à relire et envois personnels non retirés, sous accès courant à la source exacte ; cinq plus anciens et dénominateurs complets.

**Utilisation frontend :** Distinguer actions et suivi personnel. Afficher dénominateurs, ordre, date et limites. Null signifie capacité indisponible, pas zéro travail. Masquer tout snapshot échoué ; relire avant action.

- HTTP : `GET /v1/domains/{domain}/work-overview`.
- MCP : `api_work_overview_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `scope` | non | `"assigned"`, `"domain"` | défaut : `"assigned"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [WorkOverview](#schema-workoverview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-tasks-plan"></a>
## tasks.plan

Modifie priorité low/normal/high et échéance nullable avec motif, révision attendue et reçu idempotent. Tâche non terminale ; état, affectataire, création et résultat conservés. Événement immuable avant/après et activité interne. Aucun effet sur le savoir.

**Utilisation frontend :** Relire, afficher avant/après/motif et confirmer. Null retire explicitement l’échéance. Date affichée dans le fuseau de l’utilisateur. Résultat inconnu : conserver la même clé/charge. Nouvelle lecture après conflit. Priorité motivée, jamais inférée.

- HTTP : `POST /v1/domains/{domain}/tasks/{task_id}/plan`.
- MCP : `api_tasks_plan` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `task_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [TaskPlanInput](#schema-taskplaninput).
- Succès HTTP 200, `application/json` : [WorkTaskReceipt](#schema-worktaskreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-task_receipts-list"></a>
## task_receipts.list

Lister les reçus immuables de mes seules commandes, ordre récent puis identifiant. Titre et état courant seulement si la tâche reste accessible ; aucun motif, résultat ou extrait dans le reçu.

**Utilisation frontend :** Résultat enregistré distinct de l’état actuel. Absence de reçu ne prouve jamais un échec ; ne pas renvoyer automatiquement. Relecture des droits à chaque accès. Aucun reçu d’un autre acteur, même owner.

- HTTP : `GET /v1/domains/{domain}/task-command-receipts`.
- MCP : `api_task_receipts_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50` |
| query | `after` | non | texte | longueur max. : `200` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [TaskCommandRecordPage](#schema-taskcommandrecordpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-task_receipts-read"></a>
## task_receipts.read

Lire mon reçu par clé de commande, sans réexécuter la commande.404 reste absent ou inaccessible, jamais une preuve de non-exécution.

**Utilisation frontend :** Résultat enregistré distinct de l’état actuel. Absence de reçu ne prouve jamais un échec ; ne pas renvoyer automatiquement. Relecture des droits à chaque accès. Aucun reçu d’un autre acteur, même owner.

- HTTP : `GET /v1/domains/{domain}/task-command-receipts/{command_id}`.
- MCP : `api_task_receipts_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `command_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [TaskCommandRecord](#schema-taskcommandrecord).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_drafts-list"></a>
## reference_drafts.list

Préparations personnelles par auteur et domaine, sans approbation, partage, publication ou verdict. Chaque question comporte thème, critères et passage source exact en indices Unicode. Droits et empreinte relus. Révision attendue, clé idempotente et reçu sans texte pour chaque sauvegarde. Aucun historique de contenu ni effacement dans cette première tranche.

**Utilisation frontend :** Afficher privé et non approuvé. Lire avant édition ; préparer puis confirmer la sauvegarde. Un reçu ancien ne décrit pas le contenu courant. En cas de réponse perdue, reprendre seulement le même corps et la même clé. Liste de vingt au maximum, sans total global.

- HTTP : `GET /v1/domains/{domain}/reference-drafts`.
- MCP : `api_reference_drafts_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReferenceDraftPage](#schema-referencedraftpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_drafts-read"></a>
## reference_drafts.read

Préparations personnelles par auteur et domaine, sans approbation, partage, publication ou verdict. Chaque question comporte thème, critères et passage source exact en indices Unicode. Droits et empreinte relus. Révision attendue, clé idempotente et reçu sans texte pour chaque sauvegarde. Aucun historique de contenu ni effacement dans cette première tranche.

**Utilisation frontend :** Afficher privé et non approuvé. Lire avant édition ; préparer puis confirmer la sauvegarde. Un reçu ancien ne décrit pas le contenu courant. En cas de réponse perdue, reprendre seulement le même corps et la même clé. Liste de vingt au maximum, sans total global.

- HTTP : `GET /v1/domains/{domain}/reference-drafts/{question}`.
- MCP : `api_reference_drafts_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `question` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReferenceDraft](#schema-referencedraft).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_drafts-save"></a>
## reference_drafts.save

Préparations personnelles par auteur et domaine, sans approbation, partage, publication ou verdict. Chaque question comporte thème, critères et passage source exact en indices Unicode. Droits et empreinte relus. Révision attendue, clé idempotente et reçu sans texte pour chaque sauvegarde. Aucun historique de contenu ni effacement dans cette première tranche.

**Utilisation frontend :** Afficher privé et non approuvé. Lire avant édition ; préparer puis confirmer la sauvegarde. Un reçu ancien ne décrit pas le contenu courant. En cas de réponse perdue, reprendre seulement le même corps et la même clé. Liste de vingt au maximum, sans total global.

- HTTP : `POST /v1/domains/{domain}/reference-drafts/{question}`.
- MCP : `api_reference_drafts_save` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `question` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ReferenceDraftInput](#schema-referencedraftinput).
- Succès HTTP 200, `application/json` : [ReferenceDraftReceipt](#schema-referencedraftreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_draft_receipts-read"></a>
## reference_draft_receipts.read

Reçu immuable personnel sans contenu de question ou source. Lecture de sa propre commande par clé, même si la source est devenue inaccessible, avec appartenance écrivain actuelle. Un reçu absent ne prouve pas l’échec.

**Utilisation frontend :** Vérifier le résultat inconnu par lecture seule. Ne pas rejouer automatiquement. Le reçu historique ne décrit pas le contenu courant.

- HTTP : `GET /v1/domains/{domain}/reference-draft-receipts/{command_id}`.
- MCP : `api_reference_draft_receipts_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `command_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReferenceDraftReceiptRecord](#schema-referencedraftreceiptrecord).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_reviewers-list"></a>
## reference_reviewers.list

Revue nominative de question sourcée. Préparation de cinq minutes liée au contenu, à la révision et aux droits, puis soumission explicite. Auteur et destinataire seulement, avec accès source actuel. Avis motivé ou retrait, révision attendue et reçus immuables personnels. Un avis favorable ne constitue aucune approbation officielle.

**Utilisation frontend :** Afficher destinataire et copie exacte avant confirmation. Résultat inconnu : lire le reçu personnel sans renvoyer. Un 404 ne prouve pas l’échec. Ne rejouer explicitement que la même charge et clé. Retrait conserve un témoin sans contenu. Vingt éléments par page, aucun total global.

- HTTP : `GET /v1/domains/{domain}/reference-drafts/{question}/reviewers`.
- MCP : `api_reference_reviewers_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `question` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | texte | longueur min. : `1`; longueur max. : `200` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReferenceReviewerPage](#schema-referencereviewerpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_reviews-prepare"></a>
## reference_reviews.prepare

Revue nominative de question sourcée. Préparation de cinq minutes liée au contenu, à la révision et aux droits, puis soumission explicite. Auteur et destinataire seulement, avec accès source actuel. Avis motivé ou retrait, révision attendue et reçus immuables personnels. Un avis favorable ne constitue aucune approbation officielle.

**Utilisation frontend :** Afficher destinataire et copie exacte avant confirmation. Résultat inconnu : lire le reçu personnel sans renvoyer. Un 404 ne prouve pas l’échec. Ne rejouer explicitement que la même charge et clé. Retrait conserve un témoin sans contenu. Vingt éléments par page, aucun total global.

- HTTP : `POST /v1/domains/{domain}/reference-reviews/prepare`.
- MCP : `api_reference_reviews_prepare` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ReferenceReviewSelection](#schema-referencereviewselection).
- Succès HTTP 200, `application/json` : [ReferenceReviewPreparation](#schema-referencereviewpreparation).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_reviews-submit"></a>
## reference_reviews.submit

Revue nominative de question sourcée. Préparation de cinq minutes liée au contenu, à la révision et aux droits, puis soumission explicite. Auteur et destinataire seulement, avec accès source actuel. Avis motivé ou retrait, révision attendue et reçus immuables personnels. Un avis favorable ne constitue aucune approbation officielle.

**Utilisation frontend :** Afficher destinataire et copie exacte avant confirmation. Résultat inconnu : lire le reçu personnel sans renvoyer. Un 404 ne prouve pas l’échec. Ne rejouer explicitement que la même charge et clé. Retrait conserve un témoin sans contenu. Vingt éléments par page, aucun total global.

- HTTP : `POST /v1/domains/{domain}/reference-reviews/submit`.
- MCP : `api_reference_reviews_submit` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ReferenceReviewSubmitInput](#schema-referencereviewsubmitinput).
- Succès HTTP 200, `application/json` : [ReferenceReviewReceipt](#schema-referencereviewreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_reviews-list"></a>
## reference_reviews.list

Revue nominative de question sourcée. Préparation de cinq minutes liée au contenu, à la révision et aux droits, puis soumission explicite. Auteur et destinataire seulement, avec accès source actuel. Avis motivé ou retrait, révision attendue et reçus immuables personnels. Un avis favorable ne constitue aucune approbation officielle.

**Utilisation frontend :** Afficher destinataire et copie exacte avant confirmation. Résultat inconnu : lire le reçu personnel sans renvoyer. Un 404 ne prouve pas l’échec. Ne rejouer explicitement que la même charge et clé. Retrait conserve un témoin sans contenu. Vingt éléments par page, aucun total global.

- HTTP : `GET /v1/domains/{domain}/reference-reviews`.
- MCP : `api_reference_reviews_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | texte | format : `"uuid"` |
| query | `scope` | non | `"mine"`, `"assigned"` | — |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReferenceReviewPage](#schema-referencereviewpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_reviews-read"></a>
## reference_reviews.read

Revue nominative de question sourcée. Préparation de cinq minutes liée au contenu, à la révision et aux droits, puis soumission explicite. Auteur et destinataire seulement, avec accès source actuel. Avis motivé ou retrait, révision attendue et reçus immuables personnels. Un avis favorable ne constitue aucune approbation officielle.

**Utilisation frontend :** Afficher destinataire et copie exacte avant confirmation. Résultat inconnu : lire le reçu personnel sans renvoyer. Un 404 ne prouve pas l’échec. Ne rejouer explicitement que la même charge et clé. Retrait conserve un témoin sans contenu. Vingt éléments par page, aucun total global.

- HTTP : `GET /v1/domains/{domain}/reference-reviews/{review}`.
- MCP : `api_reference_reviews_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `review` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReferenceReviewDetail](#schema-referencereviewdetail).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_reviews-command"></a>
## reference_reviews.command

Revue nominative de question sourcée. Préparation de cinq minutes liée au contenu, à la révision et aux droits, puis soumission explicite. Auteur et destinataire seulement, avec accès source actuel. Avis motivé ou retrait, révision attendue et reçus immuables personnels. Un avis favorable ne constitue aucune approbation officielle.

**Utilisation frontend :** Afficher destinataire et copie exacte avant confirmation. Résultat inconnu : lire le reçu personnel sans renvoyer. Un 404 ne prouve pas l’échec. Ne rejouer explicitement que la même charge et clé. Retrait conserve un témoin sans contenu. Vingt éléments par page, aucun total global.

- HTTP : `POST /v1/domains/{domain}/reference-reviews/{review}/commands`.
- MCP : `api_reference_reviews_command` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `review` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ReferenceReviewCommandInput](#schema-referencereviewcommandinput).
- Succès HTTP 200, `application/json` : [ReferenceReviewReceipt](#schema-referencereviewreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_review_receipts-read"></a>
## reference_review_receipts.read

Revue nominative de question sourcée. Préparation de cinq minutes liée au contenu, à la révision et aux droits, puis soumission explicite. Auteur et destinataire seulement, avec accès source actuel. Avis motivé ou retrait, révision attendue et reçus immuables personnels. Un avis favorable ne constitue aucune approbation officielle.

**Utilisation frontend :** Afficher destinataire et copie exacte avant confirmation. Résultat inconnu : lire le reçu personnel sans renvoyer. Un 404 ne prouve pas l’échec. Ne rejouer explicitement que la même charge et clé. Retrait conserve un témoin sans contenu. Vingt éléments par page, aucun total global.

- HTTP : `GET /v1/domains/{domain}/reference-review-receipts/{command_id}`.
- MCP : `api_reference_review_receipts_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `command_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReferenceReviewReceiptRecord](#schema-referencereviewreceiptrecord).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-reference_reviews-events"></a>
## reference_reviews.events

Lire les événements immuables d’une revue nommée sous droits courants ; motifs masqués après retrait, pages liées à la révision.

**Utilisation frontend :** Journal de la revue, auteur/date/action/version et motif autorisé, pagination par20.

- HTTP : `GET /v1/domains/{domain}/reference-reviews/{review}/events`.
- MCP : `api_reference_reviews_events` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `review` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | entier | minimum : `0`; maximum : `9007199254740991` |
| query | `expected_revision` | non | entier | minimum : `1`; maximum : `9007199254740991` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReferenceReviewEventPage](#schema-referencerevieweventpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-list"></a>
## agent_missions.list

Mission de service nommé : list. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `GET /v1/domains/{domain}/agent-missions`.
- MCP : `api_agent_missions_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [AgentMissionPage](#schema-agentmissionpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-candidates"></a>
## agent_missions.candidates

Mission de service nommé : candidates. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `GET /v1/domains/{domain}/agent-missions/candidates`.
- MCP : `api_agent_missions_candidates` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | texte | longueur max. : `200` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [AgentMissionCandidatePage](#schema-agentmissioncandidatepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-prepare"></a>
## agent_missions.prepare

Mission de service nommé : prepare. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `POST /v1/domains/{domain}/agent-missions/prepare`.
- MCP : `api_agent_missions_prepare` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [AgentMissionMandate](#schema-agentmissionmandate).
- Succès HTTP 200, `application/json` : [AgentMissionPreparation](#schema-agentmissionpreparation).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-create"></a>
## agent_missions.create

Mission de service nommé : create. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `POST /v1/domains/{domain}/agent-missions/create`.
- MCP : `api_agent_missions_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [AgentMissionCreate](#schema-agentmissioncreate).
- Succès HTTP 200, `application/json` : [AgentMissionReceipt](#schema-agentmissionreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-read"></a>
## agent_missions.read

Mission de service nommé : read. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `GET /v1/domains/{domain}/agent-missions/{mission}`.
- MCP : `api_agent_missions_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `mission` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [AgentMissionDetail](#schema-agentmissiondetail).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-command"></a>
## agent_missions.command

Mission de service nommé : command. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `POST /v1/domains/{domain}/agent-missions/{mission}/commands`.
- MCP : `api_agent_missions_command` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, agent.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `mission` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [AgentMissionCommand](#schema-agentmissioncommand).
- Succès HTTP 200, `application/json` : [AgentMissionReceipt](#schema-agentmissionreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-read_source"></a>
## agent_missions.read_source

Mission de service nommé : read_source. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `POST /v1/domains/{domain}/agent-missions/{mission}/read-source`.
- MCP : `api_agent_missions_read_source` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : agent.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `mission` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [AgentMissionReadInput](#schema-agentmissionreadinput).
- Succès HTTP 200, `application/json` : [AgentMissionReadResult](#schema-agentmissionreadresult).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-complete"></a>
## agent_missions.complete

Mission de service nommé : complete. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `POST /v1/domains/{domain}/agent-missions/{mission}/complete`.
- MCP : `api_agent_missions_complete` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : agent.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `mission` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [AgentMissionCompleteInput](#schema-agentmissioncompleteinput).
- Succès HTTP 200, `application/json` : [AgentMissionReceipt](#schema-agentmissionreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-events"></a>
## agent_missions.events

Mission de service nommé : events. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `GET /v1/domains/{domain}/agent-missions/{mission}/events`.
- MCP : `api_agent_missions_events` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `mission` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [AgentMissionEventPage](#schema-agentmissioneventpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-receipt"></a>
## agent_missions.receipt

Mission de service nommé : receipt. Aucun modèle ni worker lancé, fournisseur none.

**Utilisation frontend :** Capacités actuelles et source exacte relues. Préparer puis confirmer création/arrêt/reprise. Budget caractères et appels du protocole seulement, pas jetons/coûts externes. Résultat inconnu : reçu personnel avant reprise explicite de la même charge. Rapport candidat, aucune approbation ni publication.

- HTTP : `GET /v1/domains/{domain}/agent-mission-receipts/{command}`.
- MCP : `api_agent_missions_receipt` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `command` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [AgentMissionReceiptLookup](#schema-agentmissionreceiptlookup).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-controls"></a>
## agent_missions.controls

Contrôle minimal des propres missions : état et budgets sans contenu, arrêt seulement.

**Utilisation frontend :** Affichage auteur seulement, même après perte de source ou de rôle du service. Aucun objectif, critère, source, rapport ou identité du service. Relire la version puis préparer et confirmer un arrêt via la commande existante.

- HTTP : `GET /v1/domains/{domain}/agent-mission-controls`.
- MCP : `api_agent_missions_controls` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [AgentMissionControlPage](#schema-agentmissioncontrolpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-control"></a>
## agent_missions.control

Contrôle minimal des propres missions : état et budgets sans contenu, arrêt seulement.

**Utilisation frontend :** Affichage auteur seulement, même après perte de source ou de rôle du service. Aucun objectif, critère, source, rapport ou identité du service. Relire la version puis préparer et confirmer un arrêt via la commande existante.

- HTTP : `GET /v1/domains/{domain}/agent-mission-controls/{mission}`.
- MCP : `api_agent_missions_control` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `mission` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [AgentMissionControl](#schema-agentmissioncontrol).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-agent_missions-evidence"></a>
## agent_missions.evidence

Relire un passage cité dans un rapport terminé, à sa révision exacte, sous les droits actuels de son auteur.

**Utilisation frontend :** Lecture humaine seulement, limitée au passage déjà cité (8192 caractères Unicode au plus), sans consommer le budget agent ni approuver le rapport. Retirer le passage précédent pendant la relecture ou en cas de refus.

- HTTP : `GET /v1/domains/{domain}/agent-missions/{mission}/evidence/{index}`.
- MCP : `api_agent_missions_evidence` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `mission` | oui | texte | format : `"uuid"` |
| path | `index` | oui | texte | motif : `"^(?:[1-9]&#124;10)$"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `expected_revision` | oui | entier | minimum : `1` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [AgentMissionEvidence](#schema-agentmissionevidence).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-work_activity-list"></a>
## work_activity.list

Activité personnelle des tâches, revues nominatives, missions et dossiers explicitement partagés. Viewer : suites de ses propres partages uniquement.

**Utilisation frontend :** Filtrer sous les droits actuels, distinguer événement historique et état courant, montrer le dénominateur et la date. Ouvrir ne marque pas lu. Marquer lu ne modifie aucun objet métier. Réponse inconnue : relire la liste, puis reprendre explicitement la même clé si nécessaire.

- HTTP : `GET /v1/domains/{domain}/work-activity`.
- MCP : `api_work_activity_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20` |
| query | `after` | non | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [WorkActivityPage](#schema-workactivitypage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-work_activity-read"></a>
## work_activity.read

Activité personnelle des tâches, revues nominatives, missions et dossiers explicitement partagés. Viewer : suites de ses propres partages uniquement.

**Utilisation frontend :** Filtrer sous les droits actuels, distinguer événement historique et état courant, montrer le dénominateur et la date. Ouvrir ne marque pas lu. Marquer lu ne modifie aucun objet métier. Réponse inconnue : relire la liste, puis reprendre explicitement la même clé si nécessaire.

- HTTP : `POST /v1/domains/{domain}/work-activity/{event}/read`.
- MCP : `api_work_activity_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `event` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [WorkActivityRead](#schema-workactivityread).
- Succès HTTP 200, `application/json` : [WorkActivityReceipt](#schema-workactivityreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-companion_guides-list"></a>
## companion_guides.list

Catalogue de documentation MCP par usage, sans contenu métier, clé ou configuration privée.

**Utilisation frontend :** Afficher les étapes, décisions, effets, reprises et limites. Lire les capacités actuelles pour indiquer une disponibilité ; le guide ne les accorde pas. Aucun client tiers qualifié par cette lecture.

- HTTP : `GET /v1/companion-guides`.
- MCP : `api_companion_guides_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [CompanionWorkflowCatalog](#schema-companionworkflowcatalog).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-passage"></a>
## sources.passage

Lire au plus8192caractères Unicode à partir d’une position, avec empreinte attendue optionnelle et fin explicite.

**Utilisation frontend :** Afficher la plage et la longueur totale. Conserver l’empreinte initiale sur toutes les pages suivantes, remplacer le passage affiché plutôt que cumuler tout le corps. En cas de refus ou conflit, masquer l’ancien texte ; aucune troncature silencieuse. La lecture complète reste possible page après page.

- HTTP : `GET /v1/domains/{domain}/sources/{source_id}/passage`.
- MCP : `api_sources_passage` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |
| query | `offset` | non | entier | minimum : `0`; maximum : `2147483646`; défaut : `0` |
| query | `limit` | non | entier | minimum : `1`; maximum : `8192`; défaut : `8192` |
| query | `expected_hash` | non | texte | motif : `"^[0-9a-f]{64}$"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SourcePassage](#schema-sourcepassage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-locate"></a>
## sources.locate

Retourner la position Unicode d’un extrait unique ou vérifier son occurrence explicite, sous droits et empreinte courants.

**Utilisation frontend :** Ne pas choisir arbitrairement une occurrence répétée. Demander une sélection ou une position explicite. Afficher la plage et relire le passage si nécessaire. Aucun corps complet téléchargé ; aucune mutation métier.

- HTTP : `POST /v1/domains/{domain}/sources/{source_id}/locate`.
- MCP : `api_sources_locate` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, viewer, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [SourceLocateInput](#schema-sourcelocateinput).
- Succès HTTP 200, `application/json` : [SourceLocation](#schema-sourcelocation).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

## Schémas des données

Les noms techniques restent identiques dans HTTP, TypeScript et MCP. Les champs d'un objet imbriqué sont décrits par le lien vers son schéma. Le JSON machine conserve toutes les contraintes, y compris les alternatives complexes.

<a id="schema-agentmissioncandidatepage"></a>
### AgentMissionCandidatePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de objet | éléments max. : `20` |
| `next_after` | oui | texte / null | — |

<a id="schema-agentmissioncommand"></a>
### AgentMissionCommand

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action` | oui | `"claim"`, `"renew"`, `"stop"`, `"resume"` | — |
| `expected_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `idempotency_key` | oui | texte | format : `"uuid"` |
| `lease_id` | non | texte | format : `"uuid"` |
| `reason` | non | texte | longueur max. : `2000` |

<a id="schema-agentmissioncompleteinput"></a>
### AgentMissionCompleteInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `idempotency_key` | oui | texte | format : `"uuid"` |
| `lease_id` | oui | texte | format : `"uuid"` |
| `report` | oui | texte | longueur max. : `8000` |
| `hypotheses` | oui | texte | longueur max. : `2000` |
| `evidence` | oui | liste de objet | éléments max. : `10` |

<a id="schema-agentmissioncontrol"></a>
### AgentMissionControl

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `status` | oui | `"queued"`, `"running"`, `"stopped"`, `"completed"` | — |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `max_reads` | oui | entier | minimum : `1`; maximum : `100` |
| `max_chars` | oui | entier | minimum : `1`; maximum : `100000` |
| `reads_used` | oui | entier | minimum : `0`; maximum : `100` |
| `chars_used` | oui | entier | minimum : `0`; maximum : `100000` |
| `expires_at` | oui | texte | format : `"date-time"` |
| `created_at` | oui | texte | format : `"date-time"` |
| `expired` | oui | booléen | — |
| `can_stop` | oui | booléen | — |
| `content_withheld` | oui | `true` | — |

<a id="schema-agentmissioncontrolpage"></a>
### AgentMissionControlPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [AgentMissionControl](#schema-agentmissioncontrol) | éléments max. : `20` |
| `next_after` | oui | texte / null | format : `"uuid"` |

<a id="schema-agentmissioncreate"></a>
### AgentMissionCreate

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `mandate` | oui | [AgentMissionMandate](#schema-agentmissionmandate) | — |
| `preparation_id` | oui | texte | format : `"uuid"` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-agentmissiondetail"></a>
### AgentMissionDetail

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `title` | oui | texte | longueur max. : `200` |
| `objective` | oui | texte | longueur max. : `4000` |
| `criteria` | oui | texte | longueur max. : `4000` |
| `agent` | oui | texte | longueur max. : `200` |
| `source_id` | oui | texte | format : `"uuid"` |
| `source_hash` | oui | texte | longueur max. : `64`; motif : `"^[a-f0-9]{64}$"` |
| `max_reads` | oui | entier | minimum : `1`; maximum : `100` |
| `max_chars` | oui | entier | minimum : `1`; maximum : `100000` |
| `expires_at` | oui | texte | format : `"date-time"` |
| `id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | longueur max. : `200` |
| `status` | oui | `"queued"`, `"running"`, `"stopped"`, `"completed"` | — |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `reads_used` | oui | entier | minimum : `0`; maximum : `100` |
| `chars_used` | oui | entier | minimum : `0`; maximum : `100000` |
| `expired` | oui | booléen | — |
| `lease_expired` | oui | booléen | — |
| `lease_id` | oui | texte / null | format : `"uuid"` |
| `lease_expires_at` | oui | texte / null | format : `"date-time"` |
| `report` | oui | texte | longueur max. : `8000` |
| `hypotheses` | oui | texte | longueur max. : `2000` |
| `evidence` | oui | liste de objet | éléments max. : `10` |
| `created_at` | oui | texte | format : `"date-time"` |
| `updated_at` | oui | texte | format : `"date-time"` |
| `allowed_actions` | oui | liste de `"claim"`, `"renew"`, `"read"`, `"complete"`, `"stop"`, `"resume"` | éléments max. : `6` |
| `provider` | oui | `"none"` | — |
| `execution` | oui | `"client_managed"` | — |

<a id="schema-agentmissioneventpage"></a>
### AgentMissionEventPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `mission_id` | oui | texte | format : `"uuid"` |
| `current_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `items` | oui | liste de objet | éléments max. : `20` |
| `next_after` | oui | texte / null | format : `"uuid"` |

<a id="schema-agentmissionevidence"></a>
### AgentMissionEvidence

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `source_hash` | oui | texte | longueur max. : `64` |
| `title` | oui | texte | — |
| `location` | oui | texte | — |
| `start` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `end` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `total_characters` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `excerpt` | oui | texte | longueur max. : `8192` |
| `mission_id` | oui | texte | format : `"uuid"` |
| `mission_revision` | oui | entier | minimum : `1` |
| `index` | oui | entier | minimum : `1`; maximum : `10` |
| `read_kind` | oui | `"human_report_review"` | — |

<a id="schema-agentmissionmandate"></a>
### AgentMissionMandate

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `title` | oui | texte | longueur max. : `200` |
| `objective` | oui | texte | longueur max. : `4000` |
| `criteria` | oui | texte | longueur max. : `4000` |
| `agent` | oui | texte | longueur max. : `200` |
| `source_id` | oui | texte | format : `"uuid"` |
| `source_hash` | oui | texte | longueur max. : `64`; motif : `"^[a-f0-9]{64}$"` |
| `max_reads` | oui | entier | minimum : `1`; maximum : `100` |
| `max_chars` | oui | entier | minimum : `1`; maximum : `100000` |
| `expires_at` | oui | texte | format : `"date-time"` |

<a id="schema-agentmissionpage"></a>
### AgentMissionPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de objet | éléments max. : `20` |
| `next_after` | oui | texte / null | format : `"uuid"` |

<a id="schema-agentmissionpreparation"></a>
### AgentMissionPreparation

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `preparation_id` | oui | texte | format : `"uuid"` |
| `mandate` | oui | [AgentMissionMandate](#schema-agentmissionmandate) | — |
| `source` | oui | objet | — |
| `expires_at` | oui | texte | format : `"date-time"` |
| `provider` | oui | `"none"` | — |
| `execution` | oui | `"client_managed"` | — |

<a id="schema-agentmissionreadinput"></a>
### AgentMissionReadInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `idempotency_key` | oui | texte | format : `"uuid"` |
| `lease_id` | oui | texte | format : `"uuid"` |
| `start` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `end` | oui | entier | minimum : `1`; maximum : `9007199254740991` |

<a id="schema-agentmissionreadresult"></a>
### AgentMissionReadResult

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `receipt` | oui | [AgentMissionReceipt](#schema-agentmissionreceipt) | — |
| `source_id` | oui | texte | format : `"uuid"` |
| `source_hash` | oui | texte | longueur max. : `64` |
| `title` | oui | texte | — |
| `location` | oui | texte | — |
| `start` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `end` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `total_characters` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `excerpt` | oui | texte | longueur max. : `8192` |

<a id="schema-agentmissionreceipt"></a>
### AgentMissionReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `mission_id` | oui | texte | format : `"uuid"` |
| `event_id` | oui | texte | format : `"uuid"` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `status` | oui | `"queued"`, `"running"`, `"stopped"`, `"completed"` | — |
| `reads_used` | oui | entier | minimum : `0`; maximum : `100` |
| `chars_used` | oui | entier | minimum : `0`; maximum : `100000` |
| `lease_id` | oui | texte / null | format : `"uuid"` |
| `lease_expires_at` | oui | texte / null | format : `"date-time"` |

<a id="schema-agentmissionreceiptlookup"></a>
### AgentMissionReceiptLookup

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `command_id` | oui | texte | format : `"uuid"` |
| `receipt` | oui | [AgentMissionReceipt](#schema-agentmissionreceipt) | — |

<a id="schema-casetaskcommand"></a>
### CaseTaskCommand

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action` | oui | `"link"`, `"unlink"` | — |
| `task_id` | oui | texte | format : `"uuid"` |
| `expected_case_revision` | oui | entier | minimum : `1`; maximum : `9007199254740990` |
| `expected_task_revision` | oui | entier | minimum : `1`; maximum : `9007199254740990` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-casetaskreference"></a>
### CaseTaskReference

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `task_id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | longueur max. : `200` |
| `status` | oui | `"unassigned"`, `"offered"`, `"in_progress"`, `"blocked"`, `"review"`, `"completed"`, `"cancelled"` | — |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740990` |
| `linked_at` | oui | texte | format : `"date-time"` |

<a id="schema-casetaskreferences"></a>
### CaseTaskReferences

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `case_id` | oui | texte | format : `"uuid"` |
| `case_revision` | oui | entier | minimum : `1`; maximum : `9007199254740990` |
| `audience` | oui | `"declarant"`, `"team"` | — |
| `items` | oui | liste de [CaseTaskReference](#schema-casetaskreference) | éléments max. : `20` |
| `linked_count` | oui | entier | minimum : `0`; maximum : `20` |
| `max_links` | oui | `20` | — |
| `can_link` | oui | booléen | — |
| `can_unlink` | oui | booléen | — |
| `as_of` | oui | texte | format : `"date-time"` |

<a id="schema-companionworkflowcatalog"></a>
### CompanionWorkflowCatalog

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `version` | oui | texte | longueur min. : `1`; longueur max. : `40` |
| `documentation_only` | oui | `true` | — |
| `client_compatibility` | oui | `"not_qualified"` | — |
| `client_requirements` | oui | liste de texte | éléments min. : `1`; éléments max. : `8` |
| `guides` | oui | liste de [CompanionWorkflowGuide](#schema-companionworkflowguide) | éléments min. : `6`; éléments max. : `6` |

<a id="schema-companionworkflowguide"></a>
### CompanionWorkflowGuide

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | `"consult"`, `"feedback"`, `"follow-up"`, `"task"`, `"correction"`, `"domain"` | — |
| `title` | oui | texte | longueur min. : `1`; longueur max. : `100` |
| `intent` | oui | texte | longueur min. : `1`; longueur max. : `500` |
| `required_capability` | oui | texte | longueur min. : `1`; longueur max. : `100` |
| `steps` | oui | liste de texte | éléments min. : `1`; éléments max. : `8` |
| `tools` | oui | liste de texte | éléments min. : `1`; éléments max. : `12` |
| `decision` | oui | texte | longueur min. : `1`; longueur max. : `1000` |
| `effect` | oui | texte | longueur min. : `1`; longueur max. : `1000` |
| `recovery` | oui | texte | longueur min. : `1`; longueur max. : `1500` |
| `limits` | oui | texte | longueur min. : `1`; longueur max. : `1500` |
| `example` | oui | texte | longueur min. : `1`; longueur max. : `1500` |

<a id="schema-contributiondraft"></a>
### ContributionDraft

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `revision` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `updated_at` | oui | texte / null | — |
| `state` | oui | `"empty"`, `"available"`, `"source_unavailable"`, `"source_changed"` | — |
| `content` | oui | [ContributionDraftContent](#schema-contributiondraftcontent) / null | — |

<a id="schema-contributiondraftcontent"></a>
### ContributionDraftContent

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `source_hash` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `title` | oui | texte | longueur max. : `200` |
| `excerpt` | oui | texte | longueur max. : `200000` |
| `reason` | oui | texte | longueur max. : `2000` |
| `selection` | oui | objet / null | — |

<a id="schema-contributiondraftinput"></a>
### ContributionDraftInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `content` | oui | [ContributionDraftContent](#schema-contributiondraftcontent) / null | — |
| `expected_revision` | oui | entier | minimum : `0`; maximum : `9007199254740990` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-contributiondraftreceipt"></a>
### ContributionDraftReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `receipt_id` | oui | texte | format : `"uuid"` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |

<a id="schema-conversationdraft"></a>
### ConversationDraft

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `draft_key` | oui | texte | — |
| `text` | oui | texte | longueur max. : `2000` |
| `revision` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `updated_at` | oui | texte / null | format : `"date-time"` |

<a id="schema-conversationdraftinput"></a>
### ConversationDraftInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `text` | oui | texte | longueur max. : `2000` |
| `expected_revision` | oui | entier | minimum : `0`; maximum : `9007199254740990` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-conversationdraftreceipt"></a>
### ConversationDraftReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `receipt_id` | oui | texte | format : `"uuid"` |
| `draft_key` | oui | texte | — |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |

<a id="schema-differencesummaryconcept"></a>
### DifferenceSummaryConcept

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `concept_id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `maturity` | non | [DifferenceSummaryMaturity](#schema-differencesummarymaturity) | défaut : `"emerging"` |
| `sources` | oui | liste de [DifferenceSummarySourceRef](#schema-differencesummarysourceref) | éléments min. : `1`; éléments max. : `30` |
| `links` | non | liste de [DifferenceSummaryLink](#schema-differencesummarylink) | éléments max. : `100` |
| `body_sha256` | oui | texte | motif : `"^[0-9a-f]{64}$"` |

<a id="schema-differencesummaryconceptdifference"></a>
### DifferenceSummaryConceptDifference

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `concept_id` | oui | texte | format : `"uuid"` |
| `before` | oui | [DifferenceSummaryConcept](#schema-differencesummaryconcept) / null | — |
| `after` | oui | [DifferenceSummaryConcept](#schema-differencesummaryconcept) / null | — |

<a id="schema-differencesummarylink"></a>
### DifferenceSummaryLink

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `target_id` | oui | texte | format : `"uuid"` |
| `kind` | oui | `"structural"`, `"associative"` | — |
| `primary` | non | booléen | défaut : `false` |
| `weight` | non | nombre | minimum : `0`; maximum : `1`; défaut : `1.0` |

<a id="schema-differencesummarymaturity"></a>
### DifferenceSummaryMaturity

`"emerging"`, `"observed"`, `"established"`, `"reference"` ; —

<a id="schema-differencesummarysourceref"></a>
### DifferenceSummarySourceRef

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `start` | oui | entier | minimum : `0` |
| `end` | oui | entier | strictement supérieur à : `0` |

<a id="schema-expertreview"></a>
### ExpertReview

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `task_id` | oui | texte | format : `"uuid"` |
| `proposal_id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | — |
| `proposal_digest` | oui | texte | — |
| `proposal_review_revision` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `task_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `opinion` | oui | `"supports"`, `"changes_requested"`, `"insufficient_evidence"` | — |
| `justification` | oui | texte | — |
| `evidence_source_ids` | oui | liste de texte | éléments max. : `20` |
| `created_at` | oui | texte | format : `"date-time"` |
| `validity` | oui | `"current"`, `"stale"` | — |

<a id="schema-expertreviewinput"></a>
### ExpertReviewInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `proposal_id` | oui | texte | format : `"uuid"` |
| `digest` | oui | texte | longueur min. : `1`; longueur max. : `128` |
| `expected_review_revision` | oui | entier | minimum : `0`; maximum : `2147483647` |
| `expected_task_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `opinion` | oui | `"supports"`, `"changes_requested"`, `"insufficient_evidence"` | — |
| `justification` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `evidence_source_ids` | oui | liste de texte | éléments max. : `20` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-expertreviewpage"></a>
### ExpertReviewPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `task_id` | oui | texte | format : `"uuid"` |
| `proposal_id` | oui | texte | format : `"uuid"` |
| `items` | oui | liste de [ExpertReview](#schema-expertreview) | éléments max. : `50` |
| `total` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `next_after` | oui | texte / null | — |
| `has_more` | oui | booléen | — |
| `as_of` | oui | texte | format : `"date-time"` |
| `permissions_version` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `work_version` | oui | entier | minimum : `0`; maximum : `9007199254740991` |

<a id="schema-expertreviewreceipt"></a>
### ExpertReviewReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `task_id` | oui | texte | format : `"uuid"` |
| `event_id` | oui | texte | format : `"uuid"` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `status` | oui | `"unassigned"`, `"offered"`, `"in_progress"`, `"blocked"`, `"review"`, `"completed"`, `"cancelled"` | — |
| `expert_review_id` | oui | texte | format : `"uuid"` |

<a id="schema-graphimportattempt"></a>
### GraphImportAttempt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `generation` | oui | entier | minimum : `1`; maximum : `9223372036854775807` |
| `predecessor_id` | oui | texte / null | — |
| `subject` | oui | texte | — |
| `reason` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `active` | oui | booléen | — |
| `status` | oui | `"preparing"`, `"uncertain"`, `"ready"`, `"stale"`, `"superseded"` | — |
| `base_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `digest` | oui | texte / null | — |
| `count` | oui | entier / null | — |
| `intent_sealed` | oui | booléen | — |

<a id="schema-graphimportattemptpage"></a>
### GraphImportAttemptPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `target_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `published_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `manifest_registered` | oui | booléen | — |
| `digest` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `count` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `projection_matches_journal` | oui | booléen / null | — |
| `active_attempt` | oui | [GraphImportAttempt](#schema-graphimportattempt) / null | — |
| `items` | oui | liste de [GraphImportAttempt](#schema-graphimportattempt) | — |
| `next_after` | oui | entier / null | — |

<a id="schema-graphimportinput"></a>
### GraphImportInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_published_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `expected_projection_digest` | oui | texte | motif : `"^[0-9a-f]{64}$"` |

<a id="schema-graphimportreceipt"></a>
### GraphImportReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `target_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `published_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `manifest_registered` | oui | booléen | — |
| `attempt` | oui | [GraphImportAttempt](#schema-graphimportattempt) / null | — |
| `outcome` | oui | `"registered"`, `"unresolved"`, `"superseded"` | — |

<a id="schema-graphimportretryinput"></a>
### GraphImportRetryInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_published_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `expected_attempt_id` | oui | texte | format : `"uuid"` |
| `expected_generation` | oui | entier | minimum : `1`; maximum : `9223372036854775806` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `200` |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `expected_projection_digest` | oui | texte | motif : `"^[0-9a-f]{64}$"` |

<a id="schema-graphmap"></a>
### GraphMap

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `domain_id` | oui | texte | format : `"uuid"` |
| `at_version` | oui | entier | minimum : `0` |
| `nodes` | oui | liste de objet | éléments max. : `10000` |
| `edges` | oui | liste de liste de entier / nombre / texte / null | éléments max. : `400000` |
| `published_relations` | oui | entier | minimum : `0` |
| `documentary_references` | oui | entier | minimum : `0` |

<a id="schema-graphnodesummary"></a>
### GraphNodeSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `concept_id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `maturity` | oui | `"emerging"`, `"observed"`, `"established"`, `"reference"` | — |
| `source_count` | oui | entier | minimum : `0` |
| `outgoing_relations` | oui | entier | minimum : `0` |
| `incoming_relations` | oui | entier | minimum : `0` |

<a id="schema-graphpublicationattempt"></a>
### GraphPublicationAttempt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `generation` | oui | entier | minimum : `1`; maximum : `9223372036854775807` |
| `predecessor_id` | oui | texte / null | — |
| `subject` | oui | texte | — |
| `reason` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `active` | oui | booléen | — |
| `status` | oui | `"preparing"`, `"uncertain"`, `"ready"`, `"stale"`, `"superseded"` | — |
| `base_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `digest` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `count` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |

<a id="schema-graphpublicationattemptpage"></a>
### GraphPublicationAttemptPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `proposal_id` | oui | texte | format : `"uuid"` |
| `target_version` | oui | entier | minimum : `1`; maximum : `9223372036854775807` |
| `published_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `active_attempt` | oui | [GraphPublicationAttempt](#schema-graphpublicationattempt) / null | — |
| `items` | oui | liste de [GraphPublicationAttempt](#schema-graphpublicationattempt) | — |
| `next_after` | oui | entier / null | — |

<a id="schema-graphpublicationevent"></a>
### GraphPublicationEvent

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `attempt_id` | oui | texte | format : `"uuid"` |
| `generation` | oui | entier | minimum : `1`; maximum : `9223372036854775807` |
| `subject` | oui | texte | — |
| `kind` | oui | `"reserved"`, `"uncertain"`, `"ready"`, `"stale"`, `"superseded"` | — |
| `recorded_at` | oui | texte | format : `"date-time"` |

<a id="schema-graphpublicationeventpage"></a>
### GraphPublicationEventPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [GraphPublicationEvent](#schema-graphpublicationevent) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-graphpublicationretryinput"></a>
### GraphPublicationRetryInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_published_version` | oui | entier | minimum : `0`; maximum : `9223372036854775806` |
| `expected_attempt_id` | oui | texte | format : `"uuid"` |
| `expected_generation` | oui | entier | minimum : `1`; maximum : `9223372036854775806` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `200` |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |

<a id="schema-graphpublicationretryreceipt"></a>
### GraphPublicationRetryReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `proposal_id` | oui | texte | format : `"uuid"` |
| `target_version` | oui | entier | minimum : `1`; maximum : `9223372036854775807` |
| `published_version` | oui | entier | minimum : `0`; maximum : `9223372036854775807` |
| `attempt` | oui | [GraphPublicationAttempt](#schema-graphpublicationattempt) | — |
| `outcome` | oui | `"published"`, `"unresolved"`, `"superseded"` | — |

<a id="schema-graphrelationsummary"></a>
### GraphRelationSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `from` | oui | texte | format : `"uuid"` |
| `to` | oui | texte | format : `"uuid"` |
| `kind` | oui | `"structural"`, `"associative"` | — |
| `weight` | oui | nombre | minimum : `0`; maximum : `1` |
| `primary` | oui | booléen | — |

<a id="schema-graphscene"></a>
### GraphScene

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `domain_id` | oui | texte | format : `"uuid"` |
| `at_version` | oui | entier | minimum : `0` |
| `visibility` | oui | texte | — |
| `totals` | oui | objet | — |
| `bounds` | oui | [MapBounds](#schema-mapbounds) | — |
| `glyphs` | oui | liste de [MapGlyph](#schema-mapglyph) | éléments max. : `24` |
| `links` | oui | liste de objet | éléments max. : `120` |
| `view` | oui | [MapBounds](#schema-mapbounds) | — |
| `cell_size` | oui | nombre | — |
| `routes_total` | oui | entier | minimum : `0` |
| `coverage` | oui | `"viewport"` | — |

<a id="schema-graphtotals"></a>
### GraphTotals

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `concepts` | oui | entier | minimum : `0` |
| `relations` | oui | entier | minimum : `0` |

<a id="schema-graphwindow"></a>
### GraphWindow

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `domain_id` | oui | texte | format : `"uuid"` |
| `at_version` | oui | entier | minimum : `0`; maximum : `9007199254740990` |
| `visibility` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `focus` | oui | [GraphNodeSummary](#schema-graphnodesummary) / null | — |
| `after` | oui | texte / null | — |
| `limit` | oui | entier | minimum : `1`; maximum : `50` |
| `domain_totals` | oui | [GraphTotals](#schema-graphtotals) | — |
| `scope_totals` | oui | [GraphTotals](#schema-graphtotals) | — |
| `nodes` | oui | liste de [GraphNodeSummary](#schema-graphnodesummary) | éléments max. : `50` |
| `edges` | oui | liste de [GraphRelationSummary](#schema-graphrelationsummary) | éléments max. : `120` |
| `next_after` | oui | texte / null | — |
| `internal_relations` | oui | entier | minimum : `0` |
| `boundary_outgoing_relations` | oui | entier | minimum : `0` |
| `edges_truncated` | oui | booléen | — |
| `before` | oui | texte / null | — |
| `locate` | oui | texte / null | — |
| `previous_before` | oui | texte / null | — |
| `direction` | oui | `"both"`, `"outgoing"` | — |
| `search` | oui | texte / null | — |
| `scope_ids` | oui | liste de texte / null | — |

<a id="schema-importcommandinput"></a>
### ImportCommandInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action` | oui | `"process"`, `"retry"`, `"cancel"` | — |
| `expected_digest` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |
| `limit` | oui | entier | minimum : `1`; maximum : `20` |

<a id="schema-importcommandreceipt"></a>
### ImportCommandReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `import_id` | oui | texte | format : `"uuid"` |
| `action` | oui | `"process"`, `"retry"`, `"cancel"` | — |
| `before_digest` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `after_digest` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `status` | oui | `"pending"`, `"partial"`, `"succeeded"`, `"failed"`, `"cancelled"` | — |
| `affected_items` | oui | entier | minimum : `0`; maximum : `20` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-importcommandstate"></a>
### ImportCommandState

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `job` | oui | objet | — |
| `digest` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `allowed_actions` | oui | liste de `"process"`, `"retry"`, `"cancel"` | éléments max. : `3` |

<a id="schema-journalpublication"></a>
### JournalPublication

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `sequence` | oui | entier | minimum : `1`; maximum : `9007199254740990` |
| `proposal_id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | — |
| `reason` | oui | texte | — |
| `digest` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `published` | oui | booléen | — |
| `publication` | oui | [JournalPublicationAudit](#schema-journalpublicationaudit) / null | — |

<a id="schema-journalpublicationaudit"></a>
### JournalPublicationAudit

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `publisher` | oui | texte | — |
| `recorded_at` | oui | texte | format : `"date-time"` |

<a id="schema-mapbounds"></a>
### MapBounds

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `x` | oui | nombre | — |
| `y` | oui | nombre | — |
| `w` | oui | nombre | — |
| `h` | oui | nombre | — |

<a id="schema-mapglyph"></a>
### MapGlyph

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | — |
| `concept_id` | oui | texte / null | — |
| `title` | oui | texte | — |
| `x` | oui | nombre | — |
| `y` | oui | nombre | — |
| `count` | oui | entier | minimum : `0` |
| `bounds` | oui | [MapBounds](#schema-mapbounds) | — |
| `degree` | oui | entier | minimum : `0` |

<a id="schema-maplink"></a>
### MapLink

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `from` | oui | texte | — |
| `to` | oui | texte | — |
| `kind` | oui | `"reference"`, `"structural"`, `"associative"` | — |
| `weight` | oui | nombre / null | — |

<a id="schema-mapnode"></a>
### MapNode

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | — |
| `title` | oui | texte | — |
| `maturity` | oui | texte | — |
| `group` | oui | texte | — |
| `territory` | oui | texte | — |
| `x` | oui | nombre | — |
| `y` | oui | nombre | — |
| `degree` | oui | entier | minimum : `0` |

<a id="schema-mapnodepage"></a>
### MapNodePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `domain_id` | oui | texte | format : `"uuid"` |
| `at_version` | oui | entier | minimum : `0` |
| `visibility` | oui | texte | — |
| `totals` | oui | objet | — |
| `bounds` | oui | [MapBounds](#schema-mapbounds) | — |
| `total` | oui | entier | minimum : `0` |
| `offset` | oui | entier | minimum : `0` |
| `items` | oui | liste de objet | éléments max. : `16` |
| `selected` | oui | [MapNode](#schema-mapnode) / null | — |
| `focus_bounds` | oui | [MapBounds](#schema-mapbounds) / null | — |
| `page_size` | oui | `8`, `16` | — |

<a id="schema-proposaldifferencesummary"></a>
### ProposalDifferenceSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `proposal_id` | oui | texte | format : `"uuid"` |
| `base_version` | oui | entier | — |
| `published_version` | oui | entier | — |
| `comparison` | oui | `"accepted_before_state"`, `"current_published_state"` | — |
| `stale_base` | oui | booléen | — |
| `items` | oui | liste de [DifferenceSummaryConceptDifference](#schema-differencesummaryconceptdifference) | éléments max. : `50` |

<a id="schema-proposalexpertreviewpage"></a>
### ProposalExpertReviewPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `proposal_id` | oui | texte | format : `"uuid"` |
| `items` | oui | liste de [ExpertReview](#schema-expertreview) | éléments max. : `50` |
| `total` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `next_after` | oui | texte / null | — |
| `has_more` | oui | booléen | — |
| `as_of` | oui | texte | format : `"date-time"` |
| `permissions_version` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `work_version` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `proposal_digest` | oui | texte | — |
| `proposal_review_revision` | oui | entier | minimum : `0` |

<a id="schema-publicationwindow"></a>
### PublicationWindow

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `domain_id` | oui | texte | format : `"uuid"` |
| `at_version` | oui | entier | minimum : `0`; maximum : `9007199254740990` |
| `since` | oui | texte / null | — |
| `until` | oui | texte / null | — |
| `items` | oui | liste de [JournalPublication](#schema-journalpublication) | éléments max. : `50` |
| `next_before` | oui | entier / null | — |
| `scan_limited` | oui | booléen | — |

<a id="schema-referencedraft"></a>
### ReferenceDraft

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `content` | oui | [ReferenceDraftContent](#schema-referencedraftcontent) | — |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `updated_at` | oui | texte | format : `"date-time"` |
| `status` | oui | `"draft"` | — |
| `visibility` | oui | `"personal"` | — |

<a id="schema-referencedraftcontent"></a>
### ReferenceDraftContent

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `theme` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `question` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `criteria` | oui | texte | longueur min. : `1`; longueur max. : `8000` |
| `source_id` | oui | texte | format : `"uuid"` |
| `source_hash` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `excerpt` | oui | texte | longueur min. : `1`; longueur max. : `10000` |
| `selection` | oui | objet | — |

<a id="schema-referencedraftinput"></a>
### ReferenceDraftInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `content` | oui | [ReferenceDraftContent](#schema-referencedraftcontent) | — |
| `expected_revision` | oui | entier | minimum : `0`; maximum : `9007199254740990` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-referencedraftpage"></a>
### ReferenceDraftPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ReferenceDraftSummary](#schema-referencedraftsummary) | éléments max. : `20` |
| `next_after` | oui | texte / null | — |

<a id="schema-referencedraftreceipt"></a>
### ReferenceDraftReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `receipt_id` | oui | texte | format : `"uuid"` |
| `question_id` | oui | texte | format : `"uuid"` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |

<a id="schema-referencedraftreceiptrecord"></a>
### ReferenceDraftReceiptRecord

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `command_id` | oui | texte | format : `"uuid"` |
| `receipt` | oui | [ReferenceDraftReceipt](#schema-referencedraftreceipt) | — |

<a id="schema-referencedraftsummary"></a>
### ReferenceDraftSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `theme` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `question` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `updated_at` | oui | texte | format : `"date-time"` |

<a id="schema-referencereviewcommandinput"></a>
### ReferenceReviewCommandInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action` | oui | `"withdraw"`, `"request_changes"`, `"ready_for_owner"` | — |
| `expected_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `note` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-referencereviewdetail"></a>
### ReferenceReviewDetail

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `reviewer` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `draft_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `status` | oui | `"awaiting_review"`, `"changes_requested"`, `"ready_for_owner"`, `"withdrawn"` | — |
| `updated_at` | oui | texte | format : `"date-time"` |
| `question_id` | oui | texte | format : `"uuid"` |
| `content` | oui | [ReferenceDraftContent](#schema-referencedraftcontent) / null | — |
| `review_note` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `actions` | oui | liste de `"withdraw"`, `"request_changes"`, `"ready_for_owner"` | — |

<a id="schema-referencereviewevent"></a>
### ReferenceReviewEvent

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `actor` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `action` | oui | `"submit"`, `"request_changes"`, `"ready_for_owner"`, `"withdraw"` | — |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `status` | oui | `"awaiting_review"`, `"changes_requested"`, `"ready_for_owner"`, `"withdrawn"` | — |
| `note` | oui | texte / null | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-referencerevieweventpage"></a>
### ReferenceReviewEventPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `review_id` | oui | texte | format : `"uuid"` |
| `review_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `status` | oui | `"awaiting_review"`, `"changes_requested"`, `"ready_for_owner"`, `"withdrawn"` | — |
| `content_withheld` | oui | booléen | — |
| `total` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `items` | oui | liste de [ReferenceReviewEvent](#schema-referencereviewevent) | éléments max. : `20` |
| `next_after` | oui | entier / null | — |

<a id="schema-referencereviewpage"></a>
### ReferenceReviewPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ReferenceReviewSummary](#schema-referencereviewsummary) | — |
| `next_after` | oui | texte / null | — |
| `scope` | oui | `"mine"`, `"assigned"` | — |

<a id="schema-referencereviewpreparation"></a>
### ReferenceReviewPreparation

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `question_id` | oui | texte | format : `"uuid"` |
| `draft_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `reviewer` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `preparation_id` | oui | texte | format : `"uuid"` |
| `content` | oui | [ReferenceDraftContent](#schema-referencedraftcontent) | — |
| `expires_at` | oui | texte | format : `"date-time"` |

<a id="schema-referencereviewreceipt"></a>
### ReferenceReviewReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `review_id` | oui | texte | format : `"uuid"` |
| `event_id` | oui | texte | format : `"uuid"` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `status` | oui | `"awaiting_review"`, `"changes_requested"`, `"ready_for_owner"`, `"withdrawn"` | — |

<a id="schema-referencereviewreceiptrecord"></a>
### ReferenceReviewReceiptRecord

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `command_id` | oui | texte | format : `"uuid"` |
| `receipt` | oui | [ReferenceReviewReceipt](#schema-referencereviewreceipt) | — |

<a id="schema-referencereviewselection"></a>
### ReferenceReviewSelection

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `question_id` | oui | texte | format : `"uuid"` |
| `draft_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `reviewer` | oui | texte | longueur min. : `1`; longueur max. : `200` |

<a id="schema-referencereviewsubmitinput"></a>
### ReferenceReviewSubmitInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `question_id` | oui | texte | format : `"uuid"` |
| `draft_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `reviewer` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `preparation_id` | oui | texte | format : `"uuid"` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-referencereviewsummary"></a>
### ReferenceReviewSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `reviewer` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `draft_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `status` | oui | `"awaiting_review"`, `"changes_requested"`, `"ready_for_owner"`, `"withdrawn"` | — |
| `updated_at` | oui | texte | format : `"date-time"` |
| `question` | oui | texte / null | — |

<a id="schema-referencereviewerpage"></a>
### ReferenceReviewerPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ReferenceReviewerSummary](#schema-referencereviewersummary) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-referencereviewersummary"></a>
### ReferenceReviewerSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `subject` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `role` | oui | `"owner"`, `"corpus_manager"` | — |

<a id="schema-sharedcase"></a>
### SharedCase

[SharedCaseDeclarant](#schema-sharedcasedeclarant) / [SharedCaseTeam](#schema-sharedcaseteam) / [SharedCaseWithdrawn](#schema-sharedcasewithdrawn) ; —

<a id="schema-sharedcasecommand"></a>
### SharedCaseCommand

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action` | oui | `"withdraw"`, `"qualify"`, `"close_without_change"`, `"reopen"` | — |
| `expected_revision` | oui | entier | minimum : `1` |
| `qualification` | non | `"incorrect"`, `"missing"`, `"outdated"`, `"unclear"`, `"behavior"`, `"other"` | — |
| `public_conclusion` | non | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-sharedcasecontent"></a>
### SharedCaseContent

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `title` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `excerpt` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `target` | oui | `"retrieved_evidence"`, `"delivered_answer"`, `"client_behavior"` | — |
| `recipients` | oui | liste de texte | éléments min. : `1`; éléments max. : `20` |
| `policy_version` | oui | `"named-excerpt-v1"` | — |
| `personal_signal_id` | non | texte / null | — |

<a id="schema-sharedcasedeclarant"></a>
### SharedCaseDeclarant

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `audience` | oui | `"declarant"` | — |
| `id` | oui | texte | format : `"uuid"` |
| `status` | oui | `"new"`, `"qualified"`, `"closed_without_change"`, `"withdrawn"` | — |
| `revision` | oui | entier | minimum : `1` |
| `created_at` | oui | texte | format : `"date-time"` |
| `updated_at` | oui | texte | format : `"date-time"` |
| `allowed_actions` | oui | liste de `"withdraw"`, `"qualify"`, `"close_without_change"`, `"reopen"` | éléments max. : `4` |
| `title` | oui | texte | — |
| `excerpt` | oui | texte | — |
| `target` | oui | `"retrieved_evidence"`, `"delivered_answer"`, `"client_behavior"` | — |
| `origin` | oui | `"explicit"`, `"observed"`, `"inferred"` | — |
| `qualification` | oui | texte | — |
| `public_conclusion` | oui | texte | — |
| `policy_version` | oui | `"named-excerpt-v1"` | — |
| `recipients` | oui | liste de texte | éléments max. : `20` |
| `personal_signal_id` | oui | texte / null | — |

<a id="schema-sharedcaseevents"></a>
### SharedCaseEvents

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `case_id` | oui | texte | format : `"uuid"` |
| `audience` | oui | `"declarant"`, `"team"` | — |
| `items` | oui | liste de objet | éléments max. : `50` |
| `next_after` | oui | texte / null | — |
| `total` | oui | entier | minimum : `1` |
| `as_of` | oui | texte | format : `"date-time"` |

<a id="schema-sharedcasepage"></a>
### SharedCasePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [SharedCase](#schema-sharedcase) | éléments max. : `50` |
| `next_after` | oui | texte / null | — |
| `total` | oui | entier | minimum : `0` |
| `has_more` | oui | booléen | — |
| `as_of` | oui | texte | format : `"date-time"` |
| `scope` | oui | `"mine"`, `"team"` | — |
| `permissions_version` | oui | entier | minimum : `0` |
| `work_version` | oui | entier | minimum : `0` |
| `completeness` | oui | `"partial"`, `"complete"` | — |
| `sort` | oui | `"created_at_asc_id_asc"` | — |

<a id="schema-sharedcasepreparation"></a>
### SharedCasePreparation

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `preparation_id` | oui | texte | format : `"uuid"` |
| `content_hash` | oui | texte | — |
| `expires_at` | oui | texte | format : `"date-time"` |
| `permissions_version` | oui | entier | minimum : `0` |
| `policy_version` | oui | `"named-excerpt-v1"` | — |
| `origin` | oui | `"explicit"`, `"observed"`, `"inferred"` | — |

<a id="schema-sharedcasereceipt"></a>
### SharedCaseReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `case_id` | oui | texte | format : `"uuid"` |
| `event_id` | oui | texte | format : `"uuid"` |
| `revision` | oui | entier | minimum : `1` |
| `status` | oui | `"new"`, `"qualified"`, `"closed_without_change"`, `"withdrawn"` | — |

<a id="schema-sharedcaserecipients"></a>
### SharedCaseRecipients

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de objet | éléments max. : `50` |
| `next_after` | oui | texte / null | — |
| `total` | oui | entier | minimum : `0` |
| `as_of` | oui | texte | format : `"date-time"` |
| `permissions_version` | oui | entier | minimum : `0` |

<a id="schema-sharedcaseshare"></a>
### SharedCaseShare

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `preparation_id` | oui | texte | format : `"uuid"` |
| `content` | oui | [SharedCaseContent](#schema-sharedcasecontent) | — |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-sharedcaseteam"></a>
### SharedCaseTeam

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `audience` | oui | `"team"` | — |
| `id` | oui | texte | format : `"uuid"` |
| `status` | oui | `"new"`, `"qualified"`, `"closed_without_change"`, `"withdrawn"` | — |
| `revision` | oui | entier | minimum : `1` |
| `created_at` | oui | texte | format : `"date-time"` |
| `updated_at` | oui | texte | format : `"date-time"` |
| `allowed_actions` | oui | liste de `"withdraw"`, `"qualify"`, `"close_without_change"`, `"reopen"` | éléments max. : `4` |
| `title` | oui | texte | — |
| `excerpt` | oui | texte | — |
| `target` | oui | `"retrieved_evidence"`, `"delivered_answer"`, `"client_behavior"` | — |
| `origin` | oui | `"explicit"`, `"observed"`, `"inferred"` | — |
| `qualification` | oui | texte | — |
| `public_conclusion` | oui | texte | — |
| `policy_version` | oui | `"named-excerpt-v1"` | — |
| `declarant` | oui | texte | — |

<a id="schema-sharedcasewithdrawn"></a>
### SharedCaseWithdrawn

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `audience` | oui | `"withdrawn"` | — |
| `id` | oui | texte | format : `"uuid"` |
| `status` | oui | `"new"`, `"qualified"`, `"closed_without_change"`, `"withdrawn"` | — |
| `revision` | oui | entier | minimum : `1` |
| `created_at` | oui | texte | format : `"date-time"` |
| `updated_at` | oui | texte | format : `"date-time"` |
| `allowed_actions` | oui | liste de `"withdraw"`, `"qualify"`, `"close_without_change"`, `"reopen"` | éléments max. : `4` |

<a id="schema-sourceaccessevent"></a>
### SourceAccessEvent

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `actor` | oui | texte / null | — |
| `actor_source` | oui | `"runtime_context"`, `"unattributed"` | — |
| `previous_allowed_subjects` | oui | liste de texte | éléments min. : `1` |
| `allowed_subjects` | oui | liste de texte | éléments min. : `1` |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-sourceaccesseventpage"></a>
### SourceAccessEventPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `current_allowed_subjects` | oui | liste de texte | éléments min. : `1` |
| `history_scope` | oui | `"changes_since_audit_migration"` | — |
| `items` | oui | liste de [SourceAccessEvent](#schema-sourceaccessevent) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-sourcelocateinput"></a>
### SourceLocateInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `excerpt` | oui | texte | longueur min. : `1`; longueur max. : `200000` |
| `expected_hash` | non | texte | motif : `"^[0-9a-f]{64}$"` |
| `start` | non | entier | minimum : `0`; maximum : `2147483646` |

<a id="schema-sourcelocation"></a>
### SourceLocation

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | longueur max. : `200` |
| `location` | oui | texte | longueur max. : `1000` |
| `content_hash` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `start` | oui | entier | minimum : `0`; maximum : `2147483646` |
| `end` | oui | entier | minimum : `0`; maximum : `2147483647` |
| `total_characters` | oui | entier | minimum : `0`; maximum : `2147483647` |
| `offset_unit` | oui | `"unicode_code_point"` | — |

<a id="schema-sourcepassage"></a>
### SourcePassage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | longueur max. : `200` |
| `location` | oui | texte | longueur max. : `1000` |
| `content_hash` | oui | texte | motif : `"^[0-9a-f]{64}$"` |
| `start` | oui | entier | minimum : `0`; maximum : `2147483646` |
| `end` | oui | entier | minimum : `0`; maximum : `2147483647` |
| `total_characters` | oui | entier | minimum : `0`; maximum : `2147483647` |
| `excerpt` | oui | texte | longueur max. : `8192` |
| `next_offset` | oui | entier / null | minimum : `0`; maximum : `2147483647` |
| `offset_unit` | oui | `"unicode_code_point"` | — |

<a id="schema-taskcandidate"></a>
### TaskCandidate

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `subject` | oui | texte | — |
| `role` | oui | `"owner"`, `"corpus_manager"`, `"contributor"` | — |

<a id="schema-taskcandidatepage"></a>
### TaskCandidatePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [TaskCandidate](#schema-taskcandidate) | éléments max. : `50` |
| `next_after` | oui | texte / null | — |

<a id="schema-taskcommandrecord"></a>
### TaskCommandRecord

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `command_id` | oui | texte | format : `"uuid"` |
| `receipt` | oui | [WorkTaskReceipt](#schema-worktaskreceipt) | — |
| `action` | oui | `"create"`, `"offer"`, `"accept"`, `"decline"`, `"block"`, `"resume"`, `"submit"`, `"request_changes"`, `"complete"`, `"cancel"`, `"reopen"`, `"link_proposal"`, `"expert_review"`, `"plan"` | — |
| `recorded_at` | oui | texte | format : `"date-time"` |
| `task_title` | oui | texte / null | longueur max. : `200` |
| `current_revision` | oui | entier / null | minimum : `1`; maximum : `9007199254740991` |
| `current_status` | oui | `"unassigned"`, `"offered"`, `"in_progress"`, `"blocked"`, `"review"`, `"completed"`, `"cancelled"` / null | — |
| `outcome` | oui | `"recorded"` | — |

<a id="schema-taskcommandrecordpage"></a>
### TaskCommandRecordPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [TaskCommandRecord](#schema-taskcommandrecord) | éléments max. : `50` |
| `next_after` | oui | texte / null | — |
| `has_more` | oui | booléen | — |
| `total` | oui | entier | minimum : `0` |
| `as_of` | oui | texte | format : `"date-time"` |
| `scope` | oui | `"personal"` | — |
| `permissions_version` | oui | entier | minimum : `0` |
| `work_version` | oui | entier | minimum : `0` |
| `completeness` | oui | `"partial"`, `"complete"` | — |
| `sort` | oui | `"created_at_desc_id_desc"` | — |

<a id="schema-tasknotification"></a>
### TaskNotification

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `event_id` | oui | texte | — |
| `task_id` | oui | texte | — |
| `title` | oui | texte | — |
| `current_status` | oui | `"unassigned"`, `"offered"`, `"in_progress"`, `"blocked"`, `"review"`, `"completed"`, `"cancelled"` | — |
| `action` | oui | texte | — |
| `actor` | oui | texte | — |
| `revision` | oui | entier | minimum : `0` |
| `created_at` | oui | texte | format : `"date-time"` |
| `read_at` | oui | texte / null | — |

<a id="schema-tasknotificationpage"></a>
### TaskNotificationPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [TaskNotification](#schema-tasknotification) | éléments max. : `50` |
| `next_after` | oui | texte / null | — |
| `has_more` | oui | booléen | — |
| `total` | oui | entier | minimum : `0` |
| `as_of` | oui | texte | format : `"date-time"` |
| `scope` | oui | `"personal"` | — |
| `permissions_version` | oui | entier | minimum : `0` |
| `work_version` | oui | entier | minimum : `0` |
| `completeness` | oui | `"partial"`, `"complete"` | — |
| `sort` | oui | `"created_at_desc_id_desc"` | — |
| `unread` | oui | entier | minimum : `0` |

<a id="schema-tasknotificationread"></a>
### TaskNotificationRead

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-tasknotificationreceipt"></a>
### TaskNotificationReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `event_id` | oui | texte | — |
| `read_at` | oui | texte | format : `"date-time"` |

<a id="schema-taskplanchange"></a>
### TaskPlanChange

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `before` | oui | [TaskPlanState](#schema-taskplanstate) | — |
| `after` | oui | [TaskPlanState](#schema-taskplanstate) | — |

<a id="schema-taskplaninput"></a>
### TaskPlanInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_revision` | oui | entier | minimum : `1`; maximum : `9007199254740990` |
| `priority` | oui | `"low"`, `"normal"`, `"high"` | — |
| `due_at` | oui | texte / null | — |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-taskplanstate"></a>
### TaskPlanState

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `priority` | oui | `"low"`, `"normal"`, `"high"` | — |
| `due_at` | oui | texte / null | — |

<a id="schema-taskproposallinkinput"></a>
### TaskProposalLinkInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `proposal_id` | oui | texte | format : `"uuid"` |
| `expected_task_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-taskproposalreference"></a>
### TaskProposalReference

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `proposal_id` | oui | texte | format : `"uuid"` |
| `digest` | oui | texte | — |
| `review_revision` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `status` | oui | texte | — |
| `linked_by` | oui | texte | — |
| `linked_at` | oui | texte | format : `"date-time"` |
| `can_review` | oui | booléen | — |

<a id="schema-taskproposalreferences"></a>
### TaskProposalReferences

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `task_id` | oui | texte | format : `"uuid"` |
| `task_revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `items` | oui | liste de [TaskProposalReference](#schema-taskproposalreference) | éléments max. : `20` |
| `total` | oui | entier | minimum : `0`; maximum : `20` |
| `max_links` | oui | `20` | — |
| `as_of` | oui | texte | format : `"date-time"` |
| `can_link` | oui | booléen | — |

<a id="schema-workactivityitem"></a>
### WorkActivityItem

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `kind` | oui | `"task"`, `"reference_review"`, `"mission"`, `"shared_case"` | — |
| `event_id` | oui | texte | format : `"uuid"` |
| `target_id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte / null | — |
| `current_status` | oui | texte | — |
| `current_revision` | oui | entier | minimum : `1` |
| `action` | oui | texte | — |
| `actor` | oui | texte / null | — |
| `event_revision` | oui | entier | minimum : `1` |
| `created_at` | oui | texte | format : `"date-time"` |
| `read_at` | oui | texte / null | format : `"date-time"` |
| `content_available` | oui | booléen | — |

<a id="schema-workactivitypage"></a>
### WorkActivityPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [WorkActivityItem](#schema-workactivityitem) | éléments max. : `20` |
| `next_after` | oui | texte / null | format : `"uuid"` |
| `total` | oui | entier | minimum : `0` |
| `unread` | oui | entier | minimum : `0` |
| `as_of` | oui | texte | format : `"date-time"` |
| `permissions_version` | oui | entier | minimum : `0` |
| `work_version` | oui | entier | minimum : `0` |
| `source_access_version` | oui | entier | minimum : `0` |
| `scope` | oui | `"personal"` | — |
| `sort` | oui | `"created_kind_event_desc"` | — |
| `coverage` | oui | liste de `"task_notifications"`, `"named_reference_reviews"`, `"mission_claims_and_reports"`, `"named_shared_cases"` | — |

<a id="schema-workactivityread"></a>
### WorkActivityRead

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `kind` | oui | `"task"`, `"reference_review"`, `"mission"`, `"shared_case"` | — |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-workactivityreceipt"></a>
### WorkActivityReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `kind` | oui | `"task"`, `"reference_review"`, `"mission"`, `"shared_case"` | — |
| `event_id` | oui | texte | format : `"uuid"` |
| `read_at` | oui | texte | format : `"date-time"` |

<a id="schema-workbrief"></a>
### WorkBrief

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `scope` | oui | `"assigned"`, `"domain"` | — |
| `role` | oui | `"owner"`, `"corpus_manager"`, `"contributor"` | — |
| `as_of` | oui | texte | format : `"date-time"` |
| `permissions_version` | oui | entier | minimum : `0` |
| `work_version` | oui | entier | minimum : `0` |
| `counts` | oui | objet | — |
| `items` | oui | liste de objet | éléments max. : `5` |
| `has_more` | oui | booléen | — |
| `sort` | oui | `"overdue_review_offer_blocked_unassigned_progress_due_created_id"`, `"overdue_priority_review_offer_blocked_unassigned_progress_due_created_id"` | — |
| `coverage` | oui | `"active_tasks_only"` | — |

<a id="schema-workcaseoverview"></a>
### WorkCaseOverview

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `total` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `items` | oui | liste de [WorkCaseSummary](#schema-workcasesummary) | éléments max. : `5` |
| `has_more` | oui | booléen | — |
| `sort` | oui | `"created_at_asc_id_asc"` | — |

<a id="schema-workcasesummary"></a>
### WorkCaseSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `status` | oui | `"new"`, `"qualified"` | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-workimportoverview"></a>
### WorkImportOverview

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `total` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `items` | oui | liste de [WorkImportSummary](#schema-workimportsummary) | éléments max. : `5` |
| `has_more` | oui | booléen | — |
| `sort` | oui | `"failed_first_created_at_asc_id_asc"` | — |
| `pending_jobs` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `failed_jobs` | oui | entier | minimum : `0`; maximum : `9007199254740991` |

<a id="schema-workimportsummary"></a>
### WorkImportSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `collection_id` | oui | texte | format : `"uuid"` |
| `collection_name` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `pending` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `failed` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-workmissionoverview"></a>
### WorkMissionOverview

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `total` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `waiting` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `claimed` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `expired` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `reports` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `withheld` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `items` | oui | liste de [WorkMissionSummary](#schema-workmissionsummary) | éléments max. : `5` |
| `has_more` | oui | booléen | — |
| `sort` | oui | `"expired_report_created_id"` | — |

<a id="schema-workmissionsummary"></a>
### WorkMissionSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `status` | oui | `"queued"`, `"running"`, `"completed"` | — |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `created_at` | oui | texte | format : `"date-time"` |
| `expires_at` | oui | texte | format : `"date-time"` |
| `expired` | oui | booléen | — |
| `content_available` | oui | booléen | — |
| `title` | oui | texte / null | — |
| `reads_used` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `chars_used` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `max_reads` | oui | entier | minimum : `1`; maximum : `100` |
| `max_chars` | oui | entier | minimum : `1`; maximum : `100000` |

<a id="schema-workoverview"></a>
### WorkOverview

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `scope` | oui | `"assigned"`, `"domain"` | — |
| `role` | oui | `"owner"`, `"corpus_manager"`, `"contributor"`, `"viewer"` | — |
| `as_of` | oui | texte | format : `"date-time"` |
| `permissions_version` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `work_version` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `tasks` | oui | [WorkBrief](#schema-workbrief) / null | — |
| `received_cases` | oui | [WorkCaseOverview](#schema-workcaseoverview) / null | — |
| `my_cases` | oui | [WorkCaseOverview](#schema-workcaseoverview) | — |
| `imports` | oui | [WorkImportOverview](#schema-workimportoverview) / null | — |
| `coverage` | oui | `"authorized_active_work_only"` | — |
| `received_reference_reviews` | oui | [WorkReferenceReviewOverview](#schema-workreferencereviewoverview) / null | — |
| `my_reference_reviews` | oui | [WorkReferenceReviewOverview](#schema-workreferencereviewoverview) / null | — |
| `my_missions` | oui | [WorkMissionOverview](#schema-workmissionoverview) / null | — |

<a id="schema-workreferencereviewoverview"></a>
### WorkReferenceReviewOverview

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `total` | oui | entier | minimum : `0`; maximum : `9007199254740991` |
| `items` | oui | liste de [WorkReferenceReviewSummary](#schema-workreferencereviewsummary) | éléments max. : `5` |
| `has_more` | oui | booléen | — |
| `sort` | oui | `"created_at_asc_id_asc"` | — |

<a id="schema-workreferencereviewsummary"></a>
### WorkReferenceReviewSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `status` | oui | `"awaiting_review"`, `"changes_requested"`, `"ready_for_owner"` | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `question` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `author` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `reviewer` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `updated_at` | oui | texte | format : `"date-time"` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |

<a id="schema-worktask"></a>
### WorkTask

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | longueur max. : `200` |
| `instructions` | oui | texte | longueur max. : `2000` |
| `criteria` | oui | texte | longueur max. : `1000` |
| `creator` | oui | texte | — |
| `assignee` | oui | texte / null | — |
| `status` | oui | `"unassigned"`, `"offered"`, `"in_progress"`, `"blocked"`, `"review"`, `"completed"`, `"cancelled"` | — |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `created_at` | oui | texte | format : `"date-time"` |
| `updated_at` | oui | texte | format : `"date-time"` |
| `due_at` | oui | texte / null | — |
| `offered_at` | oui | texte / null | — |
| `accepted_at` | oui | texte / null | — |
| `result_summary` | oui | texte | longueur max. : `2000` |
| `allowed_actions` | oui | liste de `"offer"`, `"accept"`, `"decline"`, `"block"`, `"resume"`, `"submit"`, `"request_changes"`, `"complete"`, `"cancel"`, `"reopen"` | — |
| `priority` | non | `"low"`, `"normal"`, `"high"` | — |
| `priority_reason` | non | texte | longueur max. : `2000` |
| `planning_allowed` | non | booléen | — |

<a id="schema-worktaskcommand"></a>
### WorkTaskCommand

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action` | oui | `"offer"`, `"accept"`, `"decline"`, `"block"`, `"resume"`, `"submit"`, `"request_changes"`, `"complete"`, `"cancel"`, `"reopen"` | — |
| `expected_revision` | oui | entier | minimum : `1`; maximum : `9007199254740990` |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `assignee` | non | texte | longueur min. : `1`; longueur max. : `200` |
| `result_summary` | non | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-worktaskcreate"></a>
### WorkTaskCreate

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `title` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `instructions` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `criteria` | oui | texte | longueur min. : `1`; longueur max. : `1000` |
| `due_at` | non | texte / null | — |
| `idempotency_key` | oui | texte | format : `"uuid"` |

<a id="schema-worktaskevent"></a>
### WorkTaskEvent

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `task_id` | oui | texte | format : `"uuid"` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `actor` | oui | texte | — |
| `action` | oui | texte | — |
| `previous_status` | oui | texte | — |
| `status` | oui | `"unassigned"`, `"offered"`, `"in_progress"`, `"blocked"`, `"review"`, `"completed"`, `"cancelled"` | — |
| `assignee` | oui | texte / null | — |
| `reason` | oui | texte | longueur max. : `2000` |
| `result_summary` | oui | texte | longueur max. : `2000` |
| `created_at` | oui | texte | format : `"date-time"` |
| `planning` | non | [TaskPlanChange](#schema-taskplanchange) / null | — |

<a id="schema-worktaskeventpage"></a>
### WorkTaskEventPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [WorkTaskEvent](#schema-worktaskevent) | éléments max. : `50` |
| `next_after` | oui | texte / null | — |

<a id="schema-worktaskpage"></a>
### WorkTaskPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [WorkTask](#schema-worktask) | éléments max. : `50` |
| `next_after` | oui | texte / null | — |
| `has_more` | oui | booléen | — |
| `total` | oui | entier | minimum : `0` |
| `as_of` | oui | texte | format : `"date-time"` |
| `scope` | oui | `"domain"`, `"assigned"` | — |
| `permissions_version` | oui | entier | minimum : `0` |
| `work_version` | oui | entier | minimum : `0` |
| `completeness` | oui | `"partial"`, `"complete"` | — |
| `sort` | oui | `"created_at_asc_id_asc"` | — |

<a id="schema-worktaskreceipt"></a>
### WorkTaskReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `task_id` | oui | texte | format : `"uuid"` |
| `event_id` | oui | texte | format : `"uuid"` |
| `revision` | oui | entier | minimum : `1`; maximum : `9007199254740991` |
| `status` | oui | `"unassigned"`, `"offered"`, `"in_progress"`, `"blocked"`, `"review"`, `"completed"`, `"cancelled"` | — |
