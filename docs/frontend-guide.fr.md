# Guide fonctionnel d'intégration du frontend

Cette référence cadre les fonctions utilisateur, corpus manager et propriétaire de Cortex Fusion. Elle ne prescrit pas de layout. Elle accompagne le frontend React 18 / TypeScript / Vite développé séparément, avec TanStack Query pour les données serveur, Zustand pour les brouillons et états locaux, et une interface française.

La [référence exhaustive des endpoints](frontend-api.fr.md) donne, pour chaque opération, sa fonction, ses paramètres, ses schémas d'entrée/sortie, ses rôles et son outil MCP. Le [catalogue français JSON](../packages/contracts/functional-interactions.fr.json) est utilisable par un outil de génération ou un agent. Les contrats de types sont dans `packages/contracts/src/`. Les fonctions décrites ici sont celles effectivement livrées ; le tableau suivant distingue les écarts.

## Candidat Rust : paramètres à utiliser

Les79 endpoints et95 outils MCP historiques sont implémentés en Rust. Sept extensions natives d’import et de reprise portent la surface à **86 opérations HTTP et102 outils MCP** ; leurs [schémas et descriptions françaises](rust-extensions.fr.md) complètent la référence. Les fonctions et schémas métier ci-dessous restent la référence d’intégration. Pour ce runtime, appliquer les précisions suivantes avant les sections communes :

- Base locale : `http://127.0.0.1:8010`, avec OpenAPI sur `/openapi.json` et MCP Streamable HTTP sur `/mcp/`. Aucun écran `/docs` n’est livré par Rust. Le frontend React/Vite peut garder ses clients typés et ses clés de cache.
- Le serveur exige `CORTEX_RUST_DATABASE_URL` et exactement une source d’identité : PEM via `CORTEX_JWT_PUBLIC_KEY_FILE`, ou JWKS fixe via `CORTEX_JWKS_URL`. La [rotation JWKS native](jwks-rotation.fr.md) refuse les clés retirées et les caches expirés, y compris aux contrôles des requêtes en cours. Les rôles viennent toujours de SQL.
- Les confirmations sensibles HTTP et MCP sont toujours requises ; `CORTEX_HTTP_CONFIRMATION_MODE=trusted_host` n’accorde aucun contournement dans le candidat Rust. Les champs doivent rester identiques entre préparation, signature et envoi.
- `GET /v1/me` indique les capacités effectivement configurées. Le catalogue exhaustif ne prouve ni l’activation d’un fournisseur ni les droits sur un objet. Synthèse et extraction sont optionnelles ; TerminusDB est requis pour les connaissances publiées.
- Les erreurs de validation422 peuvent avoir un détail différent de FastAPI. Afficher une erreur exploitable, conserver les champs saisis et ne pas dépendre de la structure interne Pydantic pour décider des droits.
- L’analyse des fichiers utilise un processus Rust borné. Les reçus et le cycle `process/retry/cancel` sont conservés, mais l’extraction PDF peut produire un texte différent du parseur Python. Les citations doivent porter sur la source effectivement créée.
- Les anciennes CLI Python ne deviennent pas des workers Rust. Le binaire optionnel `cortex-corpus-worker` traite les fichiers accessibles et les imports personnels via les mêmes API ; sans worker configuré, le frontend ou l’hôte déclenche `process` puis relit les reçus. Fermer le frontend n’annule pas un traitement déjà engagé.

Les [instructions de démarrage Rust](rust-start.fr.md) détaillent la configuration, et le [bilan de migration](rust-migration.fr.md) distingue les validations acquises des limites de production. Les ressources `cortex://guide`, `cortex://workspace`, `cortex://actions` et le contexte par domaine, ainsi que les trois prompts historiques, permettent aussi un usage via compagnon sans frontend dédié.

## Reprendre une publication Rust interrompue

L’approbation accepte une proposition ; la publication active ensuite sa version de savoir. Un timeout ou `503` n’est pas une preuve de succès. Le propriétaire relit d’abord la proposition, la version et `GET /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts`. Ce dernier expose la tentative active (UUID, génération, état), les tentatives précédentes et leur motif. Il ne contacte pas le moteur.

La publication ciblée normale peut rapprocher une préparation déjà complète par lecture TerminusDB. Si la préparation demeure incomplète, l’hôte fait confirmer explicitement son remplacement :

```json
{
  "expected_published_version": 0,
  "expected_attempt_id": "UUID_DE_LA_TENTATIVE_ACTIVE",
  "expected_generation": 1,
  "idempotency_key": "CLE_STABLE_DE_CETTE_DECISION",
  "reason": "Reprendre la préparation interrompue après vérification"
}
```

Envoyer ce corps à `POST /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts`, ou à `api_proposals_retry_publication` avec `path` et `body`. La confirmation signée lie exactement cette commande. Les UUID ci-dessus sont des emplacements à remplacer par les valeurs reçues. Une clé appartient à la décision du sujet authentifié ; la réutiliser avec un autre motif ou une autre cible retourne `IDEMPOTENCY_CONFLICT`.

Le statut HTTP `201` accuse réception d’une tentative durable. Afficher le résultat d’après `outcome` :

| Résultat | Sens fonctionnel | Suite pour l’hôte |
|---|---|---|
| `published` | Cette tentative a activé la version cible. | Invalider version, concepts, proposition, journal, brief et historique des tentatives. |
| `unresolved` | La tentative est durable mais sa publication n’est pas confirmée. | Relire l’historique ; un rejeu signé avec la même clé rapproche par lecture seulement, sans recréer la base. |
| `superseded` | Une décision ultérieure a remplacé cette tentative. | Montrer la tentative active et son résultat ; ne pas relancer l’ancienne. |

Un propriétaire peut décider d’un nouveau remplacement si la tentative active reste incomplète. Cela exige une nouvelle clé, l’UUID/génération actuels et une nouvelle confirmation. Ne jamais générer cette décision automatiquement à la suite d’un `503` ou d’un reçu `unresolved`. Aucun nettoyage automatique de base ancienne n’est effectué.

`PUBLICATION_READY_TO_RECONCILE` (`409`) signifie que le graphe existant est complet : utiliser la publication normale. `PUBLICATION_NOT_PREPARED` invite à démarrer par cette même publication normale. `GRAPH_ATTEMPT_REPLACED` ou `STALE_PUBLICATION` demandent une relecture avant une nouvelle décision. `PUBLICATION_ALREADY_PUBLISHED` interdit une nouvelle tentative inutile. Après perte de droits, les lectures/reprises sont refusées même si une ancienne clé est connue.

`GET .../publication-events` et `api_proposals_publication_events` donnent un journal immuable (`reserved`, `uncertain`, `superseded`, `ready`, `stale`). `recorded_at` est une date d’observation SQL ; un événement ne certifie pas l’arrêt de toute requête moteur ancienne. La pagination retourne un curseur `next_after` à renvoyer tel quel ; les tentatives utilisent une génération numérique, les événements un UUID. Conserver les caches par tenant, domaine, proposition et sujet, puis les vider après changement d’identité ou de droits.

