# Extensions natives Rust — reprise de publication

Généré par `scripts/export_rust_contracts.py` depuis `services/rust-core/contracts/extensions.json`. Ne pas modifier directement. Le catalogue machine est `packages/contracts/rust-extensions.json` (section `functional` pour les descriptions françaises).

Ces **3 opérations HTTP et MCP** complètent les 79 opérations de référence. Lire le [guide frontend](frontend-guide.fr.md) et les contrats servis par le runtime Rust.

## Règles communes

- Les rôles listés sont des prérequis ; tenant, domaine, droits sur les preuves et propriété des objets personnels restent contrôlés par le serveur.
- Sur les routes protégées, envoyer `Authorization: Bearer …` et `X-Tenant-ID`. Le jeton provient de l'hôte authentifié, jamais d'un modèle.
- Les actions sensibles exigent une confirmation signée de l’hôte authentifié via `X-Cortex-Confirmation`, en HTTP comme en MCP. Le runtime Rust ne propose pas de mode qui supprime cette confirmation.
- Pour une reprise, conserver la clé d'idempotence uniquement si le schéma ou les paramètres la prévoient. Sans clé, ne pas répéter aveuglément une écriture.
- Les réponses d'erreur sont `{error, message?, details?}`. Les statuts ci-dessous sont le contrat déclaré commun, pas la preuve que chaque erreur est atteignable sur chaque route.
- Les champs absents et `null` sont distincts. Les bornes et champs requis sont repris du schéma ; des règles métier supplémentaires sont contrôlées à l'exécution.

## Index

| Action | HTTP | Fonction |
|---|---|---|
| [proposals.publication_attempts](#action-proposals-publication_attempts) | `GET /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts` | Inspecte les tentatives de publication de cette proposition et celle encore active. |
| [proposals.retry_publication](#action-proposals-retry_publication) | `POST /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts` | Prépare une nouvelle tentative de publication pour remplacer cette préparation incertaine. |
| [proposals.publication_events](#action-proposals-publication_events) | `GET /v1/domains/{domain}/proposals/{proposal_id}/publication-events` | Montre les événements de préparation et de reprise de cette publication. |

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

## Schémas des données

Les noms techniques restent identiques dans HTTP, TypeScript et MCP. Les champs d'un objet imbriqué sont décrits par le lien vers son schéma. Le JSON machine conserve toutes les contraintes, y compris les alternatives complexes.

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
