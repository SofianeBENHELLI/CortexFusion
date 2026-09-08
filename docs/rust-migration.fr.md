# Migration Rust et TerminusDB — état vérifiable

Le candidat Rust est un service natif Axum/SQLx : il n’exécute pas Python. La référence historique comporte 79 opérations HTTP, 95 outils MCP et 87 schémas. La migration reste partielle ; le candidat ne doit pas encore remplacer le service existant. Le frontend reste inchangé.

## Couverture native actuelle

Onze opérations HTTP et onze outils MCP sont implémentés :

| Fonction | HTTP | Outil MCP |
|---|---|---|
| Santé du processus | GET /health | api_system_health |
| Disponibilité du schéma et des protections SQL | GET /ready | api_system_ready |
| Identité et domaines accessibles | GET /v1/me | api_identity_read |
| Versions acceptée et publiée | GET /v1/domains/{domain}/version | api_domain_version |
| Concepts publiés et relations visibles | GET /v1/domains/{domain}/concepts | api_concepts_list |
| Un concept publié | GET /v1/domains/{domain}/concepts/{concept_id} | api_concepts_read |
| Publier une proposition déjà acceptée | POST /v1/domains/{domain}/proposals/{proposal_id}/publish | api_proposals_publish |
| Créer une source textuelle | POST /v1/domains/{domain}/sources | api_sources_create |
| Chercher et paginer les sources accessibles | GET /v1/domains/{domain}/sources | api_sources_list |
| Lire une source et son contenu | GET /v1/domains/{domain}/sources/{source_id} | api_sources_read |
| Parcourir ses extraits déterministes | GET /v1/domains/{domain}/sources/{source_id}/chunks | api_sources_chunks |

Les opérations non portées répondent HTTP501/MIGRATION_NOT_IMPLEMENTED ; elles ne sont pas annoncées comme outils natifs. Les 95 outils de référence restent dans le service Python. Proposer, approuver, revoir, interroger le corpus, les conversations, le feedback, les imports de fichiers, les collections et l’administration restent à migrer. `/v1/me` annonce prudemment uniquement `inspect` et aucun fournisseur d’extraction ; ses capacités seront étendues avec les parcours complets.

## Fonctionnement et intégration frontend

