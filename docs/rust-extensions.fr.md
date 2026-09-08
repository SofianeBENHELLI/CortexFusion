# Extensions natives Rust — import et reprise des graphes

Généré par `scripts/export_rust_contracts.py` depuis `services/rust-core/contracts/extensions.json`. Ne pas modifier directement. Le catalogue machine est `packages/contracts/rust-extensions.json` (section `functional` pour les descriptions françaises).

Ces **7 opérations HTTP et MCP** complètent les 79 opérations de référence. Lire le [guide frontend](frontend-guide.fr.md) et les contrats servis par le runtime Rust.

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

## Schémas des données

Les noms techniques restent identiques dans HTTP, TypeScript et MCP. Les champs d'un objet imbriqué sont décrits par le lien vers son schéma. Le JSON machine conserve toutes les contraintes, y compris les alternatives complexes.

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
