# Migration Rust et TerminusDB — état vérifiable

Le candidat Rust est un service natif Axum/SQLx : il n’exécute pas Python. La référence historique comporte 79 opérations HTTP, 95 outils MCP et 87 schémas. La migration reste partielle ; le candidat ne doit pas encore remplacer le service existant. Le frontend reste inchangé.

## Couverture native actuelle

Vingt-sept opérations HTTP et vingt-sept outils MCP sont implémentés :

| Fonction | HTTP | Outil MCP |
|---|---|---|
| Santé du processus | GET /health | api_system_health |
| Disponibilité du schéma et des protections SQL | GET /ready | api_system_ready |
| Identité et domaines accessibles | GET /v1/me | api_identity_read |
| Versions acceptée et publiée | GET /v1/domains/{domain}/version | api_domain_version |
| Concepts publiés et relations visibles | GET /v1/domains/{domain}/concepts | api_concepts_list |
| Un concept publié | GET /v1/domains/{domain}/concepts/{concept_id} | api_concepts_read |
| Publier une proposition déjà acceptée | POST /v1/domains/{domain}/proposals/{proposal_id}/publish | api_proposals_publish |
| Créer une proposition avec preuves | POST /v1/domains/{domain}/proposals | api_proposals_create |
| Lister les propositions visibles | GET /v1/domains/{domain}/proposals | api_proposals_list |
| Lire une proposition | GET /v1/domains/{domain}/proposals/{proposal_id} | api_proposals_read |
| Comparer avant/après | GET /v1/domains/{domain}/proposals/{ident}/diff | api_proposals_diff |
| Accepter une proposition | POST /v1/domains/{domain}/proposals/{proposal_id}/approve | api_proposals_approve |
| Rejeter, différer, demander des changements ou rouvrir | POST /v1/domains/{domain}/proposals/{ident}/reviews | api_proposals_review |
| Lire le journal des revues | GET /v1/domains/{domain}/proposals/{ident}/reviews | api_proposals_reviews |
| Interroger les connaissances avec citations | POST /v1/domains/{domain}/query | api_knowledge_query |
| Historique personnel des épisodes visibles | GET /v1/domains/{domain}/episodes | api_episodes_list |
| Relire sa réponse et ses citations | GET /v1/domains/{domain}/episodes/{episode_id} | api_episodes_read |
| Évaluer explicitement sa réponse | POST /v1/domains/{domain}/episodes/{episode_id}/feedback | api_episodes_feedback |
| Lire ses préférences de collecte | GET /v1/domains/{domain}/feedback-preferences | api_feedback_preferences |
| Activer ou désactiver sa collecte automatique | PUT /v1/domains/{domain}/feedback-preferences | api_feedback_configure |
| Déclarer un signal lié à son épisode | POST /v1/domains/{domain}/episodes/{episode_id}/signals | api_feedback_record_signal |
| Parcourir ses signaux visibles | GET /v1/domains/{domain}/feedback-signals | api_feedback_signals |
| Résumer ses signaux sur une fenêtre bornée | GET /v1/domains/{domain}/feedback-summary | api_feedback_summary |
| Créer une source textuelle | POST /v1/domains/{domain}/sources | api_sources_create |
| Chercher et paginer les sources accessibles | GET /v1/domains/{domain}/sources | api_sources_list |
| Lire une source et son contenu | GET /v1/domains/{domain}/sources/{source_id} | api_sources_read |
| Parcourir ses extraits déterministes | GET /v1/domains/{domain}/sources/{source_id}/chunks | api_sources_chunks |

Les opérations non portées répondent HTTP501/MIGRATION_NOT_IMPLEMENTED ; elles ne sont pas annoncées comme outils natifs. Les 95 outils de référence restent dans le service Python. Réviser une proposition, les conversations, les réponses de compagnons, les imports de fichiers, les collections et l’administration restent à migrer. `/v1/me` annonce prudemment uniquement `inspect` et aucun fournisseur d’extraction ; ses capacités seront étendues avec les parcours complets.

## Fonctionnement et intégration frontend