Le transport MCP utilise le [SDK officiel Rust](https://github.com/modelcontextprotocol/rust-sdk), rmcp3.2.0 verrouillé dans Cargo.lock. Les schémas, noms et annotations des outils proviennent des contrats historiques. Chaque appel est validé par JSON Schema puis invoque en mémoire la route Rust correspondante. L’identité et le tenant viennent du transport authentifié ; les arguments ne peuvent définir ni rôle, ni URL, ni en-tête d’identité. Les segments de chemin et paramètres de requête sont contrôlés séparément.

Le transport Streamable HTTP est sans session. Toutes les requêtes MCP sont authentifiées. Le candidat local refuse les origines navigateur et les hôtes hors loopback ; corps MCP maximal1Mo, réponse native maximale4Mo. Le frontend peut conserver ses contrats JSON, mais le déploiement distant, CORS, JWKS et la rotation de clés restent à intégrer. La forme détaillée des erreurs422 n’est pas encore entièrement alignée sur Python.

Une source textuelle doit comporter titre, emplacement, contenu et lecteurs membres du domaine. Seuls owner et corpus_manager peuvent la créer. La déduplication utilise emplacement et SHA256 du contenu : les mêmes métadonnées rendent la même source ; des métadonnées différentes produisent409/IDEMPOTENCY_CONFLICT. Les ACL s’appliquent à la création, au rejeu, à la liste et à la lecture. La liste accepte limite, curseur, recherche dans le titre et filtre de collection autorisée. Les extraits utilisent des offsets en points de code Unicode, au plus2000 caractères et6000 octets UTF-8, et un hash de contenu ; un curseur hors frontière est refusé.

La publication conserve `expected_published_version`. Accepter et publier restent deux décisions distinctes. Une confirmation RS256 de l’hôte de confiance est obligatoire, liée à l’identité, au tenant, à l’action et aux arguments exacts. HTTP et MCP partagent une consommation unique en SQL grâce à une preuve interne qui ne peut pas être forgée par un en-tête. Une confirmation utilisée ne peut pas être réutilisée après un échec : inspecter l’état puis obtenir une nouvelle décision signée. Le rejeu d’une cible déjà publiée répond `changed=false`, même si une autre proposition attend.

## Stockage et cohérence

PostgreSQL conserve identité, appartenances, preuves, ACL, propositions, journal et manifestes. Les migrations0019 et0020 ajoutent réservations et manifestes immuables tenant/domaine/version avec RLS forcée, puis l’intention de publication attendue. Le readiness exige la révision0020, les33 tables attendues, leurs protections RLS et un rôle SQL non privilégié.

TerminusDB contient les concepts typés, preuves sous-documents ordonnés et relations vers d’autres concepts. Chaque snapshot utilise une base privée neuve, exige le commit retourné, puis relit ce commit et vérifie digest/nombre de concepts. Les lectures applicatives résolvent exclusivement le manifeste SQL de la version publiée. Elles recontrôlent les droits après l’appel moteur, filtrent les concepts dont une preuve est masquée et leurs relations. Une version sans manifeste renvoie503 ; aucun repli implicite vers la projection SQL. Cette stratégie par snapshot consomme davantage de bases ; son optimisation reste ouverte.

La publication revalide les preuves verbatim et les contraintes du graphe, prépare le snapshot, puis valide dans une seule transaction SQL : manifeste, projection de compatibilité, événement de publication, outbox, statut et version. TerminusDB ne participe pas à cette transaction ; un snapshot préparé seul ne devient jamais visible. Une réservation durable précède chaque mutation moteur.

Après réponse moteur perdue, une nouvelle commande confirmée inspecte uniquement la base réservée et son commit immuable. Si le contenu est complet et identique à l’intention persistée, elle peut finaliser après recontrôle des droits et de la version. Si le contenu est absent, incomplet ou différent, elle renvoie503 sans nouvelle mutation. **La reprise sur une nouvelle base pour les préparations incomplètes et le nettoyage contrôlé des orphelins restent à réaliser.**

Le transport moteur refuse HTTP distant, identifiants dans l’URL, redirections et proxy implicite. Appels et tailles sont bornés. Une mutation avec rupture réseau, erreur5xx ou succès illisible est classée incertaine ; aucune relance aveugle.

## Démarrer le candidat

Toolchain Rust1.98.1, Cargo.lock et `cargo build --workspace --locked`. Le binaire est `target/debug/cortex-rust-core`. Configuration requise : `CORTEX_RUST_DATABASE_URL`, `CORTEX_JWT_PUBLIC_KEY_FILE`, `CORTEX_JWT_ISSUER`, `CORTEX_JWT_AUDIENCE`. Adresse `CORTEX_RUST_BIND`, défaut127.0.0.1:8010. Un rôle PostgreSQL superuser, BYPASSRLS ou propriétaire des tables applicatives est refusé.

Pour le graphe : `CORTEX_TERMINUS_URL`, `CORTEX_TERMINUS_USER`, `CORTEX_TERMINUS_PASSWORD`. Pour les confirmations : `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE` ; le backend ne possède aucune clé privée de confirmation.

La commande interne `cortex-rust-core --import-published <domainUUID>` utilise `CORTEX_MIGRATION_BEARER` et `CORTEX_MIGRATION_TENANT`. Elle exige owner et l’accès à toutes les preuves, copie uniquement la projection déjà publiée et ne constitue ni approbation ni nouvelle publication. Ne pas l’exécuter sur un corpus d’entreprise non autorisé. Une réservation interrompue n’est pas automatiquement relancée.

## Preuves et limites de vérification

- Formatage, Clippy sans avertissement et16 tests Rust passent localement. Le test Terminus réel est explicitement ignoré hors moteur isolé et exécuté séparément en CI.
- Le scénario local HTTP/MCP utilise le vrai binaire, PostgreSQL, clés éphémères et données synthétiques : huit routes directement testables sans moteur et onze schémas/outils MCP annoncés. Les scénarios source contrôlent ACL, rôle, déduplication, pagination et découpe Unicode comparée à Python.
- Le lot précédent de publication a passé la CI avec le moteur TerminusDB12.0.7 épinglé par digest : six opérations HTTP/MCP, publication signée, rejeu ciblé et lectures avec droits. Le nouveau pont MCP et les sources nécessitent leur propre résultat CI avant de considérer cette version vérifiée avec le moteur réel.
- La suite historique sur la migration0020 passe :514 tests Python et11 Node. Elle protège la référence, sans prouver que ses79 routes ont été portées en Rust.
- Le vérificateur indépendant a exécuté100018 vecteurs de JSON canonique sans divergence après correction Ryu ;2044 cas de changements de graphe concordent avec Python ;23 cas de confirmations concordent. Ses campagnes de concurrence couvrent isolation tenant, révocation, expiration pendant réseau/verrou SQL, publication concurrente et retour arrière atomique après panne SQL injectée.
- Les courses sont déclenchées avec un moteur contrôlé, distinct du test TerminusDB réel. Les NumericDate sous forme de chaînes exotiques restent plus restrictifs que Python. Les confirmations personnelles, opérations non portées, performances, haute disponibilité et perte d’accusé de commit PostgreSQL ne sont pas déclarées validées.

Aucun corpus d’entreprise ni appel modèle payant n’est utilisé dans ces campagnes. Les rapports détaillés et contre-exemples indépendants restent dans les livrables locaux.