Les variantes GET existent aussi sous `api_proposals_publication_attempts`. Elles restent réservées au propriétaire et à ses preuves actuellement accessibles. Ces opérations portent sur la publication d’une proposition acceptée ; elles ne remplacent ni l’import initial historique, ni la restauration d’une sauvegarde.

## Correspondance avec les sept parcours du produit

| Parcours demandé | Disponible | Écart ou limite actuelle |
|---|---|---|
| Interroger le domaine | Recherche publiée, épisode personnel, citations exactes, version servie, manque de connaissance ; synthèse citée backend optionnelle et compagnon de référence | Flux SSE de recherche livré sur la question de conversation ; il ne diffuse pas de tokens LLM. La validation des citations ne prouve pas la vérité de chaque phrase générée. |
| Piloter et naviguer dans six vues | Brief propriétaire, concepts/relations, conversations archivables, propositions, signaux personnels, corpus/imports, journal | Le brief est un instantané à la demande, pas une synthèse quotidienne programmée. Pas de moteur de mémoire court/long terme distinct. |
| Valider et publier | Diff/preuves, rejet, report, demande de modification, réouverture, approbation et publication séparées | Pas de tâche de publication asynchrone ni de barre de progression métier ; le reçu confirme la transaction. |
| Corriger un concept ou une relation | Proposition typée de remplacement de concept avec ses relations et preuves, revue puis publication | Pas de PATCH direct sur une relation canonique. Préparer la nouvelle représentation complète à partir du concept relu. |
| Boucler sur les retours | Signal explicite/observé/inféré, signalement personnel, prise en charge, résolution, classement sans suite et historique | Pas de file de feedback partagée entre tous les membres. La décision de signalement est dans son historique personnel ; elle n'est pas une publication au journal canonique. Lien explicite correction_proposal_id dans les décisions ; une résolution liée exige une proposition publiée. |
| Alimenter le corpus | Collections, lots texte, dépôt JSON base64, analyse bornée, états/erreurs, reprises, création de sources et propositions | L'import réussi ne crée pas automatiquement une proposition ou une publication. Pas d'OCR général ni de garantie de fidélité complète du PDF. |
| Tracer et administrer | Rôles par domaine, lecteurs par source, événements de membership, revue et journal immuables | Pas d'annuaire global, invitations, synchronisation de groupes ni d'IdP fourni par Cortex Fusion. |

## Vérifier la disponibilité du backend

`GET /health` indique que le processus HTTP répond. `GET /ready` (`api_system_ready`) ouvre une connexion PostgreSQL dédiée et vérifie la révision de migration attendue, la présence des tables requises, leurs indicateurs de RLS activée/forcée, leur lisibilité et l’absence de rôle applicatif superutilisateur, BYPASSRLS ou propriétaire. Une réponse 200 contient `status=ready` et `schema_revision`. Un échec retourne 503 avec `error=NOT_READY`, sans chaîne de connexion, identité SQL ou détail d’erreur.

La révision attendue doit correspondre exactement au code déployé. Exécuter les migrations avant d’envoyer du trafic ; une base plus récente peut aussi être refusée par un ancien serveur. La sonde HTTP est publique pour l’exploitation ; l’outil MCP conserve l’authentification du transport. Les délais de socket (2 secondes) et de requête SQL (1,5 seconde) bornent chaque opération, pas un SLA global.

Cette sonde ne contacte aucun fournisseur IA, ne teste pas la validité de sa clé, ne certifie pas le corps des politiques RLS, les données ou tous les parcours métier, et ne remplace pas les tests de migration. Un frontend peut distinguer une indisponibilité backend d’un refus de droits, sans tenter une action métier pour vérifier la connexion. Éviter le polling à haute fréquence : chaque sonde crée sa propre connexion et n’utilise pas le pool applicatif.

## Objets et mots à employer

| Objet | Sens fonctionnel |
|---|---|
| Tenant | Frontière d'isolation de l'organisation. Le transport fournit son UUID. |
| Domaine | Périmètre de connaissance et d'appartenance à l'intérieur du tenant. |
| Collection | Ensemble privé utilisé pour organiser des sources et imports. |
| Source | Texte original immuable, provenance, empreinte et lecteurs ; pas encore une connaissance approuvée. |
| Proposition | Changement candidat avec preuves exactes, version de base, digest et historique de revue. |
| Concept / relation | Connaissance publiée ; les relations sont portées par les concepts. |
| Commit / version | Historique accepté et position publiée. Une approbation peut précéder la visibilité dans les réponses. |
| Conversation | Historique personnel dans un domaine, renommable et archivable. |
| Épisode | Une question, son résultat de recherche, ses preuves et la version servie. |
| Réponse de compagnon | Formulation conservée, séparée de l'extrait brut ; citations vérifiées, sémantique non certifiée. Sa présence ne prouve pas son affichage ou sa lecture. |
| Signal | Retour immuable dont l'origine est explicite, observée ou inférée. |
| Signalement | Problème personnel à suivre ; sa fermeture ne modifie pas la connaissance. |
| Tentative IA | Réservation et résultat durable d'une extraction ou synthèse ; un état unresolved ne permet pas une relance automatique. Pas une facture globale. |

Éviter « ajouté au cerveau » après un upload : dire « fichier reçu », « source enregistrée », « proposition créée », « accepté » ou « publié », selon le reçu exact.

## Identité, rôles et confirmations

L'authentification est fournie par un IdP externe. Cortex vérifie les JWT RS256 avec émetteur, audience et clé/JWKS configurés ; il ne fournit pas de formulaire de connexion ni de route de création de session utilisateur. Le rôle applicatif provient de l'appartenance stockée côté serveur ; un champ role dans le JWT ne l'impose pas.

| Rôle technique | Responsabilité |
|---|---|
| viewer | Consulte la connaissance accessible, interroge, gère ses conversations et retours personnels. |
| contributor | Prépare des propositions dans son périmètre, en plus des lectures personnelles. |
| agent | Identité d'agent autorisée à préparer des changements, jamais à s'auto-approuver. |
| corpus_manager | Organise et importe le corpus accessible, prépare des propositions. N'approuve pas la connaissance. |
| owner | Revoit, accepte, publie et administre le domaine dans les limites d'accès et des objets personnels. |

La matrice précise est celle de chaque endpoint, pas une hiérarchie implicite où un rôle autoriserait toutes les actions d'un autre.

Chaque appel protégé comporte `Authorization: Bearer <jeton>` et `X-Tenant-ID: <uuid>`. Le domaine est dans le chemin. Appeler `GET /v1/me` après connexion ; choisir un domaine parmi ceux retournés. Un lien partagé vers une proposition ne donne aucun accès supplémentaire.

