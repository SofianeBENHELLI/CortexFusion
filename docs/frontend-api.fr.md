# Référence fonctionnelle française des endpoints

Générée par `scripts/export_frontend_reference.py` depuis OpenAPI, le catalogue HTTP/MCP et les descriptions relues de `docs/fr/actions.json`. Ne pas modifier ce fichier directement. Le contrôle `make contracts` refuse une opération non documentée.

Lire d'abord le [guide des parcours frontend](frontend-guide.fr.md). Cette référence décrit le comportement actuel, pas des fonctions futures. Le catalogue machine français est `packages/contracts/functional-interactions.fr.json`.

Couverture : **79 opérations HTTP**, chacune liée à son outil MCP généré. Les outils de compatibilité et les ressources/prompts sont décrits dans le guide MCP.

## Règles communes

- Les rôles listés sont des prérequis ; tenant, domaine, droits sur les preuves et propriété des objets personnels restent contrôlés par le serveur.
- Sur les routes protégées, envoyer `Authorization: Bearer …` et `X-Tenant-ID`. Le jeton provient de l'hôte authentifié, jamais d'un modèle.
- Les actions sensibles requièrent `X-Cortex-Confirmation` en MCP et en HTTP direct par défaut (`CORTEX_HTTP_CONFIRMATION_MODE=required`). Le mode HTTP `trusted_host` est une compatibilité explicite réservée à un hôte qui recueille les décisions ; il ne désactive jamais les confirmations MCP.
- Pour une reprise, conserver la clé d'idempotence uniquement si le schéma ou les paramètres la prévoient. Sans clé, ne pas répéter aveuglément une écriture.
- Les réponses d'erreur sont `{error, message?, details?}`. Les statuts ci-dessous sont le contrat déclaré commun, pas la preuve que chaque erreur est atteignable sur chaque route.
- Les champs absents et `null` sont distincts. Les bornes et champs requis sont repris du schéma ; des règles métier supplémentaires sont contrôlées à l'exécution.

## Index

