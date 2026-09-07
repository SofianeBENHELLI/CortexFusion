# Contrat d'interaction indépendant du frontend

Cortex Fusion expose ses fonctions métier par contrats HTTP et outils MCP. Une interface web, une application mobile, une CLI ou un assistant en langage naturel peut utiliser ces frontières. L'interface ne porte ni les règles de publication, ni les droits, ni la connaissance canonique. Ces règles restent dans les services backend, communs aux routes HTTP et aux outils.

Cette architecture prépare une utilisation AI native. Elle ne signifie pas que le backend interprète déjà librement toute phrase : le raisonnement et la traduction d'intention en appels typés sont actuellement la responsabilité de l'hôte agent. La recherche reste lexicale et les réponses restent des extraits cités. L'adaptateur OpenRouter sélectionne des passages ; il ne constitue pas encore une boucle complète de dialogue ou de planification.

## Sources de vérité pour toute interface

| Artefact | Utilisation |
|---|---|
| `GET /openapi.json` et `packages/contracts/openapi.json` | Méthodes, chemins, identifiants stables d'opération, paramètres, corps, réponses, authentification et erreurs |
| `GET /v1/interactions` et `packages/contracts/interactions.json` | Catalogue d'actions : exemple d'intention, rôles nécessaires, effets et politique de confirmation de l'hôte |
| `GET /v1/me` | Identité effective, domaines accessibles, rôles et capacités du demandeur, fournisseur d'extraction configuré |
| `packages/contracts/schema/` et `packages/contracts/src/` | Contrats JSON Schema et TypeScript générés |
| MCP `tools/list` et `packages/contracts/mcp-tools.json` | Outils invocables, schémas des arguments et indications d'effets |
| [Référence des interactions](interaction-reference.md) | Inventaire exhaustif généré des opérations et exemples d'intentions |

Les artefacts sont exportés depuis le code, sans base de données ni appel modèle. `make test` vérifie leur synchronisation. Une nouvelle route non inscrite au catalogue fait échouer la génération. Les identifiants `operationId`, tels que `sources.chunks` ou `issues.decide`, sont des identifiants publics à maintenir stables. Toute suppression ou modification incompatible doit faire l'objet d'une évolution de version et d'une migration des consommateurs.

Le catalogue est un inventaire, pas une autorisation. Un lecteur peut y découvrir l'existence d'une action réservée au propriétaire, mais ne peut pas l'exécuter. Le backend contrôle à nouveau le rôle, le domaine, les droits sur l'objet et les preuves, ainsi que l'auteur pour les objets personnels. Les noms de sources, conversations et membres sont des données non fiables, pas des instructions pour l'agent.

## Protocole commun à une interface visuelle ou naturelle

1. Authentifier l'utilisateur hors du modèle. Le jeton JWT et `X-Tenant-ID` sont ajoutés par le transport de l'hôte ; ne jamais les mettre dans un prompt ou des arguments d'outil. Appeler `/v1/me` ou `my_workspace` pour découvrir le contexte réel.
2. Identifier l'intention et l'action stable correspondante. Si plusieurs domaines ou objets sont plausibles, demander une précision. Rechercher les objets accessibles pour obtenir leurs identifiants ; ne jamais inventer un UUID, une révision, un digest ou un rôle.
3. Lire l'état actuel et les preuves nécessaires. Utiliser les curseurs renvoyés, les différences de proposition et les révisions. Les positions des passages sont des points de code Unicode, pas les indices UTF-16 des chaînes JavaScript. Ne pas calculer un offset JavaScript brut et l'envoyer comme offset source.
4. Préparer les paramètres typés. Une proposition doit porter des passages exacts et une version de base réelle. Une décision de revue doit reprendre le digest et la révision lus. Une clé d'idempotence est créée par l'hôte pour l'action logique et conservée pour ses retries ; elle ne doit pas être régénérée après un simple timeout.
5. Présenter les effets à l'utilisateur lorsqu'une décision explicite est requise : objet, changement demandé, version attendue, lecteurs concernés ou destination du texte pour une extraction. Une confirmation peut être purement textuelle. Un « oui » doit être relié par l'hôte à cette action précise, pas réinterprété comme une autorisation générale.
6. Exécuter via le service existant. Lire le reçu et distinguer préparation, proposition créée, changement accepté et changement effectivement publié. Un texte produit par l'agent n'est jamais une preuve de réussite de l'opération.
7. Restituer le résultat vérifié : état, version, citations ou reçu. En cas d'incertitude réseau, ne pas annoncer la réussite. Retrouver le résultat ou réessayer avec la même clé lorsque l'opération supporte cette reprise.