**Contrôle des décisions sensibles :** en Rust, MCP et les routes HTTP directes exigent toujours une attestation `X-Cortex-Confirmation`, liée à la commande exacte, au sujet et au tenant, valide au maximum cinq minutes et à usage unique. Configurer `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE`. Rust publie toujours le mode `required` ; la variable `CORTEX_HTTP_CONFIRMATION_MODE` concerne la référence Python. Sans clé de vérification ou sans attestation, une commande sensible autorisée par le rôle reçoit 428 ; les consultations restent utilisables.

Dans la référence Python seulement, le mode explicite `CORTEX_HTTP_CONFIRMATION_MODE=trusted_host` préserve l'ancien fonctionnement HTTP pour un serveur de confiance qui recueille lui-même la décision. Il ne convient pas à une API directement exposée aux commandes d'un modèle ou d'un navigateur privilégié. Il ne désactive jamais les confirmations MCP. Les fixtures métier et démonstrations synthétiques l'utilisent explicitement ; les tests de transport vérifient le mode strict. Le mode effectif est publié dans `x-cortex-http-confirmation-mode` de l'OpenAPI.

Le pont MCP transmet une preuve en mémoire après vérification pour éviter une seconde consommation au passage HTTP interne. Aucun en-tête de contournement n'est accepté depuis le réseau. Une confirmation utilisée reste consommée même si une précondition métier échoue ensuite : relire l'état avant une nouvelle décision, conserver la clé métier si l'intention est la même.

La clé privée de confirmation reste côté hôte de confiance qui recueille la décision, distinct du backend Cortex, lequel ne reçoit que la clé publique. Les clés OpenRouter et les secrets d'IdP restent dans les processus serveur concernés. Ils ne doivent jamais être inclus dans les variables publiques de build Vite, le navigateur ou les arguments d'un modèle. L'hôte de confiance prépare la confirmation HTTP/MCP après avoir recueilli le choix sur les paramètres exacts.

### Préparer une confirmation depuis le serveur de l'interface

Pour HTTP direct, la forme signée est celle de l'outil MCP généré : `path`, corps JSON `body` si présent et en-têtes métier `header` si déclarés. Ne pas inclure les jetons de transport ni ajouter les valeurs par défaut absentes du corps envoyé. Les paramètres non déclarés sont refusés en mode strict.

Exemple de commande de publication :

```json
{
  "action": "domain.publish",
  "arguments": {"path": {"domain": "UUID_DU_DOMAINE"}}
}
```

L'hôte recueille la décision sur cette commande, puis utilise le helper serveur `sign_confirmed_action` de `cortex_core.confirmations` ou reproduit le contrat documenté dans [les confirmations MCP](mcp-exhaustive.md). Le hash utilise SHA-256 du JSON UTF-8, clés triées récursivement, séparateurs sans espaces et Unicode non échappé. La première réponse 428 fournit aussi `confirmation_request.command_hash`, sans le texte privé de la commande. Un champ `confirmed: true` n'est jamais une autorisation suffisante.

La réponse de préparation ne signe rien. Le navigateur ne doit pas posséder la clé privée. Une intégration JavaScript côté serveur doit vérifier sa sérialisation contre le helper et éviter de changer les nombres ou les champs après la décision.

## Intégration React, TanStack Query et navigation

Les UUID techniques sont les identifiants des routes API. Une route frontend telle que `/validate/PR-3082` nécessite une correspondance explicite avec un UUID réel ; le backend ne résout pas actuellement cet alias humain. Inclure le domaine dans le contexte de navigation.

Clé de cache indicative : `[tenantId, subject, domainId, resource, filters]`. Ajouter l'ID d'objet et la version/révision lorsqu'ils caractérisent la lecture. Ne jamais mettre le jeton lui-même dans les clés ou les logs. Vider les données privées lors d'une déconnexion ou d'un changement de tenant/identité. Une révocation peut rendre un objet historique inaccessible : ne pas réafficher alors une ancienne copie.

Zustand peut conserver le brouillon de question, les panneaux ouverts et l'intention en cours. Les rôles, versions publiées et reçus serveur restent des données serveur. Une mutation réussie est confirmée par son reçu, pas seulement par la fermeture d'un panneau.

| Mutation réussie | Lectures à actualiser dans le même contexte |
|---|---|
| Créer/mettre à jour une conversation | Liste et détail de conversation |
| Poser une question | Messages, épisodes et signalements personnels ; brief du domaine si le sujet est owner |
| Enregistrer une réponse | Réponses de compagnon de l'épisode/conversation |
| Enregistrer un signal | Signaux, résumé personnel, signalements en cas de retour négatif |
| Modifier le consentement | Préférences ; arrêter les collecteurs devenus interdits |
| Importer/traiter un fichier ou lot | Reçu, liste des imports/fichiers, sources accessibles |
| Créer/réviser une proposition | Proposition, liste, diff et revues selon le cas |
| Revoir/accepter | Proposition, revues, liste, brief ; version acceptée après acceptation |
| Publier | Version, concepts, résultats de recherche futurs, journal, brief |
| Proposer une compensation | Proposition, liste et diff ; la version ne change qu’après approbation et publication distinctes |
| Modifier les lecteurs/membres | Identité/capacités, listes et détails affectés ; purge des données désormais interdites |

Ne pas activer de retry automatique pour toute mutation. Conserver une clé par intention logique et reprendre selon le contrat. Une nouvelle clé signifie une nouvelle commande, parfois un nouvel appel facturé. Pour les lectures, temporiser les retries et arrêter sur 401/403/404 selon le contexte.

### Accès navigateur et CORS

Configurer `CORTEX_CORS_ORIGINS` comme un tableau JSON d'origines exactes, par exemple `["http://localhost:5173"]` pour Vite ou `["https://app.example.com"]` en production. L'origine contient schéma, hôte et port éventuel, sans chemin ni barre finale. Les jokers, origine null, identifiants intégrés, paramètres et HTTP distant sont refusés. HTTP est autorisé seulement pour localhost, 127.0.0.1 et ::1 explicitement nommés. La valeur vide `[]` désactive cette ouverture navigateur ; elle ne constitue pas un filtre global d'origine sur les clients serveur.

Quand la liste est configurée, toute requête portant une origine absente de la liste est refusée avant les commandes, même avec un jeton valide. Ajouter aussi l'origine du service si une interface servie par ce service doit l'appeler en envoyant Origin. Les clients serveur/CLI sans Origin restent soumis à l'authentification habituelle.

Les prévols OPTIONS autorisés passent sans JWT, mais les appels réels exigent toujours identité, droits et confirmations. Les méthodes admises sont GET, POST, PUT, DELETE et OPTIONS ; une méthode ou un en-tête de contrôle non déclaré est refusé au prévol. L'origine admise est retournée explicitement, avec variation par origine. Les cookies de session ne sont pas activés par CORS : l'intégration utilise les en-têtes Bearer et tenant ; ne pas supposer un mode credentials par cookie.