| Action | HTTP | Fonction |
|---|---|---|
| [system.mcp_discovery](#action-system-mcp_discovery) | `GET /.well-known/oauth-protected-resource` | Découvre le fournisseur d'identité configuré pour cette ressource MCP. |
| [responses.create](#action-responses-create) | `POST /v1/domains/{domain}/episodes/{episode_id}/companion-responses` | Conserve la réponse de mon companion et ses références à cet épisode. |
| [responses.read](#action-responses-read) | `GET /v1/domains/{domain}/companion-responses/{response_id}` | Montre cette réponse et les preuves de l'épisode associé. |
| [responses.list](#action-responses-list) | `GET /v1/domains/{domain}/companion-responses` | Retrouve les réponses personnelles de mes companions. |
| [syntheses.create](#action-syntheses-create) | `POST /v1/domains/{domain}/episodes/{episode_id}/syntheses` | Génère une réponse citée à cet épisode via OpenRouter. |
| [syntheses.read](#action-syntheses-read) | `GET /v1/domains/{domain}/syntheses/{ident}` | Montre le résultat durable de cette synthèse personnelle. |
| [syntheses.list](#action-syntheses-list) | `GET /v1/domains/{domain}/syntheses` | Retrouve mes tentatives de synthèse. |
| [models.attempts](#action-models-attempts) | `GET /v1/domains/{domain}/model-attempts` | Liste mes tentatives d'extraction et leurs résultats durables. |
| [models.attempt](#action-models-attempt) | `GET /v1/domains/{domain}/model-attempts/{attempt_id}` | Inspecte cette tentative sans relancer le fournisseur. |
| [models.usage](#action-models-usage) | `GET /v1/domains/{domain}/model-usage` | Quel quota de tentatives IA reste disponible aujourd'hui dans ce domaine ? |
| [conversations.create](#action-conversations-create) | `POST /v1/domains/{domain}/conversations` | Crée une conversation sur les incidents. |
| [conversations.list](#action-conversations-list) | `GET /v1/domains/{domain}/conversations` | Retrouve mes conversations actives. |
| [conversations.read](#action-conversations-read) | `GET /v1/domains/{domain}/conversations/{ident}` | Ouvre cette conversation. |
| [conversations.update](#action-conversations-update) | `PUT /v1/domains/{domain}/conversations/{ident}` | Archive cette conversation. |
| [conversations.messages](#action-conversations-messages) | `GET /v1/domains/{domain}/conversations/{ident}/messages` | Montre les messages précédents de cette conversation. |
| [conversations.timeline](#action-conversations-timeline) | `GET /v1/domains/{domain}/conversations/{ident}/timeline` | Ouvre les questions, réponses délivrées et retours de ma conversation. |
| [conversations.query](#action-conversations-query) | `POST /v1/domains/{domain}/conversations/{ident}/query` | Pose cette question dans ma conversation et cite les preuves. |
| [members.list](#action-members-list) | `GET /v1/domains/{domain}/members` | Qui a accès à ce domaine ? |
| [members.change](#action-members-change) | `POST /v1/domains/{domain}/members` | Prépare le changement de rôle de ce membre. |
| [members.history](#action-members-history) | `GET /v1/domains/{domain}/membership-events` | Montre les changements d'accès du domaine. |
| [commits.list](#action-commits-list) | `GET /v1/domains/{domain}/commits` | Montre le journal des changements acceptés. |
| [proposals.diff](#action-proposals-diff) | `GET /v1/domains/{domain}/proposals/{ident}/diff` | Compare cette proposition à la connaissance publiée. |
| [sources.chunks](#action-sources-chunks) | `GET /v1/domains/{domain}/sources/{source_id}/chunks` | Découpe cette source en passages consultables. |
| [collections.create](#action-collections-create) | `POST /v1/domains/{domain}/collections` | Crée une collection privée avec ces lecteurs. |
| [collections.list](#action-collections-list) | `GET /v1/domains/{domain}/collections` | Recherche mes collections accessibles. |
| [collections.read](#action-collections-read) | `GET /v1/domains/{domain}/collections/{collection_id}` | Montre cette collection. |
| [sources.list](#action-sources-list) | `GET /v1/domains/{domain}/sources` | Recherche les sources sur les incidents. |
| [sources.create](#action-sources-create) | `POST /v1/domains/{domain}/sources` | Enregistre ce texte avec ces droits d'accès. |
| [imports.create](#action-imports-create) | `POST /v1/domains/{domain}/collections/{collection_id}/imports` | Prépare l'import de ces textes dans cette collection. |
| [imports.list](#action-imports-list) | `GET /v1/domains/{domain}/imports` | Où en sont mes imports ? |
| [imports.read](#action-imports-read) | `GET /v1/domains/{domain}/imports/{import_id}` | Montre le reçu de cet import. |
| [imports.process](#action-imports-process) | `POST /v1/domains/{domain}/imports/{import_id}/process` | Traite les prochains éléments de cet import. |
| [imports.cancel](#action-imports-cancel) | `POST /v1/domains/{domain}/imports/{import_id}/cancel` | Annule les éléments encore en attente. |
| [imports.retry](#action-imports-retry) | `POST /v1/domains/{domain}/imports/{import_id}/retry` | Reprogramme les éléments de cet import en échec. |
| [files.upload](#action-files-upload) | `POST /v1/domains/{domain}/collections/{collection}/files` | Dépose ce fichier dans cette collection. |
| [files.list](#action-files-list) | `GET /v1/domains/{domain}/files` | Liste les fichiers auxquels j'ai accès. |
| [files.read](#action-files-read) | `GET /v1/domains/{domain}/files/{ident}` | Montre le résultat d'analyse de ce fichier. |
| [files.download](#action-files-download) | `GET /v1/domains/{domain}/files/{ident}/download` | Télécharge le fichier original. |
| [files.process](#action-files-process) | `POST /v1/domains/{domain}/files/{ident}/process` | Extrais le texte de ce fichier. |
| [files.retry](#action-files-retry) | `POST /v1/domains/{domain}/files/{ident}/retry` | Reprogramme l'analyse de ce fichier. |
| [files.cancel](#action-files-cancel) | `POST /v1/domains/{domain}/files/{ident}/cancel` | Annule l'analyse de ce fichier. |
| [feedback.summary](#action-feedback-summary) | `GET /v1/domains/{domain}/feedback-summary` | Résume mes signaux accessibles en séparant votes, observations et estimations. |
| [feedback.preferences](#action-feedback-preferences) | `GET /v1/domains/{domain}/feedback-preferences` | Quelles remontées automatiques ai-je autorisées ? |
| [feedback.configure](#action-feedback-configure) | `PUT /v1/domains/{domain}/feedback-preferences` | Modifie mes préférences de remontée automatique avec mon accord explicite. |
| [feedback.record_signal](#action-feedback-record_signal) | `POST /v1/domains/{domain}/episodes/{episode_id}/signals` | Enregistre ce signal de feedback avec son origine déclarée. |
| [feedback.signals](#action-feedback-signals) | `GET /v1/domains/{domain}/feedback-signals` | Montre mes signaux de feedback accessibles. |
| [issues.list](#action-issues-list) | `GET /v1/domains/{domain}/issues` | Liste mes signalements ouverts. |
| [issues.read](#action-issues-read) | `GET /v1/domains/{domain}/issues/{ident}` | Montre ce signalement personnel. |
| [issues.history](#action-issues-history) | `GET /v1/domains/{domain}/issues/{ident}/events` | Montre les décisions sur ce signalement. |
| [issues.decide](#action-issues-decide) | `POST /v1/domains/{domain}/issues/{ident}/decisions` | Résous mon signalement avec cette justification. |
| [identity.read](#action-identity-read) | `GET /v1/me` | Quels domaines et fonctions me sont accessibles ? |
| [proposals.list](#action-proposals-list) | `GET /v1/domains/{domain}/proposals` | Quelles propositions attendent une revue ? |
| [proposals.create](#action-proposals-create) | `POST /v1/domains/{domain}/proposals` | Prépare une proposition appuyée sur ces passages. |
| [episodes.list](#action-episodes-list) | `GET /v1/domains/{domain}/episodes` | Retrouve mes questions et les versions servies. |
| [proposals.review](#action-proposals-review) | `POST /v1/domains/{domain}/proposals/{ident}/reviews` | Demande une modification de cette proposition. |
| [proposals.reviews](#action-proposals-reviews) | `GET /v1/domains/{domain}/proposals/{ident}/reviews` | Montre les décisions de revue de cette proposition. |
| [proposals.revise](#action-proposals-revise) | `POST /v1/domains/{domain}/proposals/{ident}/revise` | Crée une nouvelle révision de ma proposition. |
| [sources.extract_local](#action-sources-extract_local) | `POST /v1/domains/{domain}/sources/{source_id}/extract-local` | Sélectionne un passage de cette source avec le modèle local. |
| [sources.extract](#action-sources-extract) | `POST /v1/domains/{domain}/sources/{source_id}/extract` | Prépare l'extraction de ce passage avec le fournisseur configuré. |
| [extractions.read](#action-extractions-read) | `GET /v1/domains/{domain}/extractions/{ident}` | Montre le reçu de mon extraction. |
| [system.ready](#action-system-ready) | `GET /ready` | Vérifie que la base et son schéma permettent de servir le backend. |
| [system.health](#action-system-health) | `GET /health` | Vérifie que le service répond. |
| [domain.version](#action-domain-version) | `GET /v1/domains/{domain}/version` | Quelle version de connaissance est publiée ? |
| [sources.read](#action-sources-read) | `GET /v1/domains/{domain}/sources/{source_id}` | Montre cette source et son empreinte. |
| [sources.access](#action-sources-access) | `PUT /v1/domains/{domain}/sources/{source_id}/access` | Prépare la modification des lecteurs de cette source. |
| [sources.propose](#action-sources-propose) | `POST /v1/domains/{domain}/sources/{source_id}/propose` | Transforme cette source en proposition à relire. |
| [proposals.read](#action-proposals-read) | `GET /v1/domains/{domain}/proposals/{proposal_id}` | Montre le contenu et l'état de cette proposition. |
| [proposals.approve](#action-proposals-approve) | `POST /v1/domains/{domain}/proposals/{proposal_id}/approve` | Prépare l'approbation de cette version précise de la proposition. |
| [proposals.publish](#action-proposals-publish) | `POST /v1/domains/{domain}/proposals/{proposal_id}/publish` | Publie cette proposition acceptée avec la version attendue. |
| [domain.publish](#action-domain-publish) | `POST /v1/domains/{domain}/publish` | Publie le changement accepté en attente. |
| [domain.replay](#action-domain-replay) | `POST /v1/domains/{domain}/replay` | Reconstruis la projection depuis le journal publié. |
| [commits.compensate](#action-commits-compensate) | `POST /v1/domains/{domain}/commits/{sequence}/compensate` | Prépare une proposition compensant ce changement. |
| [concepts.list](#action-concepts-list) | `GET /v1/domains/{domain}/concepts` | Liste les concepts publiés accessibles. |
| [concepts.read](#action-concepts-read) | `GET /v1/domains/{domain}/concepts/{concept_id}` | Montre ce concept avec ses relations accessibles. |
| [knowledge.query](#action-knowledge-query) | `POST /v1/domains/{domain}/query` | Réponds à ma question avec les passages approuvés. |
| [episodes.read](#action-episodes-read) | `GET /v1/domains/{domain}/episodes/{episode_id}` | Retrouve la réponse citée à cette question passée. |
| [episodes.feedback](#action-episodes-feedback) | `POST /v1/domains/{domain}/episodes/{episode_id}/feedback` | Signale que cette réponse ne m'aide pas. |
| [domain.brief](#action-domain-brief) | `GET /v1/domains/{domain}/brief` | Résume les propositions en attente et mes signalements actifs. |
| [interactions.list](#action-interactions-list) | `GET /v1/interactions` | Quelles actions puis-je préparer avec cette API ? |

<a id="action-system-mcp_discovery"></a>
## system.mcp_discovery

Retourne les métadonnées de la ressource protégée MCP et le fournisseur d'identité configuré, lorsque cette découverte est activée.

**Utilisation frontend :** Préparer l'authentification du compagnon ; cette route ne connecte pas l'utilisateur et ne délivre aucun jeton.

- HTTP : `GET /.well-known/oauth-protected-resource`.
- MCP : `api_system_mcp_discovery` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : public.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

Aucun paramètre déclaré.

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ProtectedResourceMetadata](#schema-protectedresourcemetadata).
- Erreurs déclarées : 404.

<a id="action-responses-create"></a>
## responses.create

Conserve la réponse finale délivrée par un compagnon, séparément de la réponse extractive. Ses références doivent correspondre à celles de l'épisode.

**Utilisation frontend :** N'envoyer que la réponse réellement délivrée et ses références contrôlables ; le serveur ne certifie pas l'implication sémantique de chaque phrase.

- HTTP : `POST /v1/domains/{domain}/episodes/{episode_id}/companion-responses`.
- MCP : `api_responses_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `episode_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [CompanionResponseInput](#schema-companionresponseinput).
- Succès HTTP 201, `application/json` : [CompanionResponseView](#schema-companionresponseview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-responses-read"></a>
## responses.read

Relit une réponse de compagnon et son rattachement à l'épisode, avec contrôle actuel des preuves.

**Utilisation frontend :** Utiliser le response_id pour un vote ou commentaire précis ; ne pas confondre plusieurs réponses produites pour un même épisode.

- HTTP : `GET /v1/domains/{domain}/companion-responses/{response_id}`.
- MCP : `api_responses_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `response_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [CompanionResponseView](#schema-companionresponseview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-responses-list"></a>
## responses.list

Liste les réponses personnelles conservées des companions selon les filtres du contrat.

**Utilisation frontend :** Utiliser pour retrouver la formulation réellement lue par l'utilisateur, distincte du résultat brut de recherche.

- HTTP : `GET /v1/domains/{domain}/companion-responses`.
- MCP : `api_responses_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `episode_id` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [CompanionResponsePage](#schema-companionresponsepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-syntheses-create"></a>
## syntheses.create

Génère une synthèse personnelle à partir de la question et des citations d’un épisode, avec réservation durable avant tout appel OpenRouter.

**Utilisation frontend :** Confirmation signée requise selon le mode HTTP/MCP. Conserver une clé distincte de la question et examiner status même sur HTTP 200 : succeeded fournit response_id, failed un code sûr, unresolved interdit une relance automatique. Sans preuve, abstention déterministe sans fournisseur. Invalider réponses et timeline après succès.

- HTTP : `POST /v1/domains/{domain}/episodes/{episode_id}/syntheses`.
- MCP : `api_syntheses_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Synthèse personnelle via OpenRouter, potentiellement facturée, sans publication de connaissance.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `episode_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [SynthesisInput](#schema-synthesisinput).
- Succès HTTP 200, `application/json` : [SynthesisView](#schema-synthesisview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-syntheses-read"></a>
## syntheses.read

Lit l’état durable, le modèle demandé, l’usage déclaré et le lien vers la réponse de ma tentative de synthèse.

**Utilisation frontend :** Lire response_id via responses.read ; la tentative ne contient pas le texte généré. failed et succeeded sont terminaux ; unresolved signifie en cours ou résultat non établi. budget_reserved ne prouve pas une facturation et usage n’est pas une facture. succeeded atteste la conservation du reçu, pas son affichage, sa lecture ou la satisfaction de l’utilisateur.

- HTTP : `GET /v1/domains/{domain}/syntheses/{ident}`.
- MCP : `api_syntheses_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SynthesisView](#schema-synthesisview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-syntheses-list"></a>
## syntheses.list

Liste mes tentatives de synthèse visibles, avec filtres optionnels épisode et clé d’idempotence.

**Utilisation frontend :** Retrouver une tentative après une perte de réponse. Conserver les filtres pendant la pagination ; ne pas créer une nouvelle clé pour contourner un état unresolved. Les résultats d’autrui et épisodes devenus inaccessibles restent masqués.

- HTTP : `GET /v1/domains/{domain}/syntheses`.
- MCP : `api_syntheses_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `episode_id` | non | texte / null | — |
| query | `idempotency_key` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SynthesisPage](#schema-synthesispage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-models-attempts"></a>
## models.attempts

Liste les tentatives d'extraction du demandeur avec réservations et résultats durables, y compris les échecs.

**Utilisation frontend :** Diagnostiquer une incertitude sans appeler de nouveau le fournisseur ; ce registre ne couvre pas automatiquement tous les appels d'un compagnon externe.

- HTTP : `GET /v1/domains/{domain}/model-attempts`.
- MCP : `api_models_attempts` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ModelAttemptPage](#schema-modelattemptpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-models-attempt"></a>
## models.attempt

Lit une tentative d'extraction précise et son état enregistré.

**Utilisation frontend :** Une tentative sans résultat durable peut être inconnue, pas gratuite ni forcément non exécutée.

- HTTP : `GET /v1/domains/{domain}/model-attempts/{attempt_id}`.
- MCP : `api_models_attempt` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `attempt_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ModelAttemptView](#schema-modelattemptview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-models-usage"></a>
## models.usage

Retourne l'usage du quota journalier de tentatives partagé par le domaine.

**Utilisation frontend :** Présenter un nombre de tentatives, pas un montant facturé. Le budget privé du compagnon et la limite de clé fournisseur sont des mécanismes distincts.

- HTTP : `GET /v1/domains/{domain}/model-usage`.
- MCP : `api_models_usage` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ModelUsageView](#schema-modelusageview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-conversations-create"></a>
## conversations.create

Crée une conversation personnelle dans un domaine avec une clé d'idempotence.

**Utilisation frontend :** Conserver son ID pour les questions suivantes ; une conversation n'est pas partagée automatiquement avec les administrateurs.

- HTTP : `POST /v1/domains/{domain}/conversations`.
- MCP : `api_conversations_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ConversationInput](#schema-conversationinput).
- Succès HTTP 201, `application/json` : [ConversationView](#schema-conversationview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-conversations-list"></a>
## conversations.list

Liste les conversations personnelles selon leur état et la pagination demandée.

**Utilisation frontend :** Utiliser pour la navigation dans l'historique ; ne pas partager le cache entre identités ou tenants.

- HTTP : `GET /v1/domains/{domain}/conversations`.
- MCP : `api_conversations_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `archived` | non | booléen | défaut : `false` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ConversationPage](#schema-conversationpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-conversations-read"></a>
## conversations.read

Lit les métadonnées actuelles d'une conversation personnelle.

**Utilisation frontend :** Vérifier son état avant une modification ou une nouvelle question.

- HTTP : `GET /v1/domains/{domain}/conversations/{ident}`.
- MCP : `api_conversations_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ConversationView](#schema-conversationview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-conversations-update"></a>
## conversations.update

Met à jour les propriétés autorisées de la conversation, notamment son titre et son archivage, avec révision attendue.

**Utilisation frontend :** En cas de conflit, relire la conversation avant de proposer une nouvelle modification. Archiver ne supprime pas l'historique.

- HTTP : `PUT /v1/domains/{domain}/conversations/{ident}`.
- MCP : `api_conversations_update` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ConversationUpdate](#schema-conversationupdate).
- Succès HTTP 200, `application/json` : [ConversationView](#schema-conversationview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-conversations-messages"></a>
## conversations.messages

Retourne une page de l'historique personnel de conversation à partir d'une position, avec les épisodes accessibles.

**Utilisation frontend :** Respecter l'ordre et le curseur renvoyés. Les réponses de compagnon peuvent nécessiter leur lecture dédiée ; ce n'est pas une mémoire automatiquement envoyée au modèle.

- HTTP : `GET /v1/domains/{domain}/conversations/{ident}/messages`.
- MCP : `api_conversations_messages` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | entier | minimum : `0`; défaut : `0` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ConversationMessages](#schema-conversationmessages).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-conversations-timeline"></a>
## conversations.timeline

Lit une page de conversation personnelle regroupant chaque question, son résultat sourcé, les réponses réellement délivrées, les signaux et les signalements associés. Les références des réponses utilisent les citations de l’épisode sans dupliquer leur texte.

**Utilisation frontend :** Suivre le curseur de séquence et les curseurs propres aux réponses, signaux et signalements. Une page peut être vide avec next_after non nul après filtrage des droits. Le volume est limité à 500 000 octets ; réduire les limites ou lire les objets séparément si un seul tour est trop volumineux. Utiliser direction=backward pour ouvrir les tours récents, puis garder cette direction avec le curseur renvoyé.

- HTTP : `GET /v1/domains/{domain}/conversations/{ident}/timeline`.
- MCP : `api_conversations_timeline` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20`; défaut : `10` |
| query | `after` | non | entier | minimum : `0`; défaut : `0` |
| query | `responses_limit` | non | entier | minimum : `1`; maximum : `5`; défaut : `3` |
| query | `signals_limit` | non | entier | minimum : `1`; maximum : `20`; défaut : `5` |
| query | `issues_limit` | non | entier | minimum : `1`; maximum : `10`; défaut : `3` |
| query | `direction` | non | `"forward"`, `"backward"` | défaut : `"forward"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ConversationTimeline](#schema-conversationtimeline).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-conversations-query"></a>
## conversations.query

Pose une question dans une conversation et crée son épisode avec une clé de reprise stable. Réponse JSON par défaut ; Accept: text/event-stream diffuse un démarrage puis le résultat extractif ou une erreur, sans tokens LLM.

**Utilisation frontend :** Conserver la même clé après timeout ou déconnexion. Avec SSE, attendre un événement result avant d'afficher la réussite ; une erreur peut arriver après le statut HTTP 200. La synthèse citée reste un parcours compagnon séparé.

- HTTP : `POST /v1/domains/{domain}/conversations/{ident}/query`.
- MCP : `api_conversations_query` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Recherche avec création d'un épisode personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ConversationQueryInput](#schema-conversationqueryinput).
- Succès HTTP 200, `application/json` : [QueryResult](#schema-queryresult).
- Succès HTTP 200, `text/event-stream` : texte.
- Événements SSE versionnés : `started` : [QueryStreamStarted](#schema-querystreamstarted); `result` : [QueryStreamResult](#schema-querystreamresult); `error` : [QueryStreamError](#schema-querystreamerror). Une erreur après ouverture du flux est portée par l'événement, pas par le statut HTTP déjà envoyé.
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-members-list"></a>
## members.list

Liste les membres et rôles d'un domaine sous l'autorité de son propriétaire.

**Utilisation frontend :** Utiliser pour l'administration du domaine ; cette API n'est pas un annuaire d'entreprise global.

- HTTP : `GET /v1/domains/{domain}/members`.
- MCP : `api_members_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte | longueur max. : `300`; défaut : `""` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [MemberPage](#schema-memberpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-members-change"></a>
## members.change

Ajoute, modifie ou retire un membre selon les opérations et contraintes du contrat, avec événement d'audit.

**Utilisation frontend :** Présenter l'identité et le rôle exacts, recueillir une confirmation signée. La révocation bloque les appels ultérieurs sans supprimer l'historique.

- HTTP : `POST /v1/domains/{domain}/members`.
- MCP : `api_members_change` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Modification des accès ; révocation potentiellement immédiate.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [MembershipInput](#schema-membershipinput).
- Succès HTTP 201, `application/json` : [MembershipReceipt](#schema-membershipreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-members-history"></a>
## members.history

Liste les événements de modification d'appartenance au domaine.

**Utilisation frontend :** Utiliser pour l'audit administratif ; ne pas transformer l'historique en droit actuel.

- HTTP : `GET /v1/domains/{domain}/membership-events`.
- MCP : `api_members_history` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [MembershipEventPage](#schema-membershipeventpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-commits-list"></a>
## commits.list

Liste le journal des changements accepté par le domaine selon le périmètre de l'opération.

**Utilisation frontend :** Distinguer la position du journal de la position effectivement publiée avec domain.version.

- HTTP : `GET /v1/domains/{domain}/commits`.
- MCP : `api_commits_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | entier | minimum : `0`; défaut : `0` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [CommitPage](#schema-commitpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-diff"></a>
## proposals.diff

Compare les changements proposés à la projection publiée disponible.

**Utilisation frontend :** Présenter ajouts, modifications et suppressions proposés avec les preuves ; une différence affichée n'est pas un changement publié.

- HTTP : `GET /v1/domains/{domain}/proposals/{ident}/diff`.
- MCP : `api_proposals_diff` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ProposalDifference](#schema-proposaldifference).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-chunks"></a>
## sources.chunks

Retourne des passages déterministes bornés d'une source avec leurs positions dans le texte original.

**Utilisation frontend :** Utiliser les offsets renvoyés pour les preuves. Les positions comptent les points de code Unicode, pas les unités UTF-16 JavaScript.

- HTTP : `GET /v1/domains/{domain}/sources/{source_id}/chunks`.
- MCP : `api_sources_chunks` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| query | `offset` | non | entier | minimum : `0`; défaut : `0` |
| query | `limit` | non | entier | minimum : `1`; maximum : `50`; défaut : `10` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SourceChunkPage](#schema-sourcechunkpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-collections-create"></a>
## collections.create

Crée une collection privée de sources avec ses lecteurs autorisés. Elle organise les imports ; elle n'approuve aucun contenu.

**Utilisation frontend :** Recueillir le nom et les lecteurs, garder l'identifiant retourné pour les imports texte et fichiers.

- HTTP : `POST /v1/domains/{domain}/collections`.
- MCP : `api_collections_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [CollectionInput](#schema-collectioninput).
- Succès HTTP 201, `application/json` : [CollectionView](#schema-collectionview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-collections-list"></a>
## collections.list

Liste les collections visibles dans le domaine selon les droits actuels du demandeur.

**Utilisation frontend :** Utiliser les paramètres de pagination déclarés ; ne pas reconstruire une liste globale depuis des caches d'autres utilisateurs.

- HTTP : `GET /v1/domains/{domain}/collections`.
- MCP : `api_collections_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `q` | non | texte | longueur max. : `200`; défaut : `""` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [CollectionPage](#schema-collectionpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-collections-read"></a>
## collections.read

Retourne les propriétés d'une collection accessible. Les collections sont immuables dans cette version.

**Utilisation frontend :** Afficher la portée et les lecteurs ; aucune route de renommage, partage dynamique ou suppression de collection n'est actuellement proposée.

- HTTP : `GET /v1/domains/{domain}/collections/{collection_id}`.
- MCP : `api_collections_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `collection_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [CollectionView](#schema-collectionview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-list"></a>
## sources.list

Recherche et liste les sources accessibles, avec les filtres et curseurs du contrat.

**Utilisation frontend :** Utiliser pour le corpus manager ou la sélection de preuves. Une page vide peut être normale après filtrage par droits.

- HTTP : `GET /v1/domains/{domain}/sources`.
- MCP : `api_sources_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `q` | non | texte | longueur max. : `200`; défaut : `""` |
| query | `collection_id` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SourcePage](#schema-sourcepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-create"></a>
## sources.create

Enregistre une source textuelle immuable avec provenance et lecteurs. Une source enregistrée n'est pas automatiquement servie comme connaissance approuvée.

**Utilisation frontend :** Conserver l'identifiant et l'empreinte ; proposer ensuite un passage via sources.propose ou une proposition typée.

- HTTP : `POST /v1/domains/{domain}/sources`.
- MCP : `api_sources_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [SourceInput](#schema-sourceinput).
- Succès HTTP 201, `application/json` : [SourceSummary](#schema-sourcesummary).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-imports-create"></a>
## imports.create

Enregistre un lot persistant de textes dans une collection. Le reçu décrit les éléments à traiter ; ce n'est pas une publication.

**Utilisation frontend :** Conserver la clé et le reçu. Les éléments texte/Markdown et les fichiers binaires utilisent des parcours distincts.

- HTTP : `POST /v1/domains/{domain}/collections/{collection_id}/imports`.
- MCP : `api_imports_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `collection_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [TextImportInput](#schema-textimportinput).
- Succès HTTP 202, `application/json` : [ImportView](#schema-importview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-imports-list"></a>
## imports.list

Liste les lots d'import visibles et leurs états synthétiques.

**Utilisation frontend :** Présenter les lots du périmètre accessible et poursuivre la pagination avec les curseurs fournis.

- HTTP : `GET /v1/domains/{domain}/imports`.
- MCP : `api_imports_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ImportPage](#schema-importpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-imports-read"></a>
## imports.read

Retourne le reçu du lot et les résultats de ses éléments : état, source créée, erreur et nombre d'essais.

**Utilisation frontend :** Examiner chaque élément : partial peut contenir encore du travail en attente et n'est pas toujours un état terminal.

- HTTP : `GET /v1/domains/{domain}/imports/{import_id}`.
- MCP : `api_imports_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
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
- Succès HTTP 200, `application/json` : [ImportView](#schema-importview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-imports-process"></a>
## imports.process

Traite un nombre borné d'éléments en attente. L'enregistrement d'une source et le succès de son élément sont atomiques.

**Utilisation frontend :** Faire progresser explicitement le lot tant qu'il reste du travail. Fermer le navigateur n'exécute pas les éléments restants en arrière-plan.

- HTTP : `POST /v1/domains/{domain}/imports/{import_id}/process`.
- MCP : `api_imports_process` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `import_id` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `20`; défaut : `1` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ImportView](#schema-importview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-imports-cancel"></a>
## imports.cancel

Annule les éléments encore en attente sans supprimer les sources déjà créées. Un lot annulé n'est pas repris comme un nouveau lot.

**Utilisation frontend :** Relire le reçu et afficher séparément réussites conservées et éléments annulés.

- HTTP : `POST /v1/domains/{domain}/imports/{import_id}/cancel`.
- MCP : `api_imports_cancel` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
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

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ImportView](#schema-importview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-imports-retry"></a>
## imports.retry

Replace les éléments en échec dans la file du même lot ; les sources déjà réussies ne sont pas recréées.

**Utilisation frontend :** Une relance ne corrige pas le contenu ou le format. Pour des données corrigées, créer un nouveau lot avec une nouvelle clé.

- HTTP : `POST /v1/domains/{domain}/imports/{import_id}/retry`.
- MCP : `api_imports_retry` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
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

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ImportView](#schema-importview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-files-upload"></a>
## files.upload

Dépose un fichier binaire encodé en base64 dans un corps JSON, avec métadonnées et clé de reprise. Le code 202 signifie accepté pour traitement.

**Utilisation frontend :** Ne pas envoyer de multipart sur cette route. Respecter les tailles du contrat et lire le reçu avant de lancer ou suivre le traitement.

- HTTP : `POST /v1/domains/{domain}/collections/{collection}/files`.
- MCP : `api_files_upload` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `collection` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [FileUploadInput](#schema-fileuploadinput).
- Succès HTTP 202, `application/json` : [FileView](#schema-fileview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-files-list"></a>
## files.list

Liste les fichiers visibles, éventuellement ceux à traiter selon le filtre demandé.

**Utilisation frontend :** Utiliser pour une file corpus ; un filtre pending n'accorde aucun droit supplémentaire.

- HTTP : `GET /v1/domains/{domain}/files`.
- MCP : `api_files_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `pending` | non | booléen | défaut : `false` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [FilePage](#schema-filepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-files-read"></a>
## files.read

Lit le reçu de traitement d'un fichier, son état, les erreurs éventuelles et la source issue de l'analyse.

**Utilisation frontend :** Faire un suivi borné avec temporisation ; distinguer réception, analyse, source enregistrée puis proposition/publication.

- HTTP : `GET /v1/domains/{domain}/files/{ident}`.
- MCP : `api_files_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [FileView](#schema-fileview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-files-download"></a>
## files.download

Retourne les octets du fichier original après contrôle d'accès, avec une réponse binaire et des en-têtes de téléchargement.

**Utilisation frontend :** Utiliser fetch authentifié puis un Blob. Ce n'est pas une réponse JSON ; libérer l'URL temporaire du Blob après usage.

- HTTP : `GET /v1/domains/{domain}/files/{ident}/download`.
- MCP : `api_files_download` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/octet-stream` : texte.
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-files-process"></a>
## files.process

Déclenche l'analyse bornée du fichier autorisé et enregistre le texte extrait comme source lorsque l'analyse réussit.

**Utilisation frontend :** Inspecter le reçu ; PDF/DOCX/textes bornés seulement, pas de promesse OCR ou fidélité complète de mise en page.

- HTTP : `POST /v1/domains/{domain}/files/{ident}/process`.
- MCP : `api_files_process` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [FileView](#schema-fileview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-files-retry"></a>
## files.retry

Reprogramme un traitement de fichier en échec lorsque son état autorise une reprise.

**Utilisation frontend :** Relire l'état après la commande ; corriger un fichier nécessite un nouveau dépôt, pas une modification silencieuse de l'original.

- HTTP : `POST /v1/domains/{domain}/files/{ident}/retry`.
- MCP : `api_files_retry` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [FileView](#schema-fileview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-files-cancel"></a>
## files.cancel

Demande l'annulation selon l'état de traitement autorisé, sans effacer les résultats déjà durablement enregistrés.

**Utilisation frontend :** Gérer un conflit si l'état a changé pendant la décision et afficher le reçu réel.

- HTTP : `POST /v1/domains/{domain}/files/{ident}/cancel`.
- MCP : `api_files_cancel` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager.
- Effet : Enregistrement ou traitement de corpus ; aucune publication automatique.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [FileView](#schema-fileview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-feedback-summary"></a>
## feedback.summary

Agrège les signaux personnels dans une fenêtre bornée, éventuellement limitée à une conversation ou une réponse.

**Utilisation frontend :** Afficher séparément votes, effort observé et sentiment inféré. L'absence de signal n'est pas une preuve de satisfaction ; respecter les limites de fenêtre.

- HTTP : `GET /v1/domains/{domain}/feedback-summary`.
- MCP : `api_feedback_summary` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `since` | non | texte / null | — |
| query | `until` | non | texte / null | — |
| query | `conversation_id` | non | texte / null | — |
| query | `companion_response_id` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [FeedbackSummary](#schema-feedbacksummary).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-feedback-preferences"></a>
## feedback.preferences

Lit le consentement personnel aux événements observés et inférés, désactivés par défaut.

**Utilisation frontend :** Vérifier avant de collecter automatiquement des itérations, abandons ou estimations de satisfaction.

- HTTP : `GET /v1/domains/{domain}/feedback-preferences`.
- MCP : `api_feedback_preferences` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [FeedbackPreferences](#schema-feedbackpreferences).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-feedback-configure"></a>
## feedback.configure

Modifie les préférences personnelles de collecte après décision explicite, sous contrôle de révision et confirmation signée.

**Utilisation frontend :** Expliquer séparément observation et inférence. Un refus désactive les nouvelles remontées ; ce n'est pas une suppression de l'historique déjà enregistré.

- HTTP : `PUT /v1/domains/{domain}/feedback-preferences`.
- MCP : `api_feedback_configure` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [FeedbackPreferencesInput](#schema-feedbackpreferencesinput).
- Succès HTTP 200, `application/json` : [FeedbackPreferences](#schema-feedbackpreferences).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-feedback-record_signal"></a>
## feedback.record_signal

Ajoute un signal immuable à un épisode et éventuellement à la réponse exacte : vote explicite, événement observé ou sentiment inféré.

**Utilisation frontend :** Renseigner l'origine réelle. Un pouce bas explicite peut ouvrir un signalement personnel ; une estimation ne devient jamais un vote ni une modification canonique.

- HTTP : `POST /v1/domains/{domain}/episodes/{episode_id}/signals`.
- MCP : `api_feedback_record_signal` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `episode_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [FeedbackSignalInput](#schema-feedbacksignalinput).
- Succès HTTP 201, `application/json` : [FeedbackSignalView](#schema-feedbacksignalview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-feedback-signals"></a>
## feedback.signals

Liste les signaux personnels accessibles avec leur origine et leur cible.

**Utilisation frontend :** Conserver la distinction entre ce que l'utilisateur a dit, ce que l'hôte a observé et ce qu'un modèle a estimé.

- HTTP : `GET /v1/domains/{domain}/feedback-signals`.
- MCP : `api_feedback_signals` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `episode_id` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [FeedbackSignalPage](#schema-feedbacksignalpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-issues-list"></a>
## issues.list

Liste les signalements personnels visibles, notamment les manques de connaissance et retours négatifs.

**Utilisation frontend :** Permettre un suivi personnel ; aucune file de triage partagée de toute l'entreprise n'est fournie par cette route. Le filtre episode_id permet de compléter les signalements d’un tour de conversation précis.

- HTTP : `GET /v1/domains/{domain}/issues`.
- MCP : `api_issues_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `status` | non | `"open"`, `"in_progress"`, `"resolved"`, `"dismissed"` / null | — |
| query | `episode_id` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [IssuePage](#schema-issuepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-issues-read"></a>
## issues.read

Lit un signalement personnel, son état et sa révision.

**Utilisation frontend :** Récupérer la révision avant de prendre une décision de résolution ou réouverture.

- HTTP : `GET /v1/domains/{domain}/issues/{ident}`.
- MCP : `api_issues_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [IssueView](#schema-issueview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-issues-history"></a>
## issues.history

Retourne les décisions immuables prises sur un signalement personnel.

**Utilisation frontend :** Afficher les décisions personnelles et leurs éventuels liens correction_proposal_id, correction_digest et correction_published_version. Une décision liée est masquée si les droits actuels ne permettent plus de consulter sa proposition. La version est celle de sa publication historique, sans certification d’efficacité.

- HTTP : `GET /v1/domains/{domain}/issues/{ident}/events`.
- MCP : `api_issues_history` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [IssueEventPage](#schema-issueeventpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-issues-decide"></a>
## issues.decide

Prend en charge, résout, classe sans suite ou rouvre un signalement avec justification et contrôle de révision.

**Utilisation frontend :** Relire après conflit. Pour start ou resolve, correction_proposal_id associe explicitement une proposition visible par un rôle autorisé à consulter les propositions ; resolve avec ce lien exige une proposition publiée. Sans lien, resolve reste une clôture déclarative. Aucun commentaire personnel n’est copié dans la proposition ; aucune acceptation ou publication automatique.

- HTTP : `POST /v1/domains/{domain}/issues/{ident}/decisions`.
- MCP : `api_issues_decide` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [IssueDecisionInput](#schema-issuedecisioninput).
- Succès HTTP 201, `application/json` : [IssueEvent](#schema-issueevent).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-identity-read"></a>
## identity.read

Retourne l'identité effective et les domaines auxquels elle appartient, avec les rôles et capacités que le serveur lui reconnaît.

**Utilisation frontend :** Appeler après connexion et lors d'un changement de contexte. Construire le sélecteur de domaine et les actions proposées à partir de ce résultat, jamais d'un rôle fourni par le navigateur.

- HTTP : `GET /v1/me`.
- MCP : `api_identity_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [IdentityView](#schema-identityview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-list"></a>
## proposals.list

Liste les propositions accessibles avec leurs états de revue et d'acceptation.

**Utilisation frontend :** Filtrer par source_id depuis un reçu d’import ou de fichier, puis éventuellement par status ; paginer avec after en conservant les filtres. Le filtre porte sur les sources des preuves requises, y compris anciennes preuves et relations, pas sur un certificat d’origine d’extraction. Toutes les preuves doivent rester accessibles et le rôle doit autoriser la lecture des propositions. La visibilité n’autorise pas l’approbation.

- HTTP : `GET /v1/domains/{domain}/proposals`.
- MCP : `api_proposals_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| query | `status` | non | `"ready"`, `"approved"`, `"published"`, `"rejected"`, `"deferred"`, `"changes_requested"`, `"superseded"` / null | — |
| query | `source_id` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ProposalPage](#schema-proposalpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-create"></a>
## proposals.create

Crée un changement typé appuyé sur des preuves exactes et une version de base. Il reste hors de la connaissance publiée.

**Utilisation frontend :** Préparer les opérations avec des IDs réels et leurs spans ; conserver clé, digest et version retournés.

- HTTP : `POST /v1/domains/{domain}/proposals`.
- MCP : `api_proposals_create` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Création/révision de proposition ; connaissance servie inchangée.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ProposalInput](#schema-proposalinput).
- Succès HTTP 201, `application/json` : [ProposalView](#schema-proposalview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-episodes-list"></a>
## episodes.list

Liste les épisodes personnels accessibles, correspondant aux questions et versions servies.

**Utilisation frontend :** Utiliser pour l'historique personnel ; un propriétaire ne voit pas automatiquement les épisodes privés des autres membres.

- HTTP : `GET /v1/domains/{domain}/episodes`.
- MCP : `api_episodes_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [EpisodePage](#schema-episodepage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-review"></a>
## proposals.review

Ajoute une décision de revue du propriétaire, par exemple une demande de modification ou un rejet, avec les préconditions du contrat.

**Utilisation frontend :** Présenter le motif et la cible exacte ; recueillir la confirmation requise. Une revue ne remplace pas l'approbation puis la publication.

- HTTP : `POST /v1/domains/{domain}/proposals/{ident}/reviews`.
- MCP : `api_proposals_review` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Décision de revue ; approbation et publication restent distinctes.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ReviewInput](#schema-reviewinput).
- Succès HTTP 201, `application/json` : [ReviewReceipt](#schema-reviewreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-proposals-reviews"></a>
## proposals.reviews

Relit les décisions de revue d'une proposition et leurs justifications.

**Utilisation frontend :** Afficher l'historique pour expliquer les changements demandés et orienter la révision.

- HTTP : `GET /v1/domains/{domain}/proposals/{ident}/reviews`.
- MCP : `api_proposals_reviews` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| query | `limit` | non | entier | minimum : `1`; maximum : `100`; défaut : `20` |
| query | `after` | non | texte / null | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReviewPage](#schema-reviewpage).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-revise"></a>
## proposals.revise

Crée une nouvelle révision de proposition en conservant la traçabilité de l'ancienne.

**Utilisation frontend :** Ne pas remplacer silencieusement le contenu relu par le propriétaire ; utiliser les identifiants et préconditions de la nouvelle révision.

- HTTP : `POST /v1/domains/{domain}/proposals/{ident}/revise`.
- MCP : `api_proposals_revise` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Création/révision de proposition ; connaissance servie inchangée.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ProposalInput](#schema-proposalinput).
- Succès HTTP 201, `application/json` : [ProposalView](#schema-proposalview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-extract_local"></a>
## sources.extract_local

Sélectionne un passage via le modèle local configuré et crée une proposition soumise aux mêmes contrôles de preuve.

**Utilisation frontend :** Vérifier que le modèle local est configuré ; local ne dispense pas de consentement, de droits ni de revue.

- HTTP : `POST /v1/domains/{domain}/sources/{source_id}/extract-local`.
- MCP : `api_sources_extract_local` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Traitement par modèle local configuré.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [LocalExtractionInput](#schema-localextractioninput).
- Succès HTTP 201, `application/json` : [LocalExtractionView](#schema-localextractionview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-sources-extract"></a>
## sources.extract

Envoie un passage borné au fournisseur configuré pour sélectionner une preuve exacte et créer une proposition non approuvée. L'appel peut être facturé.

**Utilisation frontend :** Présenter destination et texte concerné, confirmer puis conserver le reçu et la tentative. Ne pas relancer une tentative échouée sous une nouvelle clé automatiquement.

- HTTP : `POST /v1/domains/{domain}/sources/{source_id}/extract`.
- MCP : `api_sources_extract` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Traitement par fournisseur configuré, potentiellement facturé.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [ExtractionInput](#schema-extractioninput).
- Succès HTTP 201, `application/json` : [LocalExtractionView](#schema-localextractionview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-extractions-read"></a>
## extractions.read

Relit un reçu d'extraction autorisé sans exécuter de nouveau le modèle.

**Utilisation frontend :** Afficher provenance, sélection et proposition liée ; utiliser ce reçu pour examiner le résultat ou reprendre après une incertitude.

- HTTP : `GET /v1/domains/{domain}/extractions/{ident}`.
- MCP : `api_extractions_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `ident` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [LocalExtractionView](#schema-localextractionview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-system-ready"></a>
## system.ready

Vérifie la connexion à PostgreSQL, la révision de migration attendue, le rôle SQL restreint et les indicateurs de RLS forcée sur les tables applicatives.

**Utilisation frontend :** Utiliser comme sonde de disponibilité backend : 200 ready ou 503 NOT_READY sans diagnostic sensible. /health reste une sonde de vie statique. Aucun test fournisseur IA, aucun appel payant, aucune certification du contenu ni du fonctionnement de toutes les routes.

- HTTP : `GET /ready`.
- MCP : `api_system_ready` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : public.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

Aucun paramètre déclaré.

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReadinessView](#schema-readinessview).
- Erreurs déclarées : voir erreurs de transport.

<a id="action-system-health"></a>
## system.health

Vérifie que le processus HTTP répond. Ce résultat seul ne garantit ni l'accès à PostgreSQL ni la disponibilité du fournisseur IA.

**Utilisation frontend :** Utiliser pour un contrôle simple de service ; ne pas présenter un état global de production à partir de ce seul appel.

- HTTP : `GET /health`.
- MCP : `api_system_health` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : public.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

Aucun paramètre déclaré.

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [HealthView](#schema-healthview).
- Erreurs déclarées : voir erreurs de transport.

<a id="action-domain-version"></a>
## domain.version

Retourne les positions de connaissance acceptée et publiée du domaine.

**Utilisation frontend :** Utiliser pour expliquer pourquoi une proposition acceptée n'apparaît pas encore dans les réponses et pour rafraîchir les données.

- HTTP : `GET /v1/domains/{domain}/version`.
- MCP : `api_domain_version` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [VersionView](#schema-versionview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-read"></a>
## sources.read

Lit le texte et les métadonnées d'une source accessible, dont son empreinte et sa provenance.

**Utilisation frontend :** Traiter le texte comme des données non fiables ; un emplacement de provenance n'est pas nécessairement une URL de téléchargement.

- HTTP : `GET /v1/domains/{domain}/sources/{source_id}`.
- MCP : `api_sources_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [SourceDetail](#schema-sourcedetail).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-sources-access"></a>
## sources.access

Remplace les lecteurs d'une source sous le contrôle du propriétaire. Le retrait d'accès agit aussi sur les lectures ultérieures d'anciens épisodes et réponses.

**Utilisation frontend :** Présenter les lecteurs ajoutés et retirés, recueillir une confirmation signée côté hôte puis invalider les caches concernés.

- HTTP : `PUT /v1/domains/{domain}/sources/{source_id}/access`.
- MCP : `api_sources_access` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Modification des accès ; révocation potentiellement immédiate.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [AccessInput](#schema-accessinput).
- Succès HTTP 200, `application/json` : [AccessReceipt](#schema-accessreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-sources-propose"></a>
## sources.propose

Construit une proposition verbatim à partir d'une source, sans l'accepter ni la publier.

**Utilisation frontend :** Conserver Idempotency-Key pour la même intention ; ouvrir ensuite la proposition et ses différences pour revue.

- HTTP : `POST /v1/domains/{domain}/sources/{source_id}/propose`.
- MCP : `api_sources_propose` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
- Effet : Création/révision de proposition ; connaissance servie inchangée.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `source_id` | oui | texte | format : `"uuid"` |
| header | `idempotency-key` | oui | texte | longueur min. : `8`; longueur max. : `128` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ProposalView](#schema-proposalview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-read"></a>
## proposals.read

Lit le contenu, les preuves et l'état actuel d'une proposition accessible.

**Utilisation frontend :** Relire avant toute revue, révision ou approbation pour utiliser le digest et la version actuels.

- HTTP : `GET /v1/domains/{domain}/proposals/{proposal_id}`.
- MCP : `api_proposals_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent.
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
- Succès HTTP 200, `application/json` : [ProposalView](#schema-proposalview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-proposals-approve"></a>
## proposals.approve

Accepte la proposition précise sous l'autorité du propriétaire, si digest, version et preuves sont encore valides.

**Utilisation frontend :** Recueillir la décision sur cette version puis envoyer la confirmation signée. Afficher accepté, pas publié.

- HTTP : `POST /v1/domains/{domain}/proposals/{proposal_id}/approve`.
- MCP : `api_proposals_approve` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
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

- Corps requis `application/json` : [ApprovalInput](#schema-approvalinput).
- Succès HTTP 200, `application/json` : [ApprovalReceipt](#schema-approvalreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-proposals-publish"></a>
## proposals.publish

Publie uniquement la proposition acceptée désignée, avec contrôle de la version publiée attendue et de ses preuves actuelles.

**Utilisation frontend :** Préférer cette action depuis une fiche. Fournir expected_published_version égal à la séquence d’acceptation moins un, avec la confirmation liée à la cible et au corps. Une cible déjà publiée retourne changed=false sans publier un autre changement en attente. target_version identifie sa publication historique ; published_version est la position actuelle du domaine.

- HTTP : `POST /v1/domains/{domain}/proposals/{proposal_id}/publish`.
- MCP : `api_proposals_publish` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
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

- Corps requis `application/json` : [TargetedPublicationInput](#schema-targetedpublicationinput).
- Succès HTTP 200, `application/json` : [TargetedPublicationReceipt](#schema-targetedpublicationreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-domain-publish"></a>
## domain.publish

Publie le prochain changement accepté du domaine, sans désigner une proposition dans la requête.

**Utilisation frontend :** Commande globale conservée pour les hôtes qui souhaitent publier le prochain changement en attente. Pour une fiche et une reprise ciblée, préférer proposals.publish. Après timeout, relire version et journal avant une nouvelle décision globale : une autre acceptation peut avoir eu lieu.

- HTTP : `POST /v1/domains/{domain}/publish`.
- MCP : `api_domain_publish` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Acceptation ou publication selon l'opération ; consulter le reçu.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [PublicationReceipt](#schema-publicationreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-domain-replay"></a>
## domain.replay

Reconstruit la projection publiée à partir du journal existant sans rejouer le modèle ni inventer de nouveaux changements.

**Utilisation frontend :** Réserver cette action d'exploitation au propriétaire confirmé ; inspecter le reçu et les versions.

- HTTP : `POST /v1/domains/{domain}/replay`.
- MCP : `api_domain_replay` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Reconstruction de la projection publiée depuis le journal.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [ReplayReceipt](#schema-replayreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-commits-compensate"></a>
## commits.compensate

Crée une proposition qui compense un changement historique, sans supprimer ce changement du journal.

**Utilisation frontend :** Présenter l'impact puis passer par revue, approbation et publication. Les changements ultérieurs incompatibles peuvent empêcher la compensation.

- HTTP : `POST /v1/domains/{domain}/commits/{sequence}/compensate`.
- MCP : `api_commits_compensate` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Création/révision de proposition ; connaissance servie inchangée.
- Décision : accord explicite ; confirmation signée en MCP et HTTP strict.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `sequence` | oui | entier | — |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [RollbackInput](#schema-rollbackinput).
- Succès HTTP 200, `application/json` : [ProposalView](#schema-proposalview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503, 428.

<a id="action-concepts-list"></a>
## concepts.list

Liste les concepts publiés visibles sous les droits actuels.

**Utilisation frontend :** Afficher la connaissance servie, distincte des sources brutes et propositions en cours.

- HTTP : `GET /v1/domains/{domain}/concepts`.
- MCP : `api_concepts_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : liste de [Concept](#schema-concept).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-concepts-read"></a>
## concepts.read

Lit un concept publié et ses relations accessibles, avec ses preuves.

**Utilisation frontend :** Conserver la provenance lors de l'affichage ; ne pas exposer des relations masquées depuis un cache global.

- HTTP : `GET /v1/domains/{domain}/concepts/{concept_id}`.
- MCP : `api_concepts_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `concept_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [Concept](#schema-concept).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-knowledge-query"></a>
## knowledge.query

Recherche des passages dans la connaissance publiée et crée un épisode personnel. La réponse de cette route est extractive, sans appel automatique de synthèse.

**Utilisation frontend :** Afficher citations, version servie et statut. Sans preuve, afficher le manque de connaissance. Cette route simple n'est pas idempotente : privilégier conversations.query pour une reprise de chat.

- HTTP : `POST /v1/domains/{domain}/query`.
- MCP : `api_knowledge_query` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Recherche avec création d'un épisode personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [QueryInput](#schema-queryinput).
- Succès HTTP 200, `application/json` : [QueryResult](#schema-queryresult).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-episodes-read"></a>
## episodes.read

Relit un épisode personnel avec sa réponse extractive et ses citations, sous les droits actuels sur les preuves.

**Utilisation frontend :** Si une source est révoquée, accepter le refus de relecture et ne pas réafficher une copie historique conservée sous une autre session.

- HTTP : `GET /v1/domains/{domain}/episodes/{episode_id}`.
- MCP : `api_episodes_read` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `episode_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [QueryResult](#schema-queryresult).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-episodes-feedback"></a>
## episodes.feedback

Enregistre le retour explicite historique associé à un épisode ; cette route reste compatible avec les anciens clients.

**Utilisation frontend :** Pour les nouveaux parcours, préférer feedback.record_signal et cibler la réponse exacte si le compagnon a reformulé l'extrait.

- HTTP : `POST /v1/domains/{domain}/episodes/{episode_id}/feedback`.
- MCP : `api_episodes_feedback` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Écriture personnelle ou ajout à un historique personnel.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| path | `episode_id` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Corps requis `application/json` : [FeedbackInput](#schema-feedbackinput).
- Succès HTTP 200, `application/json` : [FeedbackReceipt](#schema-feedbackreceipt).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-domain-brief"></a>
## domain.brief

Retourne un résumé autorisé des propositions en attente et des signalements des épisodes du demandeur.

**Utilisation frontend :** Construire une vue propriétaire bornée ; ce résumé n'est pas un tableau global des conversations et avis privés de l'entreprise.

- HTTP : `GET /v1/domains/{domain}/brief`.
- MCP : `api_domain_brief` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| path | `domain` | oui | texte | format : `"uuid"` |
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [BriefView](#schema-briefview).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

<a id="action-interactions-list"></a>
## interactions.list

Expose le catalogue des opérations métier, leurs rôles nécessaires et leurs effets. Il ne contient pas les droits individuels sur chaque objet.

**Utilisation frontend :** Permettre à un frontend ou un agent de découvrir les actions, puis vérifier leur disponibilité avec l'identité et les lectures métier.

- HTTP : `GET /v1/interactions`.
- MCP : `api_interactions_list` ; arguments structurés `path`, `query`, `body` et éventuellement `header` selon `mcp-tools.json`. Authentification et confirmation sont ajoutées par le transport de l'hôte.
- Rôles préalables : owner, corpus_manager, contributor, agent, viewer.
- Effet : Lecture sans modification métier durable.
- Décision : intention utilisateur autorisée ; aucune élévation de rôle implicite.

### Paramètres

| Emplacement | Nom | Requis | Type | Contraintes |
|---|---|---|---|---|
| header | `x-tenant-id` | oui | texte | format : `"uuid"` |

### Corps et résultat

- Aucun corps attendu.
- Succès HTTP 200, `application/json` : [InteractionCatalog](#schema-interactioncatalog).
- Erreurs déclarées : 422, 401, 403, 404, 409, 413, 429, 503.

## Schémas des données

Les noms techniques restent identiques dans HTTP, TypeScript et MCP. Les champs d'un objet imbriqué sont décrits par le lien vers son schéma. Le JSON machine conserve toutes les contraintes, y compris les alternatives complexes.

<a id="schema-accessinput"></a>
### AccessInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `allowed_subjects` | oui | liste de texte | éléments min. : `1`; éléments max. : `100` |

<a id="schema-accessreceipt"></a>
### AccessReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `allowed_subjects` | oui | liste de texte | — |

<a id="schema-accessibledomain"></a>
### AccessibleDomain

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `name` | oui | texte | — |
| `role` | oui | `"owner"`, `"corpus_manager"`, `"contributor"`, `"agent"`, `"viewer"` | — |
| `capabilities` | oui | liste de texte | — |

<a id="schema-approvalinput"></a>
### ApprovalInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_review_revision` | non | entier | minimum : `0.0`; défaut : `0` |
| `digest` | oui | texte | motif : `"^[a-f0-9]{64}$"` |
| `expected_version` | oui | entier | minimum : `0.0` |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-approvalreceipt"></a>
### ApprovalReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `sequence` | oui | entier | — |
| `proposal_id` | oui | texte | format : `"uuid"` |
| `accepted` | oui | `true` | — |

<a id="schema-briefissue"></a>
### BriefIssue

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `kind` | oui | `"knowledge_gap"`, `"disputed_answer"` | — |
| `reason` | oui | texte | — |
| `episode_id` | oui | texte | format : `"uuid"` |

<a id="schema-briefview"></a>
### BriefView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `accepted_version` | oui | entier | — |
| `published_version` | oui | entier | — |
| `pending_proposals` | oui | liste de [ProposalView](#schema-proposalview) | — |
| `issues` | oui | liste de [BriefIssue](#schema-briefissue) | — |
| `processing` | oui | `"local_no_model"` | — |
| `model_calls` | oui | `0` | — |

<a id="schema-citation"></a>
### Citation

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | — |
| `location` | oui | texte | — |
| `content_hash` | oui | texte | — |
| `start` | oui | entier | — |
| `end` | oui | entier | — |
| `excerpt` | oui | texte | — |

<a id="schema-collectioninput"></a>
### CollectionInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `name` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `description` | non | texte | longueur max. : `2000`; défaut : `""` |
| `allowed_subjects` | oui | liste de texte | éléments min. : `1`; éléments max. : `100` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-collectionpage"></a>
### CollectionPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [CollectionView](#schema-collectionview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-collectionview"></a>
### CollectionView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `name` | oui | texte | — |
| `description` | oui | texte | — |
| `allowed_subjects` | oui | liste de texte | — |

<a id="schema-commitpage"></a>
### CommitPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [CommitSummary](#schema-commitsummary) | — |
| `next_after` | oui | entier / null | — |

<a id="schema-commitsummary"></a>
### CommitSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `sequence` | oui | entier | — |
| `proposal_id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | — |
| `reason` | oui | texte | — |
| `digest` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-companionresponseinput"></a>
### CompanionResponseInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `answer_text` | oui | texte | longueur min. : `1`; longueur max. : `12000` |
| `answer_kind` | oui | `"answer"`, `"abstention"`, `"clarification"` | — |
| `citations` | non | liste de [SourceRef](#schema-sourceref) | éléments max. : `50` |
| `companion` | oui | texte | longueur min. : `1`; longueur max. : `100` |
| `model` | non | texte / null | — |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-companionresponsepage"></a>
### CompanionResponsePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [CompanionResponseView](#schema-companionresponseview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-companionresponseview"></a>
### CompanionResponseView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `episode_id` | oui | texte | format : `"uuid"` |
| `served_version` | oui | entier | — |
| `response` | oui | [CompanionResponseInput](#schema-companionresponseinput) | — |
| `citations` | oui | liste de [Citation](#schema-citation) | — |
| `reference_validation` | oui | `"episode_references_checked"`, `"no_references"` | — |
| `semantic_validation` | non | `"not_performed"` | défaut : `"not_performed"` |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-concept"></a>
### Concept

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `concept_id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `body` | oui | texte | longueur min. : `1`; longueur max. : `30000` |
| `maturity` | non | [Maturity](#schema-maturity) | défaut : `"emerging"` |
| `sources` | oui | liste de [SourceRef](#schema-sourceref) | éléments min. : `1`; éléments max. : `30` |
| `links` | non | liste de [Link](#schema-link) | éléments max. : `100` |

<a id="schema-conceptdifference"></a>
### ConceptDifference

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `concept_id` | oui | texte | format : `"uuid"` |
| `before` | oui | [Concept](#schema-concept) / null | — |
| `after` | oui | [Concept](#schema-concept) / null | — |

<a id="schema-conversationinput"></a>
### ConversationInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `title` | non | texte | longueur min. : `1`; longueur max. : `200`; défaut : `"Nouvelle conversation"` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-conversationmessage"></a>
### ConversationMessage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `sequence` | oui | entier | — |
| `question` | oui | texte | — |
| `result` | oui | [QueryResult](#schema-queryresult) | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-conversationmessages"></a>
### ConversationMessages

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ConversationMessage](#schema-conversationmessage) | — |
| `next_after` | oui | entier / null | — |

<a id="schema-conversationpage"></a>
### ConversationPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ConversationView](#schema-conversationview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-conversationqueryinput"></a>
### ConversationQueryInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `question` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `max_chars` | non | entier | minimum : `100.0`; maximum : `20000.0`; défaut : `8000` |
| `limit` | non | entier | minimum : `1.0`; maximum : `10.0`; défaut : `5` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-conversationtimeline"></a>
### ConversationTimeline

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `conversation` | oui | [ConversationView](#schema-conversationview) | — |
| `items` | oui | liste de [ConversationTurn](#schema-conversationturn) | — |
| `next_after` | oui | entier / null | — |
| `direction` | non | `"forward"`, `"backward"` | défaut : `"forward"` |
| `scan_limited` | non | booléen | défaut : `false` |
| `payload_limit_bytes` | non | `500000` | défaut : `500000` |

<a id="schema-conversationturn"></a>
### ConversationTurn

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `sequence` | oui | entier | — |
| `question` | oui | texte | — |
| `result` | oui | [QueryResult](#schema-queryresult) | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `responses` | oui | [TimelineResponsePage](#schema-timelineresponsepage) | — |
| `signals` | oui | [FeedbackSignalPage](#schema-feedbacksignalpage) | — |
| `issues` | oui | [IssuePage](#schema-issuepage) | — |

<a id="schema-conversationupdate"></a>
### ConversationUpdate

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `title` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `archived` | oui | booléen | — |
| `expected_revision` | oui | entier | minimum : `0.0` |

<a id="schema-conversationview"></a>
### ConversationView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | — |
| `archived` | oui | booléen | — |
| `revision` | oui | entier | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-episodehistoryitem"></a>
### EpisodeHistoryItem

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `question` | oui | texte | — |
| `result` | oui | [QueryResult](#schema-queryresult) | — |
| `served_version` | oui | entier | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-episodepage"></a>
### EpisodePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [EpisodeHistoryItem](#schema-episodehistoryitem) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-explicitfeedbackcounts"></a>
### ExplicitFeedbackCounts

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `thumbs_up` | oui | entier | minimum : `0.0` |
| `thumbs_down` | oui | entier | minimum : `0.0` |
| `comment` | oui | entier | minimum : `0.0` |
| `resolved` | oui | entier | minimum : `0.0` |

<a id="schema-extractioninput"></a>
### ExtractionInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `processing_destination` | oui | `"ollama"`, `"openrouter"` | — |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |
| `span` | non | [SourceRef](#schema-sourceref) / null | — |

<a id="schema-feedbackinput"></a>
### FeedbackInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `rating` | oui | `"helpful"`, `"unhelpful"` | — |
| `explanation` | non | texte | longueur max. : `2000`; défaut : `""` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-feedbackpreferences"></a>
### FeedbackPreferences

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `allow_observed` | non | booléen | défaut : `false` |
| `allow_inferred` | non | booléen | défaut : `false` |
| `revision` | oui | entier | minimum : `0.0` |

<a id="schema-feedbackpreferencesinput"></a>
### FeedbackPreferencesInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `allow_observed` | oui | booléen | — |
| `allow_inferred` | oui | booléen | — |
| `expected_revision` | oui | entier | minimum : `0.0` |

<a id="schema-feedbackreceipt"></a>
### FeedbackReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `feedback_id` | oui | texte | format : `"uuid"` |

<a id="schema-feedbacksignalinput"></a>
### FeedbackSignalInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `companion_response_id` | non | texte / null | — |
| `origin` | oui | `"explicit"`, `"observed"`, `"inferred"` | — |
| `kind` | oui | `"thumbs_up"`, `"thumbs_down"`, `"comment"`, `"reformulation"`, `"correction"`, `"abandon"`, `"resolved"`, `"satisfaction"` | — |
| `comment` | non | texte | longueur max. : `2000`; défaut : `""` |
| `companion` | oui | texte | longueur min. : `1`; longueur max. : `100` |
| `confidence` | non | nombre / null | — |
| `sentiment` | non | `"positive"`, `"negative"`, `"neutral"` / null | — |
| `iteration_index` | non | entier / null | — |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-feedbacksignalpage"></a>
### FeedbackSignalPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [FeedbackSignalView](#schema-feedbacksignalview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-feedbacksignalview"></a>
### FeedbackSignalView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `episode_id` | oui | texte | format : `"uuid"` |
| `served_version` | oui | entier | — |
| `source_ids` | oui | liste de texte | — |
| `signal` | oui | [FeedbackSignalInput](#schema-feedbacksignalinput) | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-feedbacksummary"></a>
### FeedbackSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `window_start` | oui | texte | format : `"date-time"` |
| `window_end` | oui | texte | format : `"date-time"` |
| `conversation_id` | oui | texte / null | — |
| `companion_response_id` | non | texte / null | — |
| `signal_count` | oui | entier | minimum : `0.0` |
| `episode_count` | oui | entier | minimum : `0.0` |
| `conflicting_explicit_episodes` | oui | entier | minimum : `0.0` |
| `explicit` | oui | [ExplicitFeedbackCounts](#schema-explicitfeedbackcounts) | — |
| `observed` | oui | [ObservedFeedbackCounts](#schema-observedfeedbackcounts) | — |
| `inferred` | oui | [InferredFeedbackCounts](#schema-inferredfeedbackcounts) | — |
| `legacy_feedback_included` | non | `false` | défaut : `false` |
| `interpretation` | oui | texte | — |

<a id="schema-filepage"></a>
### FilePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [FileView](#schema-fileview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-fileuploadinput"></a>
### FileUploadInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `filename` | oui | texte | longueur min. : `1`; longueur max. : `200`; motif : `"^[^/\\\\\\x00-\\x1f]+$"` |
| `content_base64` | oui | texte | longueur min. : `1`; longueur max. : `666668` |
| `allowed_subjects` | oui | liste de texte | éléments min. : `1`; éléments max. : `100` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-fileview"></a>
### FileView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `collection_id` | oui | texte | format : `"uuid"` |
| `filename` | oui | texte | — |
| `content_hash` | oui | texte | — |
| `size_bytes` | oui | entier | — |
| `status` | oui | `"pending"`, `"processing"`, `"succeeded"`, `"failed"`, `"cancelled"` | — |
| `source_id` | oui | texte / null | — |
| `error_code` | oui | texte / null | — |
| `attempts` | oui | entier | — |
| `spans` | oui | liste de objet | — |

<a id="schema-httpvalidationerror"></a>
### HTTPValidationError

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `detail` | non | liste de [ValidationError](#schema-validationerror) | — |

<a id="schema-healthview"></a>
### HealthView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `status` | oui | `"ok"` | — |
| `version` | oui | texte | — |
| `mode` | oui | `"extractive"` | — |

<a id="schema-identityview"></a>
### IdentityView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `extraction_provider` | non | `"ollama"`, `"openrouter"` / null | — |
| `subject` | oui | texte | — |
| `tenant_id` | oui | texte | format : `"uuid"` |
| `domains` | oui | liste de [AccessibleDomain](#schema-accessibledomain) | — |

<a id="schema-importitemview"></a>
### ImportItemView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `position` | oui | entier | — |
| `filename` | oui | texte | — |
| `status` | oui | `"pending"`, `"succeeded"`, `"failed"`, `"cancelled"` | — |
| `source_id` | oui | texte / null | — |
| `error_code` | oui | texte / null | — |
| `attempts` | oui | entier | — |

<a id="schema-importpage"></a>
### ImportPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ImportView](#schema-importview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-importview"></a>
### ImportView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `collection_id` | oui | texte | format : `"uuid"` |
| `status` | oui | `"pending"`, `"partial"`, `"succeeded"`, `"failed"`, `"cancelled"` | — |
| `processing` | non | `"local_text_only"` | défaut : `"local_text_only"` |
| `items` | oui | liste de [ImportItemView](#schema-importitemview) | — |

<a id="schema-inferredfeedbackcounts"></a>
### InferredFeedbackCounts

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `positive` | oui | entier | minimum : `0.0` |
| `negative` | oui | entier | minimum : `0.0` |
| `neutral` | oui | entier | minimum : `0.0` |

<a id="schema-interactioncatalog"></a>
### InteractionCatalog

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `version` | oui | texte | — |
| `openapi_url` | oui | texte | — |
| `authorization_notice` | oui | texte | — |
| `items` | oui | liste de [InteractionView](#schema-interactionview) | — |

<a id="schema-interactionview"></a>
### InteractionView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action_id` | oui | texte | — |
| `operation_id` | oui | texte | — |
| `method` | oui | texte | — |
| `path` | oui | texte | — |
| `roles` | oui | liste de texte | — |
| `effect` | oui | texte | — |
| `effect_description` | oui | texte | — |
| `intent_example` | oui | texte | — |
| `confirmation_policy` | oui | texte | — |
| `object_authorization` | oui | texte | — |

<a id="schema-issuedecisioninput"></a>
### IssueDecisionInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action` | oui | `"start"`, `"resolve"`, `"dismiss"`, `"reopen"` | — |
| `expected_revision` | oui | entier | minimum : `0.0` |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |
| `correction_proposal_id` | non | texte / null | — |

<a id="schema-issueevent"></a>
### IssueEvent

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `issue_id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | — |
| `previous_status` | oui | `"open"`, `"in_progress"`, `"resolved"`, `"dismissed"` | — |
| `status` | oui | `"open"`, `"in_progress"`, `"resolved"`, `"dismissed"` | — |
| `revision` | oui | entier | — |
| `reason` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `correction_proposal_id` | non | texte / null | — |
| `correction_digest` | non | texte / null | — |
| `correction_published_version` | non | entier / null | — |

<a id="schema-issueeventpage"></a>
### IssueEventPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [IssueEvent](#schema-issueevent) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-issuepage"></a>
### IssuePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [IssueView](#schema-issueview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-issueview"></a>
### IssueView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `episode_id` | oui | texte | format : `"uuid"` |
| `kind` | oui | `"knowledge_gap"`, `"disputed_answer"` | — |
| `reason` | oui | texte | — |
| `status` | oui | `"open"`, `"in_progress"`, `"resolved"`, `"dismissed"` | — |
| `revision` | oui | entier | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-link"></a>
### Link

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `target_id` | oui | texte | format : `"uuid"` |
| `kind` | oui | `"structural"`, `"associative"` | — |
| `primary` | non | booléen | défaut : `false` |
| `weight` | non | nombre | minimum : `0.0`; maximum : `1.0`; défaut : `1.0` |

<a id="schema-localextractioninput"></a>
### LocalExtractionInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `allow_local_processing` | oui | `true` | — |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-localextractionview"></a>
### LocalExtractionView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `input_span` | non | [SourceRef](#schema-sourceref) / null | — |
| `input_sha256` | non | texte / null | — |
| `provider` | non | `"ollama"`, `"openrouter"` | défaut : `"ollama"` |
| `request_id` | non | texte / null | — |
| `cost_usd` | non | nombre / null | — |
| `id` | oui | texte | format : `"uuid"` |
| `proposal` | oui | [ProposalView](#schema-proposalview) | — |
| `model` | oui | texte | — |
| `model_digest` | oui | texte / null | — |
| `prompt_version` | oui | texte | — |
| `input_tokens` | oui | entier / null | — |
| `output_tokens` | oui | entier / null | — |
| `processing` | non | `"local_model_passage_selection"`, `"openrouter_passage_selection"` | défaut : `"local_model_passage_selection"` |

<a id="schema-maturity"></a>
### Maturity

`"emerging"`, `"observed"`, `"established"`, `"reference"` ; —

<a id="schema-memberpage"></a>
### MemberPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [MemberView](#schema-memberview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-memberview"></a>
### MemberView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `subject` | oui | texte | — |
| `role` | oui | texte | — |
| `revision` | oui | entier | — |

<a id="schema-membershipeventpage"></a>
### MembershipEventPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [MembershipReceipt](#schema-membershipreceipt) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-membershipinput"></a>
### MembershipInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `subject` | oui | texte | longueur min. : `1`; longueur max. : `300` |
| `role` | oui | `"owner"`, `"corpus_manager"`, `"contributor"`, `"agent"`, `"viewer"` / null | — |
| `expected_revision` | non | entier / null | — |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-membershipreceipt"></a>
### MembershipReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | — |
| `subject` | oui | texte | — |
| `previous_role` | oui | texte / null | — |
| `new_role` | oui | texte / null | — |
| `resulting_revision` | oui | entier / null | — |
| `reason` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-modelattemptpage"></a>
### ModelAttemptPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ModelAttemptView](#schema-modelattemptview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-modelattemptview"></a>
### ModelAttemptView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `source_id` | oui | texte | format : `"uuid"` |
| `provider` | oui | `"openrouter"`, `"ollama"` | — |
| `requested_model` | oui | texte | — |
| `input_span` | oui | [SourceRef](#schema-sourceref) | — |
| `input_sha256` | oui | texte | — |
| `idempotency_key` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `status` | oui | `"unresolved"`, `"succeeded"`, `"failed"` | — |
| `finished_at` | oui | texte / null | — |
| `error_code` | oui | texte / null | — |
| `extraction_id` | oui | texte / null | — |

<a id="schema-modelusageview"></a>
### ModelUsageView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `utc_day` | oui | texte | format : `"date"` |
| `daily_limit` | oui | entier | minimum : `1.0` |
| `reserved_attempts` | oui | entier | minimum : `0.0` |
| `remaining_attempts` | oui | entier | minimum : `0.0` |
| `scope` | oui | texte | — |

<a id="schema-observedfeedbackcounts"></a>
### ObservedFeedbackCounts

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `reformulation` | oui | entier | minimum : `0.0` |
| `correction` | oui | entier | minimum : `0.0` |
| `abandon` | oui | entier | minimum : `0.0` |
| `resolved` | oui | entier | minimum : `0.0` |
| `iteration_index_samples` | oui | entier | minimum : `0.0` |
| `maximum_declared_iteration` | oui | entier / null | — |

<a id="schema-proposaldifference"></a>
### ProposalDifference

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `proposal_id` | oui | texte | format : `"uuid"` |
| `base_version` | oui | entier | — |
| `published_version` | oui | entier | — |
| `comparison` | oui | `"accepted_before_state"`, `"current_published_state"` | — |
| `stale_base` | oui | booléen | — |
| `items` | oui | liste de [ConceptDifference](#schema-conceptdifference) | — |

<a id="schema-proposalinput"></a>
### ProposalInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `base_version` | oui | entier | minimum : `0.0` |
| `changes` | oui | liste de [PutConcept](#schema-putconcept) / [RetireConcept](#schema-retireconcept) | éléments min. : `1`; éléments max. : `50` |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-proposalpage"></a>
### ProposalPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ProposalView](#schema-proposalview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-proposalvalidation"></a>
### ProposalValidation

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `status` | oui | `"passed"` | — |
| `source_support` | oui | `"verbatim_v1"` | — |
| `graph` | oui | `"acyclic"` | — |
| `policy` | oui | `"owner_low_risk_v1"` | — |
| `risk` | oui | `"low"` | — |
| `source_ids` | oui | liste de texte | — |

<a id="schema-proposalview"></a>
### ProposalView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `base_version` | oui | entier | — |
| `digest` | oui | texte | — |
| `reason` | oui | texte | — |
| `status` | oui | `"ready"`, `"approved"`, `"published"`, `"rejected"`, `"deferred"`, `"changes_requested"`, `"superseded"` | — |
| `validation` | oui | [ProposalValidation](#schema-proposalvalidation) | — |
| `payload` | oui | liste de [PutConcept](#schema-putconcept) / [RetireConcept](#schema-retireconcept) | — |
| `review_revision` | oui | entier | — |
| `replaces_id` | oui | texte / null | — |

<a id="schema-protectedresourcemetadata"></a>
### ProtectedResourceMetadata

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `resource` | oui | texte | — |
| `authorization_servers` | oui | liste de texte | — |
| `bearer_methods_supported` | oui | liste de `"header"` | — |
| `resource_name` | oui | texte | — |

<a id="schema-publicationreceipt"></a>
### PublicationReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `published_version` | oui | entier | — |
| `changed` | oui | booléen | — |

<a id="schema-putconcept"></a>
### PutConcept

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `kind` | non | `"put_concept"` | défaut : `"put_concept"` |
| `concept` | oui | [Concept](#schema-concept) | — |

<a id="schema-queryinput"></a>
### QueryInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `question` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `max_chars` | non | entier | minimum : `100.0`; maximum : `20000.0`; défaut : `8000` |
| `limit` | non | entier | minimum : `1.0`; maximum : `10.0`; défaut : `5` |

<a id="schema-queryresult"></a>
### QueryResult

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `episode_id` | oui | texte | format : `"uuid"` |
| `answer` | oui | texte | — |
| `status` | oui | `"evidence_found"`, `"knowledge_gap"` | — |
| `mode` | non | `"extractive"` | défaut : `"extractive"` |
| `served_version` | oui | entier | — |
| `concepts` | oui | liste de [Concept](#schema-concept) | — |
| `citations` | oui | liste de [Citation](#schema-citation) | — |
| `processing` | non | `"local_no_model"` | défaut : `"local_no_model"` |

<a id="schema-querystreamerror"></a>
### QueryStreamError

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `event` | non | `"error"` | défaut : `"error"` |
| `protocol_version` | non | `"1"` | défaut : `"1"` |
| `error` | oui | texte | — |
| `http_status` | oui | entier | minimum : `400`; maximum : `599` |
| `message` | non | texte | défaut : `"La réponse n'a pas pu être livrée. Relire l'état ou reprendre la même clé."` |
| `recovery` | non | `"inspect_or_retry_same_key"` | défaut : `"inspect_or_retry_same_key"` |

<a id="schema-querystreamresult"></a>
### QueryStreamResult

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `event` | non | `"result"` | défaut : `"result"` |
| `protocol_version` | non | `"1"` | défaut : `"1"` |
| `result` | oui | [QueryResult](#schema-queryresult) | — |

<a id="schema-querystreamstarted"></a>
### QueryStreamStarted

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `event` | non | `"started"` | défaut : `"started"` |
| `protocol_version` | non | `"1"` | défaut : `"1"` |
| `operation_id` | non | `"conversations.query"` | défaut : `"conversations.query"` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-readinessview"></a>
### ReadinessView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `status` | oui | `"ready"` | — |
| `schema_revision` | oui | texte | — |

<a id="schema-replayreceipt"></a>
### ReplayReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `published_version` | oui | entier | — |
| `concept_count` | oui | entier | — |
| `state_hash` | oui | texte | — |

<a id="schema-retireconcept"></a>
### RetireConcept

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `kind` | non | `"retire_concept"` | défaut : `"retire_concept"` |
| `concept_id` | oui | texte | format : `"uuid"` |

<a id="schema-reviewinput"></a>
### ReviewInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `action` | oui | `"reject"`, `"defer"`, `"request_changes"`, `"reopen"` | — |
| `digest` | oui | texte | motif : `"^[a-f0-9]{64}$"` |
| `expected_review_revision` | oui | entier | minimum : `0.0` |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-reviewpage"></a>
### ReviewPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [ReviewReceipt](#schema-reviewreceipt) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-reviewreceipt"></a>
### ReviewReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `proposal_id` | oui | texte | format : `"uuid"` |
| `author` | oui | texte | — |
| `action` | oui | texte | — |
| `reason` | oui | texte | — |
| `proposal_digest` | oui | texte | — |
| `review_revision` | oui | entier | — |
| `resulting_status` | oui | `"ready"`, `"approved"`, `"published"`, `"rejected"`, `"deferred"`, `"changes_requested"`, `"superseded"` | — |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-rollbackinput"></a>
### RollbackInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_version` | oui | entier | minimum : `0.0` |
| `reason` | oui | texte | longueur min. : `1`; longueur max. : `2000` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-sourcechunk"></a>
### SourceChunk

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `start` | oui | entier | minimum : `0.0` |
| `end` | oui | entier | strictement supérieur à : `0.0` |
| `content` | oui | texte | — |
| `sha256` | oui | texte | — |

<a id="schema-sourcechunkpage"></a>
### SourceChunkPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `algorithm` | oui | `"unicode-2000-6000-v1"` | — |
| `items` | oui | liste de [SourceChunk](#schema-sourcechunk) | — |
| `next_offset` | oui | entier / null | — |

<a id="schema-sourcedetail"></a>
### SourceDetail

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | — |
| `location` | oui | texte | — |
| `content_hash` | oui | texte | — |
| `allowed_subjects` | oui | liste de texte | — |
| `supersedes` | oui | texte / null | — |
| `content` | oui | texte | — |

<a id="schema-sourceinput"></a>
### SourceInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `title` | oui | texte | longueur min. : `1`; longueur max. : `200` |
| `location` | oui | texte | longueur min. : `1`; longueur max. : `1000` |
| `content` | oui | texte | longueur min. : `1`; longueur max. : `200000` |
| `allowed_subjects` | oui | liste de texte | éléments min. : `1`; éléments max. : `100` |
| `supersedes` | non | texte / null | — |

<a id="schema-sourcepage"></a>
### SourcePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [SourceSummary](#schema-sourcesummary) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-sourceref"></a>
### SourceRef

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `source_id` | oui | texte | format : `"uuid"` |
| `start` | oui | entier | minimum : `0.0` |
| `end` | oui | entier | strictement supérieur à : `0.0` |

<a id="schema-sourcesummary"></a>
### SourceSummary

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `title` | oui | texte | — |
| `location` | oui | texte | — |
| `content_hash` | oui | texte | — |
| `allowed_subjects` | oui | liste de texte | — |
| `supersedes` | oui | texte / null | — |

<a id="schema-synthesisinput"></a>
### SynthesisInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `processing_destination` | oui | `"openrouter"` | — |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-synthesispage"></a>
### SynthesisPage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [SynthesisView](#schema-synthesisview) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-synthesisusage"></a>
### SynthesisUsage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `request_id` | oui | texte | motif : `"^[A-Za-z0-9._:/-]{1,200}$"` |
| `cost_usd` | oui | nombre | minimum : `0.0` |
| `input_tokens` | oui | entier | minimum : `0.0` |
| `output_tokens` | oui | entier | minimum : `0.0` |

<a id="schema-synthesisview"></a>
### SynthesisView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `episode_id` | oui | texte | format : `"uuid"` |
| `provider` | oui | `"openrouter"`, `"none"` | — |
| `requested_model` | oui | texte / null | — |
| `prompt_version` | oui | texte | — |
| `budget_reserved` | oui | booléen | — |
| `idempotency_key` | oui | texte | — |
| `created_at` | oui | texte | format : `"date-time"` |
| `status` | oui | `"unresolved"`, `"succeeded"`, `"failed"` | — |
| `response_id` | oui | texte / null | — |
| `error_code` | oui | texte / null | — |
| `usage` | oui | [SynthesisUsage](#schema-synthesisusage) / null | — |
| `finished_at` | oui | texte / null | — |

<a id="schema-targetedpublicationinput"></a>
### TargetedPublicationInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `expected_published_version` | oui | entier | minimum : `0.0` |

<a id="schema-targetedpublicationreceipt"></a>
### TargetedPublicationReceipt

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `published_version` | oui | entier | — |
| `changed` | oui | booléen | — |
| `proposal_id` | oui | texte | format : `"uuid"` |
| `target_version` | oui | entier | minimum : `1.0` |

<a id="schema-textimportinput"></a>
### TextImportInput

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [TextImportItem](#schema-textimportitem) | éléments min. : `1`; éléments max. : `20` |
| `idempotency_key` | oui | texte | longueur min. : `8`; longueur max. : `128` |

<a id="schema-textimportitem"></a>
### TextImportItem

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `filename` | oui | texte | longueur min. : `1`; longueur max. : `200`; motif : `"^[^/\\\\\\x00-\\x1f]+$"` |
| `content` | oui | texte | longueur min. : `1`; longueur max. : `30000`; motif : `"^[^\\x00]+$"` |
| `allowed_subjects` | oui | liste de texte | éléments min. : `1`; éléments max. : `100` |

<a id="schema-timelineresponse"></a>
### TimelineResponse

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `id` | oui | texte | format : `"uuid"` |
| `response` | oui | [CompanionResponseInput](#schema-companionresponseinput) | — |
| `reference_validation` | oui | `"episode_references_checked"`, `"no_references"` | — |
| `semantic_validation` | non | `"not_performed"` | défaut : `"not_performed"` |
| `created_at` | oui | texte | format : `"date-time"` |

<a id="schema-timelineresponsepage"></a>
### TimelineResponsePage

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `items` | oui | liste de [TimelineResponse](#schema-timelineresponse) | — |
| `next_after` | oui | texte / null | — |

<a id="schema-validationerror"></a>
### ValidationError

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `loc` | oui | liste de texte / entier | — |
| `msg` | oui | texte | — |
| `type` | oui | texte | — |
| `input` | non | voir schéma JSON | — |
| `ctx` | non | objet | — |

<a id="schema-versionview"></a>
### VersionView

Champs non déclarés interdits.

| Champ | Requis | Type / valeurs | Contraintes |
|---|---|---|---|
| `domain_id` | oui | texte | format : `"uuid"` |
| `accepted_version` | oui | entier | — |
| `published_version` | oui | entier | — |