Le transport MCP utilise le [SDK officiel Rust](https://github.com/modelcontextprotocol/rust-sdk), rmcp3.2.0 verrouillé dans Cargo.lock. Les schémas, noms et annotations des outils proviennent des contrats historiques. Chaque appel est validé par JSON Schema puis invoque en mémoire la route Rust correspondante. L’identité et le tenant viennent du transport authentifié ; les arguments ne peuvent définir ni rôle, ni URL, ni en-tête d’identité. Les segments de chemin et paramètres de requête sont contrôlés séparément.

Le transport Streamable HTTP est sans session. Toutes les requêtes MCP sont authentifiées. Le candidat local refuse les origines navigateur et les hôtes hors loopback ; corps MCP maximal1Mo, réponse native maximale4Mo. Le frontend peut conserver ses contrats JSON, mais le déploiement distant, CORS, JWKS et la rotation de clés restent à intégrer. La forme détaillée des erreurs422 n’est pas encore entièrement alignée sur Python.

Une source textuelle doit comporter titre, emplacement, contenu et lecteurs membres du domaine. Seuls owner et corpus_manager peuvent la créer. La déduplication utilise emplacement et SHA256 du contenu : les mêmes métadonnées rendent la même source ; des métadonnées différentes produisent409/IDEMPOTENCY_CONFLICT. Les ACL s’appliquent à la création, au rejeu, à la liste et à la lecture. La liste accepte limite, curseur, recherche dans le titre et filtre de collection autorisée. Les extraits utilisent des offsets en points de code Unicode, au plus2000 caractères et6000 octets UTF-8, et un hash de contenu ; un curseur hors frontière est refusé.

La publication conserve `expected_published_version`. Accepter et publier restent deux décisions distinctes. Une confirmation RS256 de l’hôte de confiance est obligatoire, liée à l’identité, au tenant, à l’action et aux arguments exacts. HTTP et MCP partagent une consommation unique en SQL grâce à une preuve interne qui ne peut pas être forgée par un en-tête. Une confirmation utilisée ne peut pas être réutilisée après un échec : inspecter l’état puis obtenir une nouvelle décision signée. Le rejeu d’une cible déjà publiée répond `changed=false`, même si une autre proposition attend.

## Stockage et cohérence

PostgreSQL conserve identité, appartenances, preuves, ACL, propositions, journal et manifestes. Les migrations0019 et0020 ajoutent réservations et manifestes immuables tenant/domaine/version avec RLS forcée, puis l’intention de publication attendue. Le readiness exige la révision0020, les33 tables attendues, leurs protections RLS et un rôle SQL non privilégié.

TerminusDB contient les concepts typés, preuves sous-documents ordonnés et relations vers d’autres concepts. Chaque snapshot utilise une base privée neuve, exige le commit retourné, puis relit ce commit et vérifie digest/nombre de concepts. Les lectures applicatives résolvent exclusivement le manifeste SQL de la version publiée. Elles recontrôlent les droits après l’appel moteur, filtrent les concepts dont une preuve est masquée et leurs relations. Une version publiée supérieure à0 sans manifeste renvoie503 ; la version0 représente le graphe vide ; aucun repli implicite vers la projection SQL. Cette stratégie par snapshot consomme davantage de bases ; son optimisation reste ouverte.

La publication revalide les preuves verbatim et les contraintes du graphe, prépare le snapshot, puis valide dans une seule transaction SQL : manifeste, projection de compatibilité, événement de publication, outbox, statut et version. TerminusDB ne participe pas à cette transaction ; un snapshot préparé seul ne devient jamais visible. Une réservation durable précède chaque mutation moteur.

Après réponse moteur perdue, une nouvelle commande confirmée inspecte uniquement la base réservée et son commit immuable. Si le contenu est complet et identique à l’intention persistée, elle peut finaliser après recontrôle des droits et de la version. Si le contenu est absent, incomplet ou différent, elle renvoie503 sans nouvelle mutation. **La reprise sur une nouvelle base pour les préparations incomplètes et le nettoyage contrôlé des orphelins restent à réaliser.**

Le transport moteur refuse HTTP distant, identifiants dans l’URL, redirections et proxy implicite. Appels et tailles sont bornés. Une mutation avec rupture réseau, erreur5xx ou succès illisible est classée incertaine ; aucune relance aveugle.

## Démarrer le candidat

Toolchain Rust1.98.1, Cargo.lock et `cargo build --workspace --locked`. Le binaire est `target/debug/cortex-rust-core`. Configuration requise : `CORTEX_RUST_DATABASE_URL`, `CORTEX_JWT_PUBLIC_KEY_FILE`, `CORTEX_JWT_ISSUER`, `CORTEX_JWT_AUDIENCE`. Adresse `CORTEX_RUST_BIND`, défaut127.0.0.1:8010. Un rôle PostgreSQL superuser, BYPASSRLS ou propriétaire des tables applicatives est refusé.

Pour le graphe : `CORTEX_TERMINUS_URL`, `CORTEX_TERMINUS_USER`, `CORTEX_TERMINUS_PASSWORD`. Pour les confirmations : `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE` ; le backend ne possède aucune clé privée de confirmation.

La commande interne `cortex-rust-core --import-published <domainUUID>` utilise `CORTEX_MIGRATION_BEARER` et `CORTEX_MIGRATION_TENANT`. Elle exige owner et l’accès à toutes les preuves, copie uniquement la projection déjà publiée et ne constitue ni approbation ni nouvelle publication. Ne pas l’exécuter sur un corpus d’entreprise non autorisé. Une réservation interrompue n’est pas automatiquement relancée.

## Preuves et limites de vérification

- Formatage, Clippy sans avertissement et18 tests Rust passent localement. Le test Terminus réel est explicitement ignoré hors moteur isolé et exécuté séparément en CI.
- Le scénario local HTTP/MCP utilise le vrai binaire, PostgreSQL, clés éphémères et données synthétiques : vingt-quatre routes directement testables sans moteur et vingt-sept schémas/outils MCP annoncés. Les scénarios source contrôlent ACL, rôle, déduplication, pagination et découpe Unicode comparée à Python.
- Le lot sources et pont MCP générique a passé la CI avec le moteur TerminusDB12.0.7 épinglé par digest : onze opérations HTTP/MCP, publication signée, rejeu ciblé et lectures avec droits. Le lot propositions a ensuite validé dix-huit HTTP/MCP et le cycle complet source → création → revue → approbation → publication avec TerminusDB réel. Le lot recherche/feedback a ensuite passé sa CI avec TerminusDB réel, citations et épisodes privés (vingt-deux opérations). Le lot signaux/préférences nécessite encore sa propre CI.
- La suite historique sur la migration0020 passe :514 tests Python et11 Node. Elle protège la référence, sans prouver que ses79 routes ont été portées en Rust.
- Le vérificateur indépendant a exécuté100018 vecteurs de JSON canonique sans divergence après correction Ryu ;2044 cas de changements de graphe concordent avec Python ;23 cas de confirmations concordent. Ses campagnes de concurrence couvrent isolation tenant, révocation, expiration pendant réseau/verrou SQL, publication concurrente et retour arrière atomique après panne SQL injectée.
- Les courses sont déclenchées avec un moteur contrôlé, distinct du test TerminusDB réel. Les NumericDate sous forme de chaînes exotiques restent plus restrictifs que Python. Les autres confirmations personnelles, opérations non portées, performances, haute disponibilité et perte d’accusé de commit PostgreSQL ne sont pas déclarées validées.

Aucun corpus d’entreprise ni appel modèle payant n’est utilisé dans ces campagnes. Les rapports détaillés et contre-exemples indépendants restent dans les livrables locaux.

## Cycle de validation natif — lot en vérification

Un owner, corpus_manager, contributor ou agent peut créer une proposition ; le viewer ne peut pas accéder à la file de propositions. Les changements s’appuient sur le snapshot Terminus publié, avec nouvelle vérification de version, appartenance et preuves après lecture réseau. Le corps conserve uniquement des passages verbatim. Les contraintes de graphe, les preuves des anciennes valeurs et des cibles liées sont conservées dans la validation. La normalisation des UUID, des valeurs par défaut et des empreintes est comparée à Pydantic/Python.

La liste filtre les droits avant pagination et accepte état, source, limite et curseur. Le détail avant/après utilise l’état publié courant pour une proposition non acceptée, ou le before_state immuable du commit accepté. Il indique la base périmée et masque une comparaison dont les preuves ou cibles liées ne sont plus accessibles.

Les revues owner exigent une décision signée, le digest et la révision attendue. Différer augmente la révision et passe à deferred ; rouvrir remet ready ; demander des changements passe à changes_requested ; rejeter rend rejected. Les transitions interdites répondent409 et aucune revue ne publie du savoir. Une approbation exige ready, la révision/digest exacts et une base publiée courante. Une seule approbation peut attendre sa publication : sinon409/PUBLICATION_PENDING. L’approbation crée atomiquement commit, état avant, outbox et version acceptée, sans modifier le manifeste publié.

Les replays de création/revue/approbation contrôlent l’empreinte d’idempotence. Le candidat recontrôle aussi les preuves avant un replay d’approbation, restriction volontaire plus forte que le raccourci historique Python. Le vérificateur indépendant confirme les hashes normalisés, permissions, révisions, signatures et révocation sur données synthétiques ; concurrence et moteur réel complètent cette preuve.

Contre-vérification des décisions : neuf groupes supplémentaires passent avec PostgreSQL réel et moteur contrôlé, dont concurrence des approbations, révocation pendant lecture moteur, comparaisons historiques et cible liée masquée. Un écart de désérialisation des poids flottants explicites (R12) a été corrigé et le script indépendant inchangé confirme le correctif ; une régression HTTP avec lien implicite puis normalisé est conservée dans la CI.

## Interrogation et retours explicites natifs — lot en vérification

L’interrogation lit le snapshot Terminus publié et renvoie uniquement des extraits approuvés, leur version, leurs citations et les relations visibles. Le classement lexical, les mots ignorés, le départage par UUID et les budgets de caractères reprennent Python. Les tables Unicode15.0.0 sont générées avec Python3.12 à la construction des sources puis utilisées directement en Rust, sans processus Python au runtime. Leur régénération est contrôlée en CI. Le vérificateur a comparé les1 112 064 scalaires Unicode à l’oracle, sans divergence.

Une absence de preuve dans le budget donne explicitement `knowledge_gap` et crée un élément de suivi. Chaque interrogation crée un épisode personnel ; même un owner ne lit pas celui d’un autre utilisateur. Les droits sur les sources sont revérifiés avant enregistrement et lors de chaque relecture/liste. Un retour `unhelpful` crée un élément `disputed_answer` ; son rejeu idempotent ne duplique ni feedback ni élément de suivi. Les préférences et signaux observés/inférés sont décrits dans le lot suivant.

La réponse indique `mode=extractive` et `processing=local_no_model`. Ce lot n’ajoute ni synthèse LLM ni appel OpenRouter. La version servie reste celle du snapshot lu, y compris si une nouvelle publication survient ensuite. La revue indépendante couvre classement, budgets Unicode, citations, épisodes privés, concurrence du feedback et révocation pendant lecture moteur, avec PostgreSQL réel et moteur contrôlé.

## Signaux des compagnons et préférences personnelles — lot en vérification

Les signaux déclarent leur origine : explicite (pouces, commentaire, résolution), observée (reformulation, correction, abandon, résolution), ou inférée (estimation de satisfaction). Un signal inféré exige commentaire, confiance bornée et sentiment ; un indice d’itération appartient uniquement aux observations. Le backend contrôle cette déclaration mais ne certifie pas que le compagnon a correctement interprété l’utilisateur.

Les deux collectes automatiques sont désactivées par défaut. Leur modification exige une confirmation signée pour l’utilisateur courant et la révision attendue. Un viewer peut gérer ses propres préférences ; cela ne lui donne aucun droit d’approbation ou publication. Les changements sont sérialisés avec les enregistrements de signaux. Après désactivation, un nouveau signal automatique est refusé ; le rejeu exact d’un reçu existant reste consultable sous les mêmes contrôles d’accès.

Les signaux et synthèses restent personnels. Une référence à une réponse de compagnon doit appartenir au même utilisateur et au même épisode. Un pouce négatif explicite crée un élément de suivi une seule fois. Les signaux inférés négatifs ne sont pas présentés comme une décision explicite.

La synthèse utilise une fenêtre avec fuseau horaire, croissante et limitée à31 jours (30 par défaut), puis filtre les droits avant son plafond de10000 signaux. Au-delà, elle exige une fenêtre plus étroite et ne renvoie aucun total partiel. Elle distingue les compteurs par origine, les épisodes aux pouces contradictoires et les indices d’itération déclarés. Ces indices ne sont pas des mesures du nombre réel de tentatives ; l’absence de signal ne signifie pas satisfaction. Le feedback historique simple est exclu de cette synthèse pour éviter un double comptage.

Le vérificateur indépendant confirme224 cas de validation de provenance face à Pydantic, les confirmations personnelles HTTP/MCP, le maintien du rôleowner pour publier, l’idempotence, les préférencesBIGINT et les références de compagnons privées. Les contre-tests de synthèse passent : filtre conversation propre/autre auteur, fenêtres invalides et31 jours, plafond de10001 signaux refusé sans résultat partiel, puis même fenêtre après révocation des preuves donnant zéro signal visible. Une erreur de colonne du filtre conversation (R13) a été corrigée et le test indépendant confirme le correctif.