Les en-têtes autorisés couvrent Authorization, X-Tenant-ID, Content-Type, Accept, Idempotency-Key, X-Cortex-Confirmation, MCP-Protocol-Version, Mcp-Session-Id et Last-Event-ID. Les réponses exposent Content-Disposition, X-Content-Type-Options, WWW-Authenticate, Retry-After et les en-têtes de session/protocole MCP. Cela permet de lire le téléchargement binaire et le challenge d'authentification depuis fetch.

L'origine frontend autorisée peut aussi utiliser MCP, mais n'est pas ajoutée aux hôtes serveur permis. Configurer séparément l'URL publique MCP et l'audience ; ne pas contourner la protection d'hôte avec X-Forwarded-Host. Un statut 421 indique notamment un hôte MCP non autorisé. CORS est un contrôle navigateur/origine, pas un remplacement de l'authentification.

## Parcours 1 — question, citations, historique et voix

1. Lire l'identité et choisir le domaine.
2. Créer une conversation avec `conversations.create`, ou relire une conversation existante.
3. Envoyer `conversations.query` avec une question, une clé stable et éventuellement les bornes de restitution.
4. Conserver `episode_id`, `served_version`, `status`, la réponse et les citations. `evidence_found` indique des preuves ; `knowledge_gap` appelle un message de manque de connaissance, pas une invention.
5. Si un compagnon génère une reformulation, lui fournir uniquement les preuves autorisées et conserver sa réponse via `responses.create`. Ce parcours n'est pas un appel implicite de la route query.
6. Associer les actions « pouce bas », commentaire et résolution à la réponse exacte lorsque son reçu existe.

Exemple de corps pour `POST /v1/domains/{domain}/conversations/{ident}/query` :

```json
{
  "question": "Quelle est la procédure d'escalade d'un incident ?",
  "limit": 5,
  "max_chars": 8000,
  "idempotency_key": "question-logique-000001"
}
```

L'ID d'épisode et les références viennent du serveur. Chaque citation porte source, début et fin ; montrer l'extrait exact et l'accès à sa provenance. Pour découper en JavaScript à partir d'offsets Unicode, `Array.from(text).slice(start, end).join("")` correspond aux points de code ; utiliser de préférence les extraits renvoyés pour éviter un décalage.

Le rendu Markdown traite la réponse comme non fiable : ne pas exécuter de HTML ou d'instructions intégrées au corpus. Les citations doivent être reliées aux références du reçu, pas à des URLs inventées par le modèle.

### Flux SSE de la question de conversation

Le même `POST /v1/domains/{domain}/conversations/{ident}/query` accepte `Accept: text/event-stream`. Le corps reste `ConversationQueryInput`, avec clé d'idempotence. Sans préférence explicite pour SSE, la réponse reste `QueryResult` en JSON ; le MCP généré conserve ce comportement JSON. Une égalité de préférence entre JSON et SSE conserve JSON.

Le flux est du UTF-8 `text/event-stream`, avec `Cache-Control: no-store` et `X-Accel-Buffering: no`. Vérifier aussi les réglages du proxy de déploiement. Deux événements métier au maximum sont émis : started puis result ou error. Le démarrage est envoyé avant l'exécution de la recherche, après les premiers contrôles de conversation. Aucun pourcentage, faux token ou réponse partielle non vérifiée n'est généré.

| Événement | Données | Comportement frontend |
|---|---|---|
| started | protocol_version=1, operation_id=conversations.query, idempotency_key | Afficher la recherche en cours. Ce n'est pas une preuve d'écriture ou de réussite. |
| result | protocol_version=1, result de type QueryResult | Insérer le résultat sourcé et la version dans le cache ; terminer le chargement. |
| error | protocol_version=1, error, http_status, message et recovery=inspect_or_retry_same_key | Terminer le chargement en échec/incertitude ; lire l'état ou reprendre avec la même clé. |

Exemple de trame de démarrage (les données sont une seule ligne JSON) :

```text
event: started
data: {"event":"started","protocol_version":"1","operation_id":"conversations.query","idempotency_key":"question-logique-000001"}

```

Les objets d'événement sont typés dans QueryStreamStarted, QueryStreamResult et QueryStreamError et exportés en TypeScript. Le JSON échappe les retours à la ligne du contenu : ne pas interpréter le texte d'une citation comme des trames SSE.

Utiliser `fetch` POST avec un `AbortSignal`, les en-têtes d'identité et le corps JSON. Lire le `ReadableStream` avec un décodeur UTF-8 incrémental et un parseur SSE qui conserve les fragments entre lectures réseau. Une lecture réseau n'est pas forcément un événement complet. L'objet natif `EventSource` ne correspond pas directement à ce POST authentifié avec corps. Ne pas placer le jeton dans l'URL.

Avant ouverture du flux, les erreurs de validation, d'identité, de conversation privée/archivée ou de clé déjà conflictuelle restent des réponses HTTP JSON 4xx. Après le statut HTTP 200, une erreur se trouve dans l'événement error : ne pas considérer `response.ok` seul comme une réussite du chat. Une fermeture sans événement terminal laisse l'issue inconnue.

Une déconnexion n'annule pas une transaction déjà commencée ou validée. Reprendre le même POST avec le même contenu et la même clé, en JSON ou SSE : l'épisode déjà enregistré est relu sous les droits actuels. Une clé réutilisée pour une autre question reçoit un conflit. Aucun curseur durable d'événements n'est proposé ; un `Last-Event-ID` non vide reçoit `STREAM_CURSOR_UNSUPPORTED` avant le flux. Le résultat complet est rejoué, pas un suffixe de tokens.

Le jeton et les droits sur les preuves sont vérifiés de nouveau après le calcul, avant livraison. Une révocation pendant ce travail peut donc produire un événement error sans livrer le texte. Le reçu peut néanmoins déjà exister et rester inaccessible selon les droits actuels.

Ce flux expose l'avancement et la réponse de la recherche extractive. La génération citée d'un compagnon reste un traitement distinct : il n'y a ni diffusion des tokens OpenRouter ni abonnement permanent aux messages futurs dans ce contrat.

**Voix :** le backend actuel reçoit du texte, pas de l'audio. Le frontend peut préparer une transcription éditable, puis envoyer la même commande query. Il faut documenter la destination réelle du traitement vocal choisi ; l'usage de Web Speech API ne doit pas être présenté comme une garantie de traitement local. Aucun endpoint STT ni reçu vocal n'est encore fourni.

### Charger une conversation avec ses réponses et retours

