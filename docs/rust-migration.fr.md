# Migration Rust et TerminusDB — état vérifiable

Le candidat Rust est un service natif Axum/SQLx : il n’exécute pas Python. La référence historique comporte 79 opérations HTTP, 95 outils MCP et 87 schémas. Les 79 opérations sont maintenant natives ; sept extensions d’import et de reprise portent la surface à86HTTP/102MCP. Le remplacement du service existant reste à qualifier : la parité de surface ne constitue pas une homologation de production. Le frontend reste inchangé.

## Couverture native actuelle

Quatre-vingt-six opérations HTTP, leurs outils MCP et seize alias de compatibilité (102 outils au total) sont implémentés :

| Fonction | HTTP | Outil MCP |
|---|---|---|
| Santé du processus | GET /health | api_system_health |
| Disponibilité du schéma et des protections SQL | GET /ready | api_system_ready |
| Identité et domaines accessibles | GET /v1/me | api_identity_read |
| Versions acceptée et publiée | GET /v1/domains/{domain}/version | api_domain_version |
| Concepts publiés et relations visibles | GET /v1/domains/{domain}/concepts | api_concepts_list |
| Un concept publié | GET /v1/domains/{domain}/concepts/{concept_id} | api_concepts_read |
| Publier une proposition déjà acceptée | POST /v1/domains/{domain}/proposals/{proposal_id}/publish | api_proposals_publish |
| Inspecter les tentatives de publication | GET /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts | api_proposals_publication_attempts |
| Remplacer une préparation incertaine | POST /v1/domains/{domain}/proposals/{proposal_id}/publication-attempts | api_proposals_retry_publication |
| Lire le journal des tentatives | GET /v1/domains/{domain}/proposals/{proposal_id}/publication-events | api_proposals_publication_events |
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
| Enregistrer une réponse de compagnon | POST /v1/domains/{domain}/episodes/{episode_id}/companion-responses | api_responses_create |
| Relire sa réponse de compagnon | GET /v1/domains/{domain}/companion-responses/{response_id} | api_responses_read |
| Lister ses réponses de compagnons | GET /v1/domains/{domain}/companion-responses | api_responses_list |
| Créer une conversation personnelle | POST /v1/domains/{domain}/conversations | api_conversations_create |
| Lister ses conversations | GET /v1/domains/{domain}/conversations | api_conversations_list |
| Lire sa conversation | GET /v1/domains/{domain}/conversations/{ident} | api_conversations_read |
| Renommer, archiver ou restaurer | PUT /v1/domains/{domain}/conversations/{ident} | api_conversations_update |
| Lire les messages visibles | GET /v1/domains/{domain}/conversations/{ident}/messages | api_conversations_messages |
| Poser une question idempotente, JSON ou SSE | POST /v1/domains/{domain}/conversations/{ident}/query | api_conversations_query |
| Lire la timeline avec réponses et signaux | GET /v1/domains/{domain}/conversations/{ident}/timeline | api_conversations_timeline |
| Lister ses signalements visibles | GET /v1/domains/{domain}/issues | api_issues_list |
| Lire son signalement | GET /v1/domains/{domain}/issues/{ident} | api_issues_read |
| Lire son journal de décisions | GET /v1/domains/{domain}/issues/{ident}/events | api_issues_history |
| Démarrer, résoudre, ignorer ou rouvrir | POST /v1/domains/{domain}/issues/{ident}/decisions | api_issues_decide |
| Créer une collection de corpus | POST /v1/domains/{domain}/collections | api_collections_create |
| Chercher ses collections accessibles | GET /v1/domains/{domain}/collections | api_collections_list |
| Lire une collection accessible | GET /v1/domains/{domain}/collections/{collection_id} | api_collections_read |
| Soumettre un lot de textes à une collection | POST /v1/domains/{domain}/collections/{collection_id}/imports | api_imports_create |
| Lister ses imports visibles | GET /v1/domains/{domain}/imports | api_imports_list |
| Lire la progression de son import | GET /v1/domains/{domain}/imports/{import_id} | api_imports_read |
| Traiter un nombre borné d’éléments | POST /v1/domains/{domain}/imports/{import_id}/process | api_imports_process |
| Annuler les éléments en attente | POST /v1/domains/{domain}/imports/{import_id}/cancel | api_imports_cancel |
| Remettre les échecs en attente | POST /v1/domains/{domain}/imports/{import_id}/retry | api_imports_retry |
| Lister les membres du domaine | GET /v1/domains/{domain}/members | api_members_list |
| Ajouter, modifier ou retirer un membre | POST /v1/domains/{domain}/members | api_members_change |
| Lire le journal des accès | GET /v1/domains/{domain}/membership-events | api_members_history |
| Lire les commits et leur publication | GET /v1/domains/{domain}/commits | api_commits_list |
| Préparer le brief propriétaire | GET /v1/domains/{domain}/brief | api_domain_brief |
| Réviser une proposition et conserver ses preuves | POST /v1/domains/{domain}/proposals/{ident}/revise | api_proposals_revise |
| Proposer le contenu entier d’une source | POST /v1/domains/{domain}/sources/{source_id}/propose | api_sources_propose |
| Modifier les lecteurs d’une source | PUT /v1/domains/{domain}/sources/{source_id}/access | api_sources_access |
| Découvrir les interactions natives | GET /v1/interactions | api_interactions_list |
| Créer une source textuelle | POST /v1/domains/{domain}/sources | api_sources_create |
| Chercher et paginer les sources accessibles | GET /v1/domains/{domain}/sources | api_sources_list |
| Lire une source et son contenu | GET /v1/domains/{domain}/sources/{source_id} | api_sources_read |
| Parcourir ses extraits déterministes | GET /v1/domains/{domain}/sources/{source_id}/chunks | api_sources_chunks |
| Lire ses tentatives d’extraction visibles | GET /v1/domains/{domain}/model-attempts | api_models_attempts |
| Lire une tentative d’extraction | GET /v1/domains/{domain}/model-attempts/{attempt_id} | api_models_attempt |
| Lire les réservations quotidiennes de modèles | GET /v1/domains/{domain}/model-usage | api_models_usage |
| Lire ses tentatives de synthèse visibles | GET /v1/domains/{domain}/syntheses | api_syntheses_list |
| Lire une tentative de synthèse | GET /v1/domains/{domain}/syntheses/{ident} | api_syntheses_read |
| Lire son reçu d’extraction et sa proposition | GET /v1/domains/{domain}/extractions/{ident} | api_extractions_read |
| Publier le prochain commit accepté | POST /v1/domains/{domain}/publish | api_domain_publish |
| Reconstruire la projection publiée vérifiée | POST /v1/domains/{domain}/replay | api_domain_replay |
| Préparer une proposition inverse | POST /v1/domains/{domain}/commits/{sequence}/compensate | api_commits_compensate |
| Déposer un fichier immuable dans une collection | POST /v1/domains/{domain}/collections/{collection}/files | api_files_upload |
| Lister les fichiers accessibles ou à traiter | GET /v1/domains/{domain}/files | api_files_list |
| Lire le reçu de fichier | GET /v1/domains/{domain}/files/{ident} | api_files_read |
| Télécharger les octets originaux | GET /v1/domains/{domain}/files/{ident}/download | api_files_download |
| Traiter un fichier avec bail exclusif | POST /v1/domains/{domain}/files/{ident}/process | api_files_process |
| Remettre un échec en attente | POST /v1/domains/{domain}/files/{ident}/retry | api_files_retry |
| Annuler un traitement non terminé | POST /v1/domains/{domain}/files/{ident}/cancel | api_files_cancel |
| Découvrir la ressource MCP et son autorité d’identité | GET /.well-known/oauth-protected-resource | api_system_mcp_discovery |
| Générer une réponse personnelle strictement citée | POST /v1/domains/{domain}/episodes/{episode_id}/syntheses | api_syntheses_create |
| Sélectionner un passage avec destination explicite | POST /v1/domains/{domain}/sources/{source_id}/extract | api_sources_extract |
| Sélectionner un passage avec Ollama local | POST /v1/domains/{domain}/sources/{source_id}/extract-local | api_sources_extract_local |