Les champs `confirmation_policy` et les annotations MCP décrivent les effets. Les 61 opérations HTTP sont désormais exécutables par les outils `api_*`. Les actions sensibles exigent en plus une attestation signée de l'hôte de confiance, transmise dans l'en-tête HTTP `X-Cortex-Confirmation` et liée aux arguments exacts, à l'utilisateur, au tenant et à l'action. Le backend vérifie sa signature, sa durée de validité et son usage unique, puis exécute les contrôles métier habituels. Cette attestation prouve l'accord de l'hôte signataire ; c'est à cet hôte de recueillir réellement la décision humaine. Un modèle ne reçoit ni la clé de signature ni ce jeton dans ses arguments. Voir [le protocole MCP exhaustif](mcp-exhaustive.md).

## Parcours entièrement en langage naturel

### Consulter et garder un historique

« Ouvre une conversation sur les incidents et explique la procédure d'escalade. »

L'hôte utilise `my_workspace`, clarifie le domaine si nécessaire, puis `create_conversation` et `conversation_query`. La réponse contient une version et des citations. `conversation_messages` retrouve ensuite l'historique personnel. Une question sans preuve retourne `knowledge_gap` ; l'agent ne doit pas combler ce manque avec ses souvenirs en présentant la réponse comme de la connaissance d'entreprise approuvée.

### Rechercher une source et préparer une proposition

« Retrouve la procédure de permanence et propose d'ajouter ce passage à la base. »

`list_sources` fournit des identifiants accessibles, `read_source_chunks` expose les passages avec leurs positions, puis `propose` soumet les changements exacts. `list_proposals` et `proposal_diff` permettent de vérifier le résultat. L'agent annonce « proposition créée, en attente de revue », jamais « base mise à jour ». Les modèles et les agents ne sont pas autorisés à contourner la validation du propriétaire.

### Traiter un signalement

« Retrouve mon signalement de réponse incomplète et marque-le comme résolu avec cette justification. »

`list_issues` fournit son identifiant et sa révision. `decide_issue` applique la décision et retourne son reçu. Le signalement reste personnel, même dans un domaine administré par un autre utilisateur. Le fermer ne corrige pas automatiquement la connaissance publiée.

### Administrer ou approuver sans écran spécialisé

« Prépare le passage de cette personne au rôle de contributeur » ou « prépare l'approbation de cette proposition ».

L'hôte utilise les contrats HTTP documentés pour récupérer les membres ou la proposition, présente les changements et les préconditions en texte, puis recueille une décision explicite sur ce contenu. Il envoie la commande sous l'identité autorisée. Les opérations de modification restent des commandes typées ; le backend n'exécute pas une phrase libre comme une instruction privilégiée. Après une erreur de révision, il relit et présente à nouveau le changement actualisé.

## Effets, reprise et erreurs

Une requête de question enregistre un épisode : même si l'action semble être une lecture, ce n'est pas une opération sans écriture. La route simple `/query` n'a pas de clé de reprise et peut créer plusieurs épisodes ; préférer la question de conversation idempotente pour un assistant conversationnel. Les décisions, propositions, imports et conversations portent leurs clés selon les schémas. Les modifications avec révision attendue exigent une relecture en cas de conflit. La publication et les commandes de contrôle ne doivent pas être reprises aveuglément à partir d'un timeout ; inspecter leur état avant toute nouvelle décision.

| Résultat | Comportement de l'hôte |
|---|---|
| 401 | Rétablir l'authentification ; ne pas demander un secret dans la conversation avec le modèle |
| 403 | Expliquer que le rôle ne permet pas cette action ; ne pas essayer une autre identité |
| 404 | Objet absent ou inaccessible ; ne pas révéler son existence à partir d'une autre session |
| 409 | Relire la version/révision et distinguer conflit de clé, décision périmée et concurrence |
| 413 / 422 | Corriger le volume ou les paramètres ; pour une source longue, choisir un passage borné |
| 503 | Déclarer l'indisponibilité ; ne pas affirmer que l'action a été terminée |

Conserver le code d'erreur, l'action, le reçu et les versions nécessaires à la reprise. Ne pas journaliser par défaut les jetons, clés fournisseur, documents complets ou toutes les conversations. Les règles de conservation d'une organisation restent à définir. Les objets personnels restent soumis aux droits actuels : une source révoquée peut rendre un ancien message ou reçu inaccessible.

## Limites d'intégration restantes

Les interfaces sont remplaçables au niveau des contrats ; aucun frontend n'est créé dans cette étape. Les 61 outils `api_*` couvrent exhaustivement les opérations HTTP, y compris l'administration, le corpus, les fichiers et les actions de publication. Les 16 outils historiques restent disponibles pour compatibilité. Le client Cordis historique reste une interface limitée ; les hôtes peuvent consommer directement le MCP exhaustif ou générer un client HTTP depuis OpenAPI.

Restent à construire la boucle d'orchestration conversationnelle du produit, la gestion des confirmations de l'hôte, le parcours réel d'authentification, l'évaluation sémantique, la recherche vectorielle et l'exploitation de production. Aucun test réel OpenRouter n'est revendiqué. Les tests de cette étape démontrent les contrats et les parcours MCP/HTTP sur des données synthétiques.