`GET /v1/domains/{domain}/conversations/{ident}/timeline` (MCP `api_conversations_timeline`) retourne les métadonnées personnelles de la conversation et une page de tours. Chaque tour conserve sa séquence, la question, le résultat de recherche avec sa version et ses citations, puis trois sous-pages : `responses`, `signals` et `issues`. Les conversations archivées restent consultables par leur auteur.

Pour ouvrir un chat sur ses tours récents, demander `direction=backward&limit=10`. Les tours sont alors renvoyés du plus récent au plus ancien ; les inverser pour un affichage chronologique local si nécessaire. Le mode par défaut `forward` parcourt de l'ancien vers le récent. Pour continuer, réutiliser `next_after` comme paramètre `after`, avec la même direction. En backward, cela signifie « poursuivre vers les séquences plus anciennes », pas « supérieur à ce nombre ». Ne pas utiliser un curseur d'une direction dans l'autre.

Les bornes sont : limit 1–20 (défaut 10), responses_limit 1–5 (défaut 3), signals_limit 1–20 (défaut 5), issues_limit 1–10 (défaut 3). Les sous-pages sont triées par ID, indépendamment du sens des tours. Elles ne prétendent pas constituer une liste complète si leur next_after est non nul.

| Sous-page incomplète | Appel pour poursuivre |
|---|---|
| responses | GET /companion-responses avec episode_id, after=responses.next_after |
| signals | GET /feedback-signals avec episode_id, after=signals.next_after |
| issues | GET /issues avec episode_id, after=issues.next_after |

Ces chemins sont relatifs au domaine. Les réponses compactes contiennent leur ID, le contenu réellement délivré, ses références, sa date et les indicateurs de validation. Le texte des citations n'est pas dupliqué : retrouver les références dans `turn.result.citations`. L'endpoint de détail d'une réponse reste disponible pour son reçu complet. Les signaux gardent leur cible `companion_response_id`, éventuellement absente pour un signal ancien ou relatif à l'épisode.

Une page examine au maximum 100 positions de conversation. Les tours dont les preuves ne sont plus accessibles sont omis. Une page peut donc être vide avec `scan_limited=true` et `next_after` non nul : continuer avec le curseur, sans conclure à la fin de l'historique. Aucun nombre global de messages masqués n'est retourné.

La réponse est limitée à 500 000 octets sérialisés. Si la prochaine entrée dépasse le budget restant, la page s'arrête avec un curseur sans la perdre. Si une entrée seule est trop volumineuse, `TIMELINE_ITEM_TOO_LARGE` retourne 422 ; réduire les limites des sous-pages ou utiliser les messages et endpoints dédiés. Aucun texte n'est tronqué silencieusement.

La lecture n'appelle aucun modèle et ne crée ni signal ni événement. Le contrôle des preuves et l'assemblage sont protégés par la même frontière d'accès ; un propriétaire ne peut pas consulter la conversation personnelle d'un autre membre. Cette vue facilite le chat, pas un accès administratif global aux conversations.

### Produire une synthèse IA côté backend

La capacité `synthesize` dans `/v1/me` signale que la synthèse backend est configurée pour le domaine. La recherche JSON/SSE reste la première étape et fournit un `episode_id`. Si l’exploitant active `CORTEX_SYNTHESIS_ENABLED=true` et configure le modèle et la clé OpenRouter côté serveur, appeler ensuite `POST /v1/domains/{domain}/episodes/{episode_id}/syntheses` (`api_syntheses_create`) avec :

```json
{"processing_destination":"openrouter","idempotency_key":"synthesis-unique-001"}
```

La clé de synthèse est distincte de celle de la question. Ne pas renvoyer la question, des extraits arbitraires ou la clé fournisseur dans ce corps : le backend utilise l’épisode personnel et ses preuves. L’appel est synchrone, sans flux de tokens. La confirmation signée porte sur cette commande et cette destination ; en Rust, la confirmation reste obligatoire en HTTP et MCP ; la variante `trusted_host` concerne exclusivement la référence Python. Désactivé, le service retourne `SYNTHESIS_DISABLED` (503), après les contrôles de transport applicables.

**Lire `status`, même sur HTTP 200** :

| État | Traitement frontend |
|---|---|
| `succeeded` | Lire `response_id` via `responses.read`, afficher le texte, les citations et la version de savoir ; invalider la timeline et les réponses de l’épisode |
| `failed` | Afficher un échec explicite à partir du code sûr `error_code` ; une même clé ne relance pas le fournisseur |
| `unresolved` | La tentative est en cours ou son résultat n’a pas été établi. Consulter son état ; ne pas relancer automatiquement avec une nouvelle clé |

`succeeded` atteste une conservation durable, pas que le texte a été affiché ou lu. Aucun accusé de lecture n’est actuellement enregistré. Ne pas fabriquer un feedback positif, un événement de satisfaction ou une résolution à partir de cet état. Si le jeton expire après conservation, le POST peut retourner 401 ; un jeton valide permet ensuite de récupérer le résultat existant sans génération supplémentaire.

Après une perte de réponse, retrouver la tentative avec `GET /syntheses?episode_id=…&idempotency_key=…` ou reprendre exactement le même POST avec une nouvelle confirmation de transport. Une clé réutilisée pour un autre épisode donne `IDEMPOTENCY_CONFLICT` (409). Une tentative connue reste relisible si la configuration du modèle a changé ou a été désactivée, sous droits actuels. La lecture de la tentative et du reçu ne déclenche aucun modèle.

Sans preuve, le backend conserve une abstention déterministe avec `provider=none`, `requested_model=null` et `budget_reserved=false` : aucun appel fournisseur. Sinon la réservation partage le plafond quotidien du domaine avec les extractions ; `MODEL_DAILY_LIMIT` (429) refuse une nouvelle réservation. `budget_reserved=true` signifie qu’une tentative potentiellement payante a été réservée, pas qu’elle a forcément été envoyée ou facturée. L’usage est celui déclaré et validé par le fournisseur, pas une facture ; il peut être nul après un échec.

Un retrait d’accès avant l’envoi empêche l’appel ; un retrait pendant la génération empêche de conserver la réponse. Les données déjà envoyées ne peuvent pas être rappelées chez le fournisseur. Le jeton est recontrôlé avant envoi et résultat. Une interruption après l’envoi peut avoir été facturée : ne pas automatiser une nouvelle tentative, et ne pas déduire qu’un abandon du navigateur annule la génération. Une panne empêchant d’établir le résultat retourne `SYNTHESIS_STORAGE_UNCERTAIN` (503) ; consulter la clé existante.

La réponse est personnelle, y compris vis-à-vis du propriétaire du domaine, et ne publie aucune connaissance. Les références sont vérifiées contre l’épisode ; la justesse sémantique du texte reste non certifiée. Pour boucler sur la qualité, transmettre les retours réels en ciblant `response_id`, selon les préférences de collecte.

## Parcours 2 — brief et mémoire