Les 79 opérations HTTP et 95 outils historiques sont implémentés en Rust. Les routes inconnues répondent501/MIGRATION_NOT_IMPLEMENTED. Une fonctionnalité non configurée répond par son erreur explicite, par exemple SYNTHESIS_DISABLED, MODEL_DISABLED ou DISCOVERY_DISABLED. Le catalogue décrit les contrats ; /v1/me décrit les capacités courantes. Les rôles rédacteurs reçoivent propose/read_proposals, owner et corpus_manager manage_corpus. Review/approve/manage_members/source_acl et extract sont réservés au propriétaire, avec confirmations configurées ; publish/compensate exigent également TerminusDB. Synthesize est disponible à tous les membres lorsque fournisseur et confirmations sont configurés.

## Fonctionnement et intégration frontend

Le transport MCP utilise le [SDK officiel Rust](https://github.com/modelcontextprotocol/rust-sdk), rmcp3.2.0 verrouillé dans Cargo.lock. Les schémas, noms et annotations des outils proviennent des contrats historiques. Chaque appel est validé par JSON Schema puis invoque en mémoire la route Rust correspondante. L’identité et le tenant viennent du transport authentifié ; les arguments ne peuvent définir ni rôle, ni URL, ni en-tête d’identité. Les segments de chemin et paramètres de requête sont contrôlés séparément.

Le transport Streamable HTTP est sans session. Toutes les requêtes MCP sont authentifiées. Le candidat refuse par défaut les origines navigateur ; une liste exacte CORTEX_CORS_ORIGINS permet de les autoriser pour HTTP et MCP. Les hôtes MCP hors loopback restent refusés sauf l’autorité HTTPS explicitement configurée ; corps MCP maximal1Mo, réponse native maximale4Mo. Le frontend peut conserver ses contrats JSON. La découverte HTTPS est configurable ; la rotation JWKS fixe est implémentée ; le déploiement TLS et l’IdP réel restent à qualifier. La forme détaillée des erreurs422 n’est pas encore entièrement alignée sur Python.

Une source textuelle doit comporter titre, emplacement, contenu et lecteurs membres du domaine. Seuls owner et corpus_manager peuvent la créer. La déduplication utilise emplacement et SHA256 du contenu : les mêmes métadonnées rendent la même source ; des métadonnées différentes produisent409/IDEMPOTENCY_CONFLICT. Les ACL s’appliquent à la création, au rejeu, à la liste et à la lecture. La liste accepte limite, curseur, recherche dans le titre et filtre de collection autorisée. Les extraits utilisent des offsets en points de code Unicode, au plus2000 caractères et6000 octets UTF-8, et un hash de contenu ; un curseur hors frontière est refusé.

La publication conserve `expected_published_version`. Accepter et publier restent deux décisions distinctes. Une confirmation RS256 de l’hôte de confiance est obligatoire, liée à l’identité, au tenant, à l’action et aux arguments exacts. HTTP et MCP partagent une consommation unique en SQL grâce à une preuve interne qui ne peut pas être forgée par un en-tête. Une confirmation utilisée ne peut pas être réutilisée après un échec : inspecter l’état puis obtenir une nouvelle décision signée. Le rejeu d’une cible déjà publiée répond `changed=false`, même si une autre proposition attend.

## Stockage et cohérence

PostgreSQL conserve identité, appartenances, preuves, ACL, propositions, journal et manifestes. Les migrations0019 et0020 ajoutent réservations et manifestes immuables tenant/domaine/version avec RLS forcée, puis l’intention de publication attendue. Le readiness exige la révision 0024 et les 36 tables attendues, leurs protections RLS et un rôle SQL non privilégié.

TerminusDB contient les concepts typés, preuves sous-documents ordonnés et relations vers d’autres concepts. Chaque snapshot utilise une base privée neuve, exige le commit retourné, puis relit ce commit et vérifie digest/nombre de concepts. Les lectures applicatives résolvent exclusivement le manifeste SQL de la version publiée. Elles recontrôlent les droits après l’appel moteur, filtrent les concepts dont une preuve est masquée et leurs relations. Une version publiée supérieure à0 sans manifeste renvoie503 ; la version0 représente le graphe vide ; aucun repli implicite vers la projection SQL. Cette stratégie par snapshot consomme davantage de bases ; son optimisation reste ouverte.

La publication revalide les preuves verbatim et les contraintes du graphe, prépare le snapshot, puis valide dans une seule transaction SQL : manifeste, projection de compatibilité, événement de publication, outbox, statut et version. TerminusDB ne participe pas à cette transaction ; un snapshot préparé seul ne devient jamais visible. Une réservation durable précède chaque mutation moteur.

Après réponse moteur perdue, une nouvelle commande confirmée inspecte uniquement la base réservée et son commit immuable. Si le contenu est complet et identique à l’intention persistée, elle peut finaliser après recontrôle des droits et de la version. Si le contenu est absent, incomplet ou différent, elle renvoie503 sans nouvelle mutation. Le remplacement explicite d’une préparation incomplète est implémenté via une nouvelle tentative confirmée, un UUID/génération et une base privée neuve ; voir les sections Reprise R11 ci-dessous. Le nettoyage contrôlé des bases orphelines reste à réaliser.

Le transport moteur refuse HTTP distant, identifiants dans l’URL, redirections et proxy implicite. Appels et tailles sont bornés. Une mutation avec rupture réseau, erreur5xx ou succès illisible est classée incertaine ; aucune relance aveugle.

## Démarrer le candidat

Le [guide de démarrage et de test Rust](rust-start.fr.md) décrit la préparation SQL, les variables, le bootstrap, les commandes et les différences avec le service historique.

Toolchain Rust1.98.1, Cargo.lock et `cargo build --workspace --locked`. Le binaire est `target/debug/cortex-rust-core`. Configuration requise : `CORTEX_RUST_DATABASE_URL`, exactement une source `CORTEX_JWT_PUBLIC_KEY_FILE` ou `CORTEX_JWKS_URL`, puis `CORTEX_JWT_ISSUER` et `CORTEX_JWT_AUDIENCE`. Adresse `CORTEX_RUST_BIND`, défaut127.0.0.1:8010. Un rôle PostgreSQL superuser, BYPASSRLS ou propriétaire des tables applicatives est refusé.

Pour le graphe : `CORTEX_TERMINUS_URL`, `CORTEX_TERMINUS_USER`, `CORTEX_TERMINUS_PASSWORD`. Pour les confirmations : `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE` ; le backend ne possède aucune clé privée de confirmation.

La commande interne `cortex-rust-core --import-published <domainUUID>` utilise `CORTEX_MIGRATION_BEARER` et `CORTEX_MIGRATION_TENANT`. Elle exige owner et l’accès à toutes les preuves. Elle reconstruit le savoir publié depuis le journal contigu, contrôle sa concordance avec la projection SQL courante et toutes ses preuves, puis importe ou rapproche le snapshot selon la même recette que l’API. Elle n’approuve ni ne publie de nouvelle connaissance. Ne pas l’exécuter sur un corpus d’entreprise non autorisé. Une réservation interrompue n’est pas automatiquement relancée.

## Preuves et limites de vérification

Les compteurs du socle initial ci-dessous sont historiques. Les sections suivantes décrivent les campagnes ajoutées : reprise/import, restauration complète à froid, rotation JWKS et worker corpus. La [mesure réelle de volume](graph-volume.fr.md) qualifie un profil synthétique distinct, sans engagement de capacité de production. Chaque rapport CI est associé à son commit testé.

- Formatage, Clippy sans avertissement et21 tests Rust passent localement. Le test Terminus réel est explicitement ignoré hors moteur isolé et exécuté séparément en CI.
- Le scénario local HTTP/MCP utilise le vrai binaire, PostgreSQL, clés éphémères et données synthétiques :82 opérations directement testables sans moteur,102 outils annoncés, ressources et prompts authentifiés. Les tests vérifient les parcours et contrôles décrits, sans prétendre mesurer une couverture exhaustive de branches.
- Le candidat79 HTTP/95 MCP au commit `ece58a2105340059789a6c62972a424b09cc9e48` a passé les trois workflows. Le [workflow Rust avec TerminusDB réel](https://github.com/SofianeBENHELLI/CortexFusion/actions/runs/34189337046) vérifie publication signée, snapshot immuable, manifeste et droits courants. Les tests OpenRouter/Ollama utilisent des fournisseurs HTTP locaux synthétiques ; aucun modèle réel n’est contacté. Les ressources/prompts ajoutés ensuite ont leur propre vérification native et indépendante.
- La suite historique sur la migration0020 passe :514 tests Python et11 Node. Elle protège la référence, sans prouver que ses79 routes ont été portées en Rust.
- Le vérificateur indépendant a exécuté100018 vecteurs de JSON canonique sans divergence après correction Ryu ;2044 cas de changements de graphe concordent avec Python ;23 cas de confirmations concordent. Ses campagnes de concurrence couvrent isolation tenant, révocation, expiration pendant réseau/verrou SQL, publication concurrente et retour arrière atomique après panne SQL injectée.
- Les courses sont déclenchées avec un moteur contrôlé, distinct du test TerminusDB réel. Les NumericDate sous forme de chaînes exotiques restent plus restrictifs que Python. La capacité de production, la haute disponibilité et la perte d’accusé de commit PostgreSQL ne sont pas déclarées validées. Les mesures synthétiques de volume restent distinctes de ces garanties.

Aucun corpus d’entreprise ni appel modèle payant n’est utilisé dans ces campagnes. Les rapports détaillés et contre-exemples indépendants restent dans les livrables locaux.

## Cycle de validation natif

Un owner, corpus_manager, contributor ou agent peut créer une proposition ; le viewer ne peut pas accéder à la file de propositions. Les changements s’appuient sur le snapshot Terminus publié, avec nouvelle vérification de version, appartenance et preuves après lecture réseau. Le corps conserve uniquement des passages verbatim. Les contraintes de graphe, les preuves des anciennes valeurs et des cibles liées sont conservées dans la validation. La normalisation des UUID, des valeurs par défaut et des empreintes est comparée à Pydantic/Python.

La liste filtre les droits avant pagination et accepte état, source, limite et curseur. Le détail avant/après utilise l’état publié courant pour une proposition non acceptée, ou le before_state immuable du commit accepté. Il indique la base périmée et masque une comparaison dont les preuves ou cibles liées ne sont plus accessibles.

Les revues owner exigent une décision signée, le digest et la révision attendue. Différer augmente la révision et passe à deferred ; rouvrir remet ready ; demander des changements passe à changes_requested ; rejeter rend rejected. Les transitions interdites répondent409 et aucune revue ne publie du savoir. Une approbation exige ready, la révision/digest exacts et une base publiée courante. Une seule approbation peut attendre sa publication : sinon409/PUBLICATION_PENDING. L’approbation crée atomiquement commit, état avant, outbox et version acceptée, sans modifier le manifeste publié.

Les replays de création/revue/approbation contrôlent l’empreinte d’idempotence. Le candidat recontrôle aussi les preuves avant un replay d’approbation, restriction volontaire plus forte que le raccourci historique Python. Le vérificateur indépendant confirme les hashes normalisés, permissions, révisions, signatures et révocation sur données synthétiques ; concurrence et moteur réel complètent cette preuve.

Contre-vérification des décisions : neuf groupes supplémentaires passent avec PostgreSQL réel et moteur contrôlé, dont concurrence des approbations, révocation pendant lecture moteur, comparaisons historiques et cible liée masquée. Un écart de désérialisation des poids flottants explicites (R12) a été corrigé et le script indépendant inchangé confirme le correctif ; une régression HTTP avec lien implicite puis normalisé est conservée dans la CI.

## Interrogation et retours explicites natifs

L’interrogation lit le snapshot Terminus publié et renvoie uniquement des extraits approuvés, leur version, leurs citations et les relations visibles. Le classement lexical, les mots ignorés, le départage par UUID et les budgets de caractères reprennent Python. Les tables Unicode15.0.0 sont générées avec Python3.12 à la construction des sources puis utilisées directement en Rust, sans processus Python au runtime. Leur régénération est contrôlée en CI. Le vérificateur a comparé les1 112 064 scalaires Unicode à l’oracle, sans divergence.

Une absence de preuve dans le budget donne explicitement `knowledge_gap` et crée un élément de suivi. Chaque interrogation crée un épisode personnel ; même un owner ne lit pas celui d’un autre utilisateur. Les droits sur les sources sont revérifiés avant enregistrement et lors de chaque relecture/liste. Un retour `unhelpful` crée un élément `disputed_answer` ; son rejeu idempotent ne duplique ni feedback ni élément de suivi. Les préférences et signaux observés/inférés sont décrits dans le lot suivant.

La réponse indique `mode=extractive` et `processing=local_no_model`. Cette recherche déterministe ne déclenche pas de modèle ; une synthèse distincte peut ensuite être demandée explicitement. La version servie reste celle du snapshot lu, y compris si une nouvelle publication survient ensuite. La revue indépendante couvre classement, budgets Unicode, citations, épisodes privés, concurrence du feedback et révocation pendant lecture moteur, avec PostgreSQL réel et moteur contrôlé.

## Signaux des compagnons et préférences personnelles

Les signaux déclarent leur origine : explicite (pouces, commentaire, résolution), observée (reformulation, correction, abandon, résolution), ou inférée (estimation de satisfaction). Un signal inféré exige commentaire, confiance bornée et sentiment ; un indice d’itération appartient uniquement aux observations. Le backend contrôle cette déclaration mais ne certifie pas que le compagnon a correctement interprété l’utilisateur.

Les deux collectes automatiques sont désactivées par défaut. Leur modification exige une confirmation signée pour l’utilisateur courant et la révision attendue. Un viewer peut gérer ses propres préférences ; cela ne lui donne aucun droit d’approbation ou publication. Les changements sont sérialisés avec les enregistrements de signaux. Après désactivation, un nouveau signal automatique est refusé ; le rejeu exact d’un reçu existant reste consultable sous les mêmes contrôles d’accès.

Les signaux et synthèses restent personnels. Une référence à une réponse de compagnon doit appartenir au même utilisateur et au même épisode. Un pouce négatif explicite crée un élément de suivi une seule fois. Les signaux inférés négatifs ne sont pas présentés comme une décision explicite.

La synthèse utilise une fenêtre avec fuseau horaire, croissante et limitée à31 jours (30 par défaut), puis filtre les droits avant son plafond de10000 signaux. Au-delà, elle exige une fenêtre plus étroite et ne renvoie aucun total partiel. Elle distingue les compteurs par origine, les épisodes aux pouces contradictoires et les indices d’itération déclarés. Ces indices ne sont pas des mesures du nombre réel de tentatives ; l’absence de signal ne signifie pas satisfaction. Le feedback historique simple est exclu de cette synthèse pour éviter un double comptage.

Le vérificateur indépendant confirme224 cas de validation de provenance face à Pydantic, les confirmations personnelles HTTP/MCP, le maintien du rôleowner pour publier, l’idempotence, les préférencesBIGINT et les références de compagnons privées. Les contre-tests de synthèse passent : filtre conversation propre/autre auteur, fenêtres invalides et31 jours, plafond de10001 signaux refusé sans résultat partiel, puis même fenêtre après révocation des preuves donnant zéro signal visible. Une erreur de colonne du filtre conversation (R13) a été corrigée et le test indépendant confirme le correctif.

## Réponses de compagnons natives

Un compagnon peut enregistrer sa réponse personnelle après interrogation : texte, nature (réponse, abstention ou clarification), citations, identifiant du compagnon et modèle déclaré facultatif. Une réponse au corpus doit citer au moins un passage exactement renvoyé dans cet épisode. Une référence étrangère, une sous-plage différente ou un doublon est refusé. Les références sont vérifiées, mais le texte généré n’est pas certifié : `semantic_validation=not_performed` reste explicite et cet enregistrement ne publie aucune connaissance.

Le reçu est immuable et idempotent par utilisateur/domaine/clé. Il reste privé, même vis-à-vis d’un owner, et devient inaccessible si les preuves de l’épisode ne sont plus accessibles. La liste accepte pagination et filtre d’épisode. Les signaux peuvent se rattacher à ce reçu pour distinguer le contexte fourni par CortexFusion de la réponse réellement montrée par le compagnon.

La vérification indépendante couvre180 cas de validation/références face à l’oracle, deux créations concurrentes, rejouabilité HTTP/MCP, confidentialité, pagination et révocation. Le scénario produit relie également recherche, reçu et signal ; la CI moteur réel complète ce lot.

## Conversations, streaming et timeline

Une conversation appartient exclusivement à son auteur. Création et interrogation utilisent des clés d’idempotence ; modifier le titre ou archiver exige la révision attendue. Une conversation archivée refuse les questions, y compris leurs replays, jusqu’à restauration. Épisode et association à la conversation sont enregistrés dans une seule transaction, après recontrôle des droits et de l’archivage.

Pour HTTP, `Accept: text/event-stream` reçoit `started`, puis `result` ou `error`. Les erreurs déjà connues sont renvoyées avant ouverture du flux ; celles survenant ensuite sont des événements structurés. Une égalité de préférence avec JSON conserve JSON. Il n’y a pas de génération token par token ni de reprise par Last-Event-ID : relire l’état ou réutiliser la même clé de question. MCP conserve le résultat JSON final, même si son transport externe utilise SSE.

Les messages ont un curseur de séquence ; la timeline ajoute les reçus de compagnons, signaux et éléments de suivi, avec curseurs enfants. Elle accepte avant/arrière, borne les scans à100 épisodes et la réponse à500000 octets UTF-8. Une page vide avec curseur et scan_limited=true doit être poursuivie. Les données dont les preuves ne sont plus accessibles sont masquées avant pagination ; aucun owner ne reçoit l’historique personnel d’un autre utilisateur.

La vérification indépendante couvre les questions concurrentes, archivage/révocation/expiration pendant lecture moteur, événement started avant libération du moteur, relecture idempotente, directions et curseurs,101 épisodes masqués et refus d’un tour trop volumineux. Les scénarios HTTP/MCP produits passent localement avec PostgreSQL ; le moteur réel est vérifié séparément en CI.

## Traiter ses signalements et organiser le corpus

Un signalement reste personnel à travers son épisode, même pour un owner. Démarrer passe open à in_progress ; résoudre ou ignorer passe open/in_progress à resolved/dismissed ; rouvrir remet resolved/dismissed à open. Une décision exige motif, révision attendue et clé idempotente. L’événement et l’état sont enregistrés atomiquement, sans publication implicite. Un viewer peut traiter ses propres problèmes, sans accéder aux propositions.

Une correction facultative peut accompagner démarrer ou résoudre. Elle exige le droit courant de lire la proposition et ses preuves. Résoudre avec correction exige son statut published et enregistre sa version publiée et son digest. Les corrections rejetées, différées, superseded ou changes_requested sont refusées. Le journal filtre les preuves des corrections avant pagination ; un replay dont la correction est désormais masquée renvoie404. Les révisions sont BIGINT et la concurrence est sérialisée.

Les collections regroupent le corpus : création owner/corpus_manager, lecteurs membres et accès conservé par le créateur. La clé de création porte les arguments normalisés ; changer leur ordre ou leurs doublons change cette empreinte, même si l’ACL enregistrée est triée et dédupliquée. Nom, description et ACL sont immuables dans le modèle actuel ; aucune modification d’ACL de collection n’est annoncée. Lecture et recherche filtrent l’appartenance et les lecteurs ; la recherche utilise lower PostgreSQL, donc ses règles de collation. Les imports textuels associés sont maintenant natifs ; le dépôt et le traitement des fichiers sont maintenant natifs.

## Connexion navigateur locale

Définir par exemple `CORTEX_CORS_ORIGINS='["http://localhost:5173"]'` pour le frontend Vite. La liste contient au plus20 origines canoniques uniques, HTTPS ou HTTP loopback explicite, sans chemin, wildcard, identifiants ni slash final. Par défaut elle est vide. Les origines absentes restent utilisables par les clients API ; une origine présente non autorisée ou répétée est refusée403 avant exécution.

Les prévols OPTIONS sont sans bearer et ne déclenchent aucune action métier. Les requêtes réelles restent authentifiées par Authorization et X-Tenant-ID ; aucune authentification par cookie n’est activée. GET/POST/PUT/DELETE/OPTIONS et les en-têtes de confirmation, idempotence, SSE et MCP sont déclarés. HTTP et MCP partagent la liste, le SDK MCP conserve son contrôle d’hôte loopback et accepte l’autorité publique HTTPS explicitement configurée. Le binaire reste lié à loopback : un déploiement distant ne fait pas partie de ce lot.

## Imports textuels durables

Le lot contient1 à20 éléments textuels, chacun au plus30000 caractères avec nom sans séparateur de chemin et lecteurs inclus dans ceux de la collection. Il est privé au déposant, intersecté avec les droits de collection, les lecteurs originaux et les sources déjà créées. Un owner ne récupère pas l’import personnel d’un corpus_manager.

La création202 enregistre un travail pending, sans lancer un worker ni appeler un modèle. Le client appelle process (1 élément par défaut,20 au plus), puis lit le reçu. Seuls .txt, .md et .markdown sont acceptés au traitement ; un format inexploitable produit un échec explicite par élément. La source, son rattachement à la collection et le succès de l’élément sont atomiques. Une erreur SQL inattendue annule toute la requête et laisse les éléments en attente, ce que confirme une injection indépendante sur le deuxième élément.

Retry remet uniquement les éléments failed en pending. Cancel annule uniquement les éléments encore pending et conserve les sources réussies ; un lot terminé reste terminé. Un lot annulé refuse process/retry409. Les tentatives ne sont incrémentées que pour les traitements enregistrés. Le rejeu de création retourne la progression courante sous les mêmes contrôles d’accès.

## Gouvernance et brief

Le propriétaire peut paginer les membres et le journal d’accès. Une modification de membre exige une confirmation signée exacte, un motif, une clé idempotente et la révision attendue (null pour une nouvelle appartenance). Supprimer puis réajouter un membre ne remet pas sa révision à zéro : le journal empêche une ancienne commande de correspondre à la nouvelle appartenance. Le dernier owner ne peut être retiré ou rétrogradé. La modification et son reçu sont atomiques, avec invalidation des anciens snapshots de droits.

Le journal des commits est réservé au propriétaire et filtre les preuves avant pagination. Il distingue commit accepté et publication effective, avec auteur de publication et date lorsqu’ils existent. Le brief retourne les propositions ready visibles, les versions et uniquement les problèmes personnels du propriétaire ; il ne révèle pas l’activité privée des autres utilisateurs et ne fait aucun appel modèle.

Pour un prévol demandant une méthode ou un en-tête interdit, le middleware CORS peut répondre200 sans l’autorisation correspondante : le navigateur bloque alors la requête réelle. Cela diffère du403 explicite sur une origine interdite. La configuration d’origine est validée avant l’annonce d’écoute du candidat.

## Réviser et proposer depuis une source

L’auteur ou un owner peut réviser une proposition ready, deferred ou changes_requested. Une nouvelle proposition est créée avec replaces_id ; l’ancienne devient superseded et sa révision de revue augmente, dans la même transaction. La nouvelle validation conserve les preuves anciennes et nouvelles. Le replay exact retourne la même proposition ; une clé appartenant à une autre opération ou à un autre parent est refusée. Les droits et la base publiée sont revérifiés après la lecture Terminus.

Proposer une source utilise son texte entier, au plus30000 points de code Unicode, sans appel modèle. L’identifiant du concept est déterministe et compatible UUIDv5 Python ; la source et sa plage entière restent les preuves. Le header Idempotency-Key permet de retrouver la base historique lors d’un replay après publication. Ce parcours ne remplace pas une extraction intelligente et n’accepte aucune preuve inaccessible.

Les ACL de source sont modifiables par un owner possédant déjà l’accès, avec confirmation signée sur les lecteurs exacts. La liste enregistrée est triée et dédupliquée, tous les lecteurs doivent être membres. Retirer son propre accès est permis, mais une relecture ou nouvelle commande ultérieure peut répondre404. Les questions/conversations en cours revérifient ces droits après le réseau : la campagne indépendante utilise la véritable route signée pour prouver ce comportement.

## Découverte des contrats et outils de compatibilité

`/v1/interactions` est authentifié et liste exclusivement les opérations natives ; `/openapi.json` expose leurs schémas publics. Les métadonnées ne donnent aucun droit. Les16 alias historiques restent disponibles : query, inspect_concept, propose, feedback, describe_actions, my_workspace, list_sources, read_source_chunks, list_proposals, proposal_diff, list_conversations, create_conversation, conversation_query, conversation_messages, list_issues et decide_issue.

Les alias conservent leurs arguments, schémas et annotations historiques, puis appellent les mêmes routes Rust. Leur succès retourne directement les données métier ; les outils api_* utilisent l’enveloppe http_status/data. Les propriétés supplémentaires permises par certains anciens schémas ne changent jamais le tenant ou le sujet authentifié. Aucun alias ne contourne une décision signée. Les95 outils de référence sont désormais annoncés.

## Reçus de modèles et consommation

Les propriétaires lisent leurs tentatives d’extraction et les utilisateurs leurs propres tentatives de synthèse, toujours sous les droits courants des preuves. Une tentative sans résultat demeure unresolved ; aucune réussite n’est inventée. Les reçus conservent fournisseur, modèle demandé, plages, hash, dates et usage disponibles ; les anciens champs absents restent null ou leur valeur historique. Aucun de ces chemins ne déclenche de modèle.

Le compteur propriétaire agrège les réservations du domaine sur le jour UTC courant, tous auteurs confondus : tentatives d’extraction et synthèses avec budget réservé. Le plafond CORTEX_MODEL_DAILY_ATTEMPT_LIMIT vaut100 par défaut (1 à100000). Ce compteur décrit des tentatives, pas une dépense en dollars ni le plafond OpenRouter. Les synthèses gratuites et jours précédents sont exclus, les réservations des preuves révoquées restent comptées.

## Maintenance signée du savoir

Publier au niveau domaine sélectionne le prochain commit accepté et conserve cette cible pendant le traitement. Sans changement en attente, changed=false. La reconstruction lit le snapshot Terminus immuable, compare son contenu au journal SQL reconstruit, puis remplace atomiquement la projection après recontrôle de la version et des droits. Une divergence retourne503 sans effacer la projection ; une publication concurrente retourne409. Ce mécanisme ne répare pas une préparation Terminus incomplète ; la commande explicite de reprise décrite plus bas remplit ce rôle.

Compenser un commit publié crée une proposition inverse ready, sans l’accepter ni la publier. Une publication en attente, un changement dépendant ultérieur ou des preuves inaccessibles bloquent la création. Les permissions owner sont revérifiées après lecture réseau, même si l’utilisateur conserve un rôle contributeur. Confirmation signée, base attendue, motif et clé idempotente restent obligatoires.

La campagne indépendante couvre les historiques privés et quotas, une reconstruction réparatrice, une divergence moteur, un rollback SQL injecté après suppression, une publication concurrente pendant lecture, des révocations owner et la compensation idempotente. Les scénarios locaux utilisent PostgreSQL et un moteur contrôlé ; la CI vérifie séparément TerminusDB réel.

## Fichiers et traitement documentaire natifs

Le dépôt202 conserve1 à500000 octets immuables reçus en base64, un nom de fichier sans séparateur ni caractère de contrôle et une ACL incluse dans la collection avec le déposant. La clé idempotente est personnelle, mais les fichiers sont partagés avec leurs lecteurs autorisés : un fichier n’est pas un historique de conversation. Collection, appartenance et éventuelle source produite restent vérifiées à chaque lecture, téléchargement, traitement et replay. Les limites base64 sont comparées au runtime Python de référence ;350 cas indépendants passent après correction d’un padding excédentaire.

HTTP télécharge application/octet-stream, attachment/source.bin, nosniff et no-store. MCP conserve l’enveloppe historique data.media_type/data.base64. La pagination filtre les droits avant limite ; pending=true inclut les jobs pending et processing dont le bail a expiré.

Process acquiert un bail de60 secondes et incrémente les tentatives avant de lancer un processus Rust séparé. Le processus lit les octets sur stdin, sans héritage des variables de base de données ou de fournisseur, sans ouvrir de chemin documentaire, macro ni URL. Limites :500000 octets,15 secondes murales,10 secondes CPU POSIX et512MiB de mémoire virtuelle sur Linux. Le résultat est borné à4Mo. Le processus est tué si son attente est abandonnée. Deux traitements au plus sont simultanés par processus serveur ; au-delà FILE_BUSY/503 est renvoyé avant réservation de bail ou incrément de tentative. Cette limite globale ne constitue pas encore un ordonnanceur équitable par tenant.

TXT/Markdown acceptent UTF-8 et un BOM initial. PDF utilise pdf-extract0.12, refuse le chiffrement et plus de100 pages ; DOCX utilise zip8.6 et roxmltree0.21, limite2000 entrées/8Mo décompressés/ratio200 et refuse DTD/ENTITY. Aucun OCR n’est fourni. Les espaces et offsets du texte extrait PDF peuvent différer de pypdf : les citations portent sur la source réellement créée, jamais sur une équivalence inventée entre parseurs. Le XML DOCX accepte UTF-8 et UTF-16 LE/BE avec BOM ou déclaration. UTF-16 sans ces deux marqueurs et ISO8859-1 restent refusés ; les autres encodages restent à qualifier.

Les extraits sont limités à30000 points de code Unicode avec repères section/page/paragraphe. Fichier vide, encodage invalide, format inexploitable, XML dangereux ou texte trop grand produisent un reçu failed explicite, sans source partielle. Retry remet uniquement failed en pending ; cancel annule pending/processing et invalide son bail. Succeeded/failed sont des résultats terminaux lors d’un nouveau process. Le client peut piloter process puis relire le reçu ; le worker corpus Rust optionnel orchestre ces mêmes opérations sous une identité explicitement configurée.

Après parsing, droits et bail sont revérifiés. Source, rattachement à la collection et reçu sont atomiques ; une erreur SQL inattendue conserve le bail durable pour une reprise après expiration, sans source orpheline. La campagne indépendante injecte une erreur de reçu, vérifie le rollback puis la reprise ; elle distingue le moteur documentaire réel du moteur Terminus contrôlé.

Références des composants : [pdf-extract](https://docs.rs/pdf-extract/0.12.0/pdf_extract/), [ZipArchive](https://docs.rs/zip/8.6.0/zip/struct.ZipArchive.html), [roxmltree](https://docs.rs/roxmltree/0.21.1/roxmltree/). Les limites du processus sont appliquées par CortexFusion en plus des bibliothèques.

## Découverte OAuth et connexion des compagnons

Sans CORTEX_MCP_PUBLIC_URL, la découverte publique retourne404/DISCOVERY_DISABLED. Avec cette option, elle exige une URL HTTPS canonique terminée par /mcp/, un issuer HTTPS sans identifiants/query/fragment et un JWT audience exactement égal à la ressource. Les métadonnées donnent l’URL de ressource, l’autorité d’identité, bearer_methods_supported=header et le nom Cortex Fusion ; elles n’émettent aucun jeton.

Les401 HTTP et MCP incluent alors WWW-Authenticate avec resource_metadata. L’origine HTTPS configurée est autorisée, ainsi que son autorité MCP exacte ; un autre port, un hôte trompeur ou plusieurs Host sont refusés. Les autres origines restent soumises à CORTEX_CORS_ORIGINS. Le processus reste lié à loopback et vérifie une clé PEM ou une source JWKS fixe : les tests locaux ne prouvent ni déploiement TLS distant ni interopérabilité avec un fournisseur d’identité réel. Les outils de découverte MCP eux-mêmes restent derrière l’authentification du transport.

## Synthèse native avec reçu personnel

CORTEX_SYNTHESIS_ENABLED=true, CORTEX_OPENROUTER_MODEL et une clé côté serveur activent la synthèse. Une décision signée syntheses.create lie exactement épisode, destination et clé idempotente, pour l’utilisateur courant. Elle ne donne aucun droit propriétaire. Avant appel, l’épisode et ses preuves doivent être accessibles ; une réservation personnelle durable et le quota quotidien partagé sont enregistrés. Un épisode sans citations produit une abstention déterministe, sans appel fournisseur ni réservation payante.

Le client utilise l’endpoint OpenRouter fixe, sans proxy hérité, redirection ni retry automatique. La requête est bornée à25000 octets selon le budget historique, la réponse à65536 octets et45 secondes. Le payload, le prompt cité et le schéma restent comparés à la référence Python. L’attribution modèle/requête, le coût non négatif, les compteurs et les indices cités sont validés. Les marqueurs [N] doivent correspondre exactement aux indices uniques des preuves. Le reçu conserve semantic_validation=not_performed : vérifier les références ne certifie pas toutes les affirmations du modèle.

Après appel, expiration JWT, appartenance et ACL des preuves sont revérifiées. Réponse de compagnon et résultat succeeded sont atomiques. Une sortie invalide, un refus fournisseur ou un stockage échoué produit un résultat failed sûr si son enregistrement est possible ; une double incertitude SQL retourne SYNTHESIS_STORAGE_UNCERTAIN. Un replay retourne le reçu, éventuellement unresolved, sans rappeler le fournisseur. Ne pas créer automatiquement une nouvelle clé après une erreur. Une nouvelle confirmation signée reste nécessaire pour chaque commande, y compris un replay ; une simple lecture du reçu ne la demande pas.

## Extraction native OpenRouter et Ollama

CORTEX_MODEL_PROVIDER vaut openrouter ou ollama. OpenRouter utilise le modèle et la clé serveur ; Ollama utilise CORTEX_LOCAL_MODEL et CORTEX_OLLAMA_URL, limité à une origine HTTP sur IP loopback. La destination est explicite dans la commande, ou allow_local_processing=true pour l’ancienne route locale. Une destination différente de la configuration est refusée avant appel.

L’extraction propriétaire signée sélectionne un passage exact, au plus2000 points de code, dans une source ou plage d’au plus6000 octets UTF-8. Ollama doit annoncer le modèle installé avec un digest SHA256 valide. La réservation durable précède toute génération ; un seul extracteur par processus est actif. Une clé ayant déjà une tentative sans reçu réussi retourne MODEL_ATTEMPT_RECORDED et ne déclenche aucun nouvel appel.

Les offsets sont recalés sur la source originale et l’identifiant UUIDv5 reste compatible avec la référence. Proposition ready, reçu d’extraction et succès de tentative sont enregistrés dans une transaction unique après recontrôle owner, preuves et version publiée. Aucune acceptation ni publication implicite n’a lieu. Une publication concurrente peut imposer STALE_BASE après l’appel ; le résultat de tentative demeure consultable. Les échecs connus sont appendus à leur tentative d’origine, même si les droits ont été retirés, sans exposer les données désormais masquées.

Les essais de cette migration utilisent exclusivement des réponses OpenRouter/Ollama simulées sur loopback : zéro appel payant et aucune donnée d’entreprise. Le point d’injection de fournisseur synthétique n’existe que dans les builds debug, exige la clé fixe synthetic-test-key et une URL sur IP loopback ; un build release refuse sa configuration. Il ne faut pas confondre ces tests de contrats avec une évaluation du modèle réel.


## Ressources et prompts MCP natifs

En plus des95 outils historiques, le serveur expose trois ressources fixes : `cortex://guide` explique les règles d’usage ; `cortex://workspace` décrit l’identité et ses domaines accessibles ; `cortex://actions` décrit les86 interactions. Le modèle de ressource `cortex://domains/{domain_id}/context` fournit versions et préférences personnelles de feedback. Ces lectures sont authentifiées, recontrôlent les accès et n’importent aucun fichier ou URL arbitraire.

Trois prompts conservent les noms et arguments historiques : `ask_cortex(domain_id, question)`, `review_cortex_proposal(domain_id, proposal_id)` et `report_cortex_feedback(domain_id, episode_id)`. Ils préparent un parcours choisi par l’utilisateur sans exécuter la question, la revue ou le signal. Une revue exige l’accès à la proposition ; le feedback exige l’épisode personnel courant. Une instruction contenue dans la question demeure une donnée du prompt ; cela ne constitue pas une preuve du comportement futur d’un LLM connecté.

Les métadonnées et le guide sont générés depuis la référence Python et contrôlés en CI. La contre-vérification indépendante couvre les3 ressources, le template, les3 prompts, les arguments/URI/curseurs invalides, la séparation des identités, les révocations et l’absence de mutation ou d’appel modèle.


## Contrôle final de l’identité après attente SQL

La vérification indépendante a détecté une lecture de version qui conservait un jeton expiré pendant l’attente du pool SQL. Les transactions recontrôlent maintenant l’expiration après acquisition de connexion, et la route version avant et après son commit de lecture. Le même contre-test indépendant reçoit401 après correctif. Une régression produit sature uniquement les dix connexions de son processus de test, attend l’expiration puis exige le refus ; elle ne modifie aucune configuration globale PostgreSQL.


## Reprise R11 — socle de protection des tentatives

Les migrations0021/0022 introduisent un journal immuable de tentatives et d’événements, un UUID/génération actifs et un manifeste lié à cette identité. Le transfert des réservations historiques vérifie leurs liens et, quand l’intention est connue, leur digest/nombre de concepts ; il ne contacte pas le moteur. Une incohérence interrompt la migration transactionnelle.

Un domaine enrôlé dans le protocole Terminus possède aussi un marqueur persistant sur sa ligne SQL. Cela bloque les anciens publishers Python, y compris si leur transaction REPEATABLE READ précède l’enrôlement. Les domaines Python non enrôlés continuent leur fonctionnement historique. Un domaine avec import ancien incomplet peut être enrôlé mais indisponible ; ce marqueur ne prouve pas que son import est terminé. Aucun retour implicite vers une publication Python n’est autorisé.

Le backend Rust fournit des preuves transactionnelles contenant l’UUID, la génération et l’acteur courant lors des changements de préparation. Le moteur SQL vérifie ces valeurs contre la tentative active ; un ancien manifeste sans identité explicite est refusé. L’identité et l’intention des tentatives sont immuables, et les changements de préparation ajoutent leurs événements. Les nouvelles importations scellent leur propre intention et peuvent rapprocher un snapshot complet par lecture ; les anciennes importations sans intention demeurent bloquées.

Les tests indépendants ont reproduit une publication Python sans manifeste sous REPEATABLE READ avant0022, puis ont confirmé40001 et aucune publication après correction. Les anciens binaires sans identité de tentative explicite sont refusés. Le test historique de version sans manifeste reste exercé avant enrôlement ; après enrôlement, SQL refuse de fabriquer cet état.

## Reprise R11 — commande HTTP/MCP et reçus

Les trois [extensions natives](rust-extensions.fr.md) complètent les contrats historiques sans inventer de routes dans le serveur Python. Le générateur exporte OpenAPI, inventaire d’interactions, outils MCP, descriptions françaises, six schémas JSON autonomes et les types TypeScript associés. Le serveur fusionne ces extensions dans sa découverte. Leurs droits et la confirmation sont appliqués par les mêmes services natifs pour HTTP et MCP.

Une reprise exige le propriétaire actuel, ses preuves courantes, la version publiée et l’UUID/génération à remplacer. Le moteur est d’abord lu : une préparation complète donne409/PUBLICATION_READY_TO_RECONCILE et doit passer par la publication normale. Sinon une nouvelle tentative conserve exactement l’intention scellée, pointe vers sa précédente, porte sa propre raison et sa clé personnelle. Elle est réservée en SQL avant toute création de base Terminus. Une réponse de commit SQL incertaine ne déclenche pas de POST moteur dans ce processus.

Seul l’appel qui a confirmé la nouvelle réservation peut préparer sa nouvelle base. Tout rejeu de la même clé utilise des lectures, jamais un second POST. La finalisation recontrôle UUID/génération, version, identité et preuves ; l’ancien worker ne peut ni activer son manifeste ni dégrader l’état de son remplaçant. Le reçu201 distingue published, unresolved et superseded. Un nouveau motif ou cible sous la même clé est refusé. Une clé ne constitue jamais une preuve d’autorisation.

Les tentatives et événements sont paginés. La migration0023 ajoute un ordinal interne aux événements pour ordonner les ajouts sans dépendre des variations de l’horloge ; le curseur public reste un UUID filtré par tenant, domaine et proposition. Le transfert des événements existants conserve un ordre déterministe par génération/date/UUID. Les événements n’attestent pas qu’un ancien appel moteur a fini. Aucun mécanisme de suppression des bases abandonnées n’est ajouté.

Validation locale de ce lot : vrai binaire Rust et PostgreSQL restreint, moteur HTTP contrôlé pour pertes d’accusés Terminus. Les scénarios produit couvrent6 groupes, dont parcours source→proposition→approbation→reprise, parité HTTP/MCP, schémas de reçus, pagination, clé rejouée, accès perdu et préparation complète/incomplète. Le vérificateur indépendant ajoute9 groupes avec clés concurrentes, ancienne génération retardée et retrait des droits/expiration pendant traitement. Les tests avec TerminusDB réel sont exécutés séparément en CI. La perte d’accusé de COMMIT PostgreSQL n’a pas encore été reproduite ; ne pas la confondre avec les pertes d’accusés moteur injectées. L’import historique sans intention scellée est désormais pris en charge par le remplacement explicite de génération décrit sous migration 0024. La restauration complète à froid est qualifiée séparément ; la restauration sélective bundle/unbundle et la sauvegarde à chaud restent non qualifiées.


## Import historique : projection SQL stable avant activation

Une réparation de la projection depuis le journal peut modifier `cf_concepts` sans augmenter `published_version`. La CLI d’import relit maintenant le contenu SQL sous verrou après le traitement moteur et compare son digest/nombre de concepts à l’intention initialement scellée. Une divergence marque la tentative `stale`, retourne `GRAPH_IMPORT_STATE_CHANGED` et ne crée aucun manifeste. Elle ne restaure pas silencieusement la projection ni ne modifie l’intention enregistrée.

Le vérificateur indépendant a reproduit le défaut sur le vrai exécutableca976466 avec `KnowledgeService.replay` pendant l’import : ancien contenu activé alors que SQL était réparé. Le même scénario est refusé après correction, sans manifeste et sans régression de version. Une régression produit injecte la réparation après écriture du contenu moteur ; elle est également exécutée devant le moteur réel en CI.

Le [lot de repriseca976466](https://github.com/SofianeBENHELLI/CortexFusion/actions/runs/34202501755) a validé103 contrôles avec TerminusDB réel,82HTTP/98MCP, avant ce correctif supplémentaire de stabilité d’import. Le test de mise à niveau indépendant0020→0023 a aussi confirmé le refus de l’ancien worker déjà en cours, la conservation exacte d’un manifeste historique et la reprise par le nouveau runtime.

## Import initial et reprise explicite — migration0024

Quatre opérations natives complètent la reprise de publication : importer/rapprocher une version publiée, lire ses tentatives d’import, confirmer une nouvelle tentative et lire ses événements. La spécification générée décrit désormais sept extensions et98 schémas/types au total. Les quatre opérations restent réservées au propriétaire avec accès actuel à toutes les preuves du graphe cible.

L’import reconstruit la version depuis la séquence contiguë du journal, contrôle les extraits exacts des sources, les relations et leur absence de cycle structurel, puis compare l’identité de la projection SQL. Une divergence est refusée avant toute écriture moteur. Après l’entrée/sortie TerminusDB, la version, les preuves, la projection et la tentative active sont contrôlées à nouveau. L’import ne produit aucune approbation, publication métier ou avance de version. Un manifeste déjà enregistré n’est pas réécrit.

La migration0024 permet un changement contrôlé d’intention uniquement lors du remplacement explicite d’un import encore sans manifeste à la version publiée courante. La nouvelle empreinte est confirmée dans la commande ; une génération supplémentaire et une nouvelle base privée sont obligatoires. L’intention de chaque ancienne tentative reste immuable. Cette exception couvre les préparations historiques sans intention scellée ainsi que les anciennes projections corrigées depuis le journal. Elle ne permet pas de transformer une publication en import ni de remplacer un import historique après avance de version.

Les reçus sont `registered`, `unresolved` ou `superseded`. Une même clé personnelle de reprise identifie une décision durable ; son rejeu ne recrée jamais la base. Un ancien contenu identique déjà complet se rapproche par l’action normale. La pagination des événements utilise l’ordinal interne0023, avec filtre propre au domaine/version et aux tentatives d’import. Le diagnostic de présence du manifeste ne remplace pas un test de disponibilité du moteur.

Le verrou de domaine précède ceux des tentatives dans les services natifs. Les triggers complètent ce protocole ; ils ne constituent pas une API indépendante permettant à d’autres writers SQL d’ignorer cet ordre de verrouillage.

## Drainage du processus sur SIGTERM et SIGINT

L’ancien candidat n’attendait que Ctrl-C et se terminait immédiatement sur SIGTERM. Le runtime installe maintenant les deux gestionnaires avant d’annoncer son écoute. Au premier signal, Axum ferme les connexions à de nouvelles requêtes et draine celles déjà acceptées. Le délai configurable `CORTEX_SHUTDOWN_GRACE_SECONDS` est borné1..300s,75par défaut. Un deuxième signal ou une grâce dépassée provoque une sortie non nulle ; les reçus durables restent la référence pour la reprise.

Cette mécanique n’accorde aucun droit supplémentaire et ne publie aucun état au titre de l’arrêt. Une preuve révoquée ou un JWT expiré pendant le drainage reste refusé. Une préparation réservée avant coupure conserve son identité ; au redémarrage, son rapprochement utilise les lectures moteur existantes. La fin du drainage HTTP ne constitue pas une garantie de sauvegarde à chaud des deux bases.


## Exploitation : restauration et identité tournante

La [qualification de restauration complète à froid](coordinated-restore.fr.md) a passé le [workflow du lot84409aa](https://github.com/SofianeBENHELLI/CortexFusion/actions/runs/34209906671) : trois manifestes, commits et schémas d’origine relus après restauration PostgreSQL et store TerminusDB intégral dans des cibles neuves. Les ACL, citations, reprises sans POST et refus d’un graphe courant absent sont vérifiés. Le mode bundle/unbundle reste distinct et non qualifié.

L’identité native accepte désormais une [source JWKS fixe](jwks-rotation.fr.md), avec rafraîchissement borné, expiration monotone du cache et contrôle de génération de clé dans les requêtes en cours. Le mode PEM conserve sa sémantique. Aucun jeton ne peut choisir une URL ni provoquer un fetch ; HTTP et MCP partagent ces contrôles. Cette évolution ne modifie pas les 86 routes, 102 outils et 98 schémas/types. Les preuves du fournisseur réel, du TLS et de la haute disponibilité restent à construire.


## Worker corpus natif distinct

Le binaire `cortex-corpus-worker` orchestre les lectures et traitements de fichiers/imports via HTTP sous un sujet, tenant et domaine fixes. Il ne reçoit aucun accès SQL ou moteur et ne construit pas d’identité interne. Les appels existants restent exposés en MCP ; aucun contrat métier supplémentaire n’est ajouté. Pagination, durée, nombre de POST et arrêt sont bornés. Les erreurs de traitement terminales ne sont pas répétées ; les résultats incertains arrêtent le processus. Voir le [guide fonctionnel et opérateur](corpus-worker.fr.md).