Le brief propriétaire est obtenu à la demande par `domain.brief`. Les concepts/relations viennent de `concepts.list/read`, la connaissance servie de `domain.version`, les propositions de `proposals.list`, les sources/imports de leurs listes et le journal de `commits.list`.

Les conversations archivées sont un état de classement de l'historique personnel. La maturité d'un concept (`emerging`, `observed`, `established`, `reference`) est distincte de cet archivage. Aucune API ne déplace aujourd'hui des souvenirs entre trois stockages « court / long / archive ». Si ces labels sont utilisés dans le frontend, leur correspondance fonctionnelle doit être explicite.

## Parcours 3 — revoir, différer, approuver et publier

Lire la proposition et `proposals.diff`, puis les revues. Une décision de revue utilise `reject`, `defer`, `request_changes` ou `reopen`, avec raison, digest, révision attendue et clé. Ces valeurs techniques doivent être traduites en libellés français dans react-intl.

Une approbation utilise le digest et les versions attendues réellement relus. Après approbation, annoncer « accepté ». Depuis la fiche, utiliser ensuite `proposals.publish` (`POST /v1/domains/{domain}/proposals/{proposal_id}/publish`, outil `api_proposals_publish`) :

```json
{"expected_published_version": 0}
```

La valeur doit correspondre à la séquence du reçu d’acceptation moins un : pour publier le changement accepté de séquence 1, envoyer 0. La cible est le véritable `proposal_id` accepté. La confirmation signée lie ce chemin et ce corps précis ; le propriétaire et son accès actuel à toutes les preuves sont vérifiés à nouveau.

Le reçu contient `proposal_id`, `target_version`, `published_version` et `changed`. Si la cible est déjà publiée, `changed=false` : aucune autre proposition en attente n’est publiée par cette reprise, même si le domaine a avancé. `target_version` reste la publication historique de cette proposition ; `published_version` peut être supérieur. Cela ne certifie pas que ses effets sont encore en vigueur après des changements ultérieurs ou une compensation.

Une proposition non acceptée donne `PUBLICATION_NOT_ACCEPTED` (409), une version incompatible `STALE_PUBLICATION` (409), un accès perdu 404 et un rôle insuffisant 403. Après une perte de réponse, reprendre la même cible et le même corps avec une nouvelle confirmation de transport ; cette opération ne demande pas de clé d’idempotence métier supplémentaire. Relire la version et la proposition après conflit. La publication reste transactionnelle : pas de pseudo-progression de 0 à 100 % calculée côté UI.

La commande historique `domain.publish` (`POST /publish`) conserve son sens global : publier le prochain changement accepté. Elle ne lie pas une proposition au corps de la requête. La réserver aux hôtes qui veulent explicitement cette action globale, et préférer la publication ciblée pour une fiche frontend ou un companion qui reprend une action précise.

Les deux chemins de publication contrôlent les preuves actuelles de la proposition avant de modifier la connaissance. Une acceptation antérieure ne suffit pas si le publieur a depuis perdu accès aux preuves : 404, sans changement de version, projection, outbox ni trace de publication. Un propriétaire qui conserve les droits peut reprendre. Ne pas modifier automatiquement les ACL pour contourner ce refus. Une commande globale sans changement en attente reste sans effet ; une reprise ciblée reste soumise au contrôle des preuves de sa cible historique.

Après un timeout d'approbation, relire la proposition et réutiliser sa clé lorsque le contrat le permet. Après un timeout de publication globale, lire la version et le journal avant une nouvelle décision. Après conflit de révision, présenter à nouveau les changements actualisés ; ne pas approuver automatiquement un contenu différent.

## Parcours 4 — corriger un concept et ses relations

Lire le concept, ses preuves et la version actuelle. Construire une proposition contenant `changes` de type `put_concept` avec la représentation complète du concept modifié ; une relation contient `target_id`, `kind`, `primary` et `weight`. Un parent principal doit être structurel ; le serveur vérifie les contraintes du graphe et des preuves.

Conserver les liens et preuves non modifiés. Ne pas envoyer une représentation partielle en supposant une fusion automatique. La raison explique la correction. La proposition suit ensuite revue, approbation et publication ; le concept publié reste inchangé avant cette dernière étape.

## Parcours 5 — feedback, signalement et correction

| Origine | Types autorisés | Interprétation |
|---|---|---|
| explicit | thumbs_up, thumbs_down, comment, resolved | Déclaration réelle de l'utilisateur |
| observed | reformulation, correction, abandon, resolved | Événement effectivement observé par l'hôte, avec consentement |
| inferred | satisfaction | Estimation, avec consentement, sentiment, confiance et explication |

Un `iteration_index` n'appartient qu'aux événements observés. La confiance et le sentiment n'appartiennent qu'aux inférences. Le silence ne produit pas de vote positif ; fermer un onglet n'est pas automatiquement une insatisfaction.

Lire les préférences avant collecte. En cas de refus concurrent `COLLECTION_DISABLED`, interrompre la remontée. Une analyse de commentaire par modèle reste une inférence non calibrée et ne doit jamais être convertie en pouce explicite.

Le signalement personnel peut recevoir `start`, `resolve`, `dismiss` ou `reopen`, avec sa révision, sa raison et sa clé. Afficher « pris en charge », « résolu », « classé sans suite » et « rouvert ». Les décisions figurent dans `issues.history`. Pour corriger une connaissance, créer une proposition séparée ; ne pas annoncer que résoudre le signalement a publié une correction.

### Associer une correction à un signalement personnel

Créer d’abord la proposition par `proposals.create`, avec les changements et preuves choisis explicitement. Le commentaire, la question et l’identifiant du signalement ne sont pas copiés automatiquement vers la proposition, dont la visibilité dépend des preuves. Puis appeler `issues.decide` (ou `api_issues_decide`) sur son propre signalement :

```json
{
  "action": "start",
  "expected_revision": 0,
  "reason": "Je propose une correction documentée.",
  "idempotency_key": "issue-start-unique-001",
  "correction_proposal_id": "00000000-0000-4000-8000-000000000001"
}
```

Les identifiants de cet exemple doivent être remplacés par ceux du domaine. Ce lien est optionnel, réservé aux actions `start` et `resolve`, et exige un rôle permettant de lire la proposition (`owner`, `corpus_manager`, `contributor` ou `agent`) ainsi que l’accès actuel à toutes ses preuves. Le rôle `viewer` peut toujours gérer son signalement sans lien de proposition. Être propriétaire du domaine n’autorise pas à gérer le signalement d’un autre utilisateur.

Pour `start`, la proposition doit être prête, acceptée ou publiée. Pour `resolve` avec un lien, elle doit être **publiée** : une simple acceptation retourne `CORRECTION_NOT_PUBLISHED` (409), sans modifier le signalement. Une proposition rejetée, différée, à réviser ou remplacée retourne `CORRECTION_NOT_ACTIVE` (409). Créer une nouvelle clé après modification de la décision ; reprendre la même clé et le même corps après une perte de réponse. Un échec métier avant l’écriture du reçu peut être repris après correction de la précondition.

Le reçu et `issues.history` conservent l’identifiant, l’empreinte immuable et la version de publication connue **au moment de la décision**. Un reçu de prise en charge avant publication garde donc une version nulle. La résolution reçoit sa propre révision et son propre reçu. La consultation d’une décision liée recontrôle les droits de la proposition : si ces droits sont retirés, la décision entière est masquée, et ses anciennes clés ne permettent pas de relire le reçu. Les décisions sans lien restent visibles tant que le signalement est accessible. L’historique peut donc présenter des révisions non consécutives.

Ce lien déclare quelle correction l’utilisateur associe au problème. Il ne prouve pas sémantiquement que la proposition corrige la réponse. Une publication ultérieure ou une compensation peut remplacer ses effets ; la version enregistrée est historique. Une nouvelle question sourcée et un retour explicite permettent d’évaluer le résultat ; `reopen` reste une décision explicite. Une clôture `resolve` sans lien reste possible et ne signifie pas qu’une correction a été publiée.

Après la décision, invalider le signalement, son historique, les listes de signalements, la timeline et le brief concernés. Les clés et confirmations de création, acceptation et publication restent distinctes de celles du signalement.

## Parcours 6 — importer, traiter et proposer

Le dépôt binaire utilise JSON/base64 et accepte au plus 500 000 octets décodés ; le schéma limite la chaîne encodée à 666 668 caractères. Le nom de fichier n'est pas un chemin. Les analyses restent bornées à 30 000 caractères extraits dans cette version. Ne pas promettre la prise en charge de tous les PDF scannés.

Pour plusieurs textes, créer un lot d'import et traiter ses éléments par fenêtres. Pour plusieurs fichiers binaires, suivre chaque reçu de fichier ; ne pas supposer l'existence d'un endpoint multipart de lot binaire. Les états et erreurs doivent être montrés par élément.

Lire le reçu jusqu'à l'état pertinent, avec temporisation et arrêt du polling lorsqu'il n'y a plus de travail en cours. L'annulation ou la reprise doit être confirmée par le reçu. Une erreur de format nécessite une source corrigée, pas des retries illimités.

Après extraction réussie, utiliser la source créée pour proposer un passage exact. Le propriétaire garde la revue et la publication. Les fichiers ne deviennent pas automatiquement une connaissance servie.

### Suivre les propositions associées à une source importée

Quand un élément d’import ou un fichier traité fournit un `source_id`, appeler `GET /v1/domains/{domain}/proposals?source_id={source_id}` ou `api_proposals_list` avec `query.source_id`. Ajouter `status=ready`, `approved` ou `published` pour une vue ciblée. Conserver les mêmes filtres lors de la pagination avec `after` et `limit` (1 à 100). Dans TanStack Query, inclure le domaine, l’identité, la source et le statut dans la clé de cache.

Une liste vide signifie qu’aucune proposition correspondante n’est visible, sans déduire qu’un traitement IA a échoué. Un import `succeeded` reste réussi même si aucune proposition n’a été créée : import, proposition, acceptation et publication sont quatre étapes distinctes. La création d’une proposition et les décisions de revue/publication invalident les listes concernées ; le reçu d’import ne change pas lorsqu’une proposition est publiée.

Le filtre recherche la source dans l’ensemble des preuves requises de la proposition. Il peut donc inclure une preuve de l’état remplacé ou d’un concept relié. Il ne certifie pas que la proposition a été générée par l’extraction de cette seule source. Lire le diff et les preuves pour expliquer son rôle exact.

La source inexistante, d’un autre domaine/tenant ou devenue inaccessible retourne 404. Le rôle `viewer` n’a pas accès à la liste des propositions (403). Une proposition mêlant cette source à une autre preuve privée reste masquée ; aucun total global des propositions cachées n’est exposé. Une source reste consultable séparément selon ses droits. La pagination filtre les preuves avant de choisir le curseur ; son coût dépend du nombre de candidats invisibles, malgré l’index de recherche par source.

## Parcours 7 — droits et audit

L'administration porte sur un domaine. Une modification de membre renseigne sujet, rôle (ou null pour retrait selon le contrat), révision attendue, raison et clé. Les lecteurs d'une source sont un autre contrôle ; appartenir au domaine ne rend pas toute source lisible.

L'historique de membership, les revues, le journal canonique et les événements personnels de signalement sont des historiques distincts. Le frontend peut proposer une navigation entre eux, mais ne doit pas les présenter comme un journal universel auquel le propriétaire aurait accès.

### Identifier une publication réussie dans le journal

`commits.list` (`GET /v1/domains/{domain}/commits`, MCP `api_commits_list`) reste réservé au propriétaire et filtre les preuves de chaque entrée. Le contrat distingue :

| Champs | Sens fonctionnel |
|---|---|
| `author`, `created_at` | Sujet et date de l’acceptation du changement |
| `published=false`, `publication=null` | Changement accepté, encore hors de la version servie |
| `published=true`, `publication={publisher, recorded_at}` | Publication réussie tracée avec son propre acteur et horodatage |
| `published=true`, `publication=null` | Changement publié sans trace de publication disponible, notamment avant migration 0018 ; afficher « auteur/date de publication indisponibles » |

La trace est insérée dans la transaction de publication : si celle-ci échoue, la trace et la projection sont annulées ensemble. Une reprise ciblée déjà réussie ou une reconstruction de projection ne remplace pas l’acteur d’origine et n’ajoute pas une nouvelle publication. Les deux opérations de publication, globale et ciblée, produisent cette trace pour leurs nouvelles réussites.

`recorded_at` est l’heure d’insertion fournie par PostgreSQL ; ce n’est ni l’heure exacte du commit, ni celle à laquelle un utilisateur a vu le résultat. Aucune valeur historique n’est inventée à partir de l’approbateur. Une confirmation consommée atteste une intention autorisée, pas une publication réussie ; le journal ne répertorie pas tous les essais échoués. Une compensation ultérieure n’efface pas le fait historique qu’une séquence a été publiée.

Après publication, invalider les requêtes TanStack Query du journal et de la version, en plus des concepts/propositions concernés. Masquer aussi cette métadonnée quand les preuves deviennent inaccessibles ; ne pas conserver une identité de publieur depuis le cache d’un autre tenant, domaine ou sujet.

## Erreurs et états transitoires

| HTTP / situation | Fonction attendue du frontend |
|---|---|
| 401 | Rétablir la session externe ; garder le brouillon local si approprié, sans exposer les jetons |
| 403 | Afficher le refus de capacité/collecte/confirmation ; actualiser les droits si nécessaire. ORIGIN_NOT_ALLOWED est un refus de transport ; le navigateur peut masquer son corps faute d’autorisation CORS. |
| 404 | Objet absent ou inaccessible ; ne pas révéler son existence via un cache d'une autre identité |
| 409 | Relire l'objet ; distinguer révision périmée, clé réutilisée avec autre contenu, état incompatible ou tentative IA déjà réservée |
| 413 | Réduire la taille ; vérifier octets et taille base64 avant nouvel envoi |
| 422 | Corriger les paramètres ou traiter une preuve/sortie invalide ; conserver les codes pour diagnostic |
| 428 | Préparer la confirmation exacte côté hôte, puis recueillir la décision |
| 429 | Attendre la remise à disposition du quota ; ne pas contourner avec de nouvelles clés |
| 503 / réseau interrompu | État incertain ; relire le reçu/version, ne pas afficher réussite ou relancer une génération aveuglément |

Les codes sont plus stables que les messages. Les traductions react-intl doivent prévoir un message générique pour un code inconnu, avec identifiant d'opération et possibilité de reprise appropriée. Ne pas afficher les exceptions brutes, jetons ou textes confidentiels dans la console.

## Trois scénarios d'acceptation pour le frontend

1. **Question sourcée puis manque de preuve** : utilisateur autorisé, conversation, question, citations/version affichées, reprise même clé sans doublon, seconde question sans preuve qui affiche le manque. Vérifier l'absence de contenu d'une source révoquée.
2. **Import → revue → publication** : corpus manager dépose un fichier, traite, crée une proposition ; sa tentative d'approbation est refusée. Le propriétaire lit le diff, diffère puis rouvre/accepte, publie et constate la nouvelle version.
3. **Pouce bas → traitement personnel → correction** : cibler le reçu de réponse, envoyer un vote explicite, lire le signalement, prendre en charge, créer une proposition séparée, puis résoudre ou classer avec raison. Vérifier qu'aucune inférence ne gonfle le nombre de votes.

Ces scénarios peuvent guider Playwright côté frontend ; le backend maintient les tests HTTP/MCP et PostgreSQL correspondants avec données synthétiques. Les variantes SSE et JSON utilisent la même clé de question. Les futures vues agrégées ou la génération de tokens doivent être rattachées à leurs propres contrats livrés.

## Tester la chaîne complète sans frontend ni clé fournisseur

Ce scénario démontre la référence Python. Pour qualifier le runtime Rust, utiliser les scénarios natifs du [guide de démarrage Rust](rust-start.fr.md) avec le vrai binaire.

Après les migrations, avec `CORTEX_TEST_ADMIN_URL` et `CORTEX_TEST_DATABASE_URL` pointant vers une base dédiée dont le nom se termine par `_test` :

```sh
uv run python scripts/demo_backend_synthesis.py --output /tmp/cortex-backend-synthesis.json
```

Ce scénario crée un tenant, un domaine, deux identités éphémères et une procédure synthétique ; il conserve ces données dans la base de test. Il démarre un serveur HTTP loopback puis utilise le SDK MCP officiel pour vérifier readiness, capacités, conversation/question, confirmation obligatoire, synthèse, reprise avec la même clé, lecture du reçu, feedback négatif synthétique ciblé, timeline et refus après révocation. La préparation initiale du savoir utilise les services backend ; le parcours utilisateur s’effectue via MCP avec le rôle viewer.

L’adaptateur fournisseur est remplacé explicitement par une simulation ; ce programme n’a pas d’option live et n’utilise aucune clé fournisseur réelle. Le rapport doit indiquer `status=passed`, `model_calls_simulated=1` et `paid_provider_calls=0`. Les contrôles vérifient l’intégration et les droits, pas la qualité sémantique d’un modèle réel ni une satisfaction utilisateur. Les clés privées de test restent en mémoire et ne sont pas envoyées au modèle ou aux outils MCP. Ce scénario est également exécuté en CI.

## Import et reprise du stockage du graphe

Ce parcours propriétaire sert à migrer un savoir déjà publié vers TerminusDB ; il est distinct du dépôt des fichiers sources. Lire `api_graph_import_attempts` avec le domaine et, facultativement, une version historique. Le diagnostic fournit `digest`, `count`, `projection_matches_journal`, `manifest_registered` et `active_attempt`. Ne proposer un import courant qu’après concordance de la projection et du journal. Une valeur `null` de concordance indique une version historique, pas un succès.

La confirmation de `api_graph_import_published` lie `expected_published_version` et `expected_projection_digest`. Conserver le même contenu après une réponse incertaine : l’action normale rapproche une préparation scellée par lecture seulement. Si une nouvelle tentative est nécessaire, `api_graph_retry_import` exige aussi l’UUID/génération active, une clé stable et un motif explicite. Afficher l’empreinte souhaitée lorsqu’elle diffère de l’ancienne après réparation. Une préparation héritée non scellée expose `intent_sealed=false` et n’est jamais adoptée implicitement.

Après une commande, invalider les diagnostics et événements d’import ; les versions métier et les validations ne sont pas modifiées. `201` sur une reprise est également possible au rejeu : utiliser `outcome`, et non le seul statut HTTP. Les événements proviennent de `api_graph_import_events`, paginés par curseur et filtrés à la version sélectionnée. Changer de version impose de repartir sans curseur. Ces appels sont utilisables par un compagnon en langage naturel avec les mêmes droits et confirmations que le frontend.

## Interruption lors d’un redémarrage backend

Le serveur peut fermer son admission pendant qu’il termine les requêtes acceptées. Si le transport HTTP/MCP ou un flux se coupe, conserver la décision et sa clé d’idempotence ; relire son état après reconnexion avant de proposer une reprise. La coupure ne prouve ni un échec métier ni un succès. Les signaux d’arrêt et leur délai sont des paramètres du processus opérateur, pas des actions de l’utilisateur ou de son compagnon.


## Traitement du corpus hors du frontend

Un [worker Rust optionnel](corpus-worker.fr.md) peut traiter les fichiers et imports en attente via les opérations existantes. Le frontend conserve les reçus comme source de vérité et les relit par polling ; aucun nouveau schéma ou outil MCP n’est nécessaire. Les lots de textes restent personnels à leur auteur, les fichiers suivent leurs ACL. Les échecs nécessitent toujours une décision explicite de reprise ; la fermeture du frontend ne vaut pas annulation du worker configuré par l’opérateur.


## Tailles et erreurs du pont MCP natif

Le [guide des limites de transport](transport-limits.fr.md) distingue les octets du corps HTTP interne et ceux du JSON-RPC transmis, les refus HTTP, les erreurs protocolaires et les reçus métier. Une réponse HTTP directe volumineuse peut nécessiter des pages plus petites via MCP. Une erreur de réponse ne prouve jamais qu’une mutation n’a pas eu lieu : relire le reçu avant toute reprise.
