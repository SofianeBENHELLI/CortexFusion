# Démarrer et tester le backend Rust

Ce guide concerne le candidat Rust, ses86 opérations HTTP et102 outils MCP. Le serveur et l’analyse de documents sont natifs. PostgreSQL conserve les identités, droits, preuves et reçus ; TerminusDB fournit les snapshots de connaissance publiés. Les migrations SQL, le bootstrap et les outils de vérification utilisent encore Python. Le service Python reste présent comme référence de compatibilité.

Les trois extensions natives de reprise sont décrites dans la [référence française dédiée](rust-extensions.fr.md). Les schémas JSON et types TypeScript `GraphPublication*` sont générés avec les autres contrats.

## Préparer un environnement isolé

Exécuter les commandes depuis la racine du dépôt. Prérequis : Rust1.98.1 et Cargo, Python3.12 avec uv0.12.10, PostgreSQL17.11. Node24/pnpm10.15.1 servent seulement aux vérifications des contrats et du client TypeScript. Docker est une option pour les bases ; le serveur Rust ne dépend pas de Docker.

Suivre la préparation PostgreSQL du [guide de développement](development.md) : base dédiée `cortex_test`, rôle de migration distinct et rôle applicatif `cortex_app` avec `NOSUPERUSER NOBYPASSRLS`, non propriétaire des tables. Le serveur refuse un rôle trop privilégié. `.env.example` n’est pas chargé automatiquement ; exporter les paramètres utiles dans le processus. Ne pas utiliser les mots de passe d’exemple sur un service exposé.

```sh
uv sync --locked
uv run alembic upgrade head
cargo build --workspace --locked
```

Alembic attend `CORTEX_MIGRATION_DATABASE_URL`, au format SQLAlchemy `postgresql+pg8000://…`. Le schéma attendu est la migration0024, avec36 tables applicatives. Rust attend séparément `CORTEX_RUST_DATABASE_URL`, au format SQLx `postgresql://cortex_app:…@127.0.0.1:55432/cortex_test`. Les deux URL désignent la même base avec des identités différentes. Les mots de passe doivent être encodés dans les URL.

Le test automatisé crée ses propres tenants, membres et clés éphémères. Pour une session manuelle persistante, créer le domaine avec le bootstrap existant, muni de l’identité de migration :

```sh
uv run cortex bootstrap --tenant UUID_TENANT --domain UUID_DOMAINE --owner SUJET_IDP
```

Remplacer les paramètres par des UUID réels et le `sub` fourni par l’IdP. Ce bootstrap ne connecte pas l’utilisateur et ne fabrique pas un jeton d’identité. Aucun endpoint de création globale de tenant ou d’invitation n’est fourni.

## Configurer puis lancer le serveur

| Variable | Rôle |
|---|---|
| `CORTEX_RUST_DATABASE_URL` | Connexion du rôle PostgreSQL applicatif restreint. |
| `CORTEX_JWT_PUBLIC_KEY_FILE` | Chemin absolu de la clé publique RSA de l’IdP. Le candidat ne charge pas de JWKS. |
| `CORTEX_JWT_ISSUER` | Émetteur attendu, identique au claim `iss`. |
| `CORTEX_JWT_AUDIENCE` | Audience attendue ; URL exacte de la ressource si découverte MCP activée. |
| `CORTEX_RUST_BIND` | Adresse locale, par défaut `127.0.0.1:8010`. Une adresse hors loopback est refusée. |
| `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE` | Clé publique distincte de l’hôte qui recueille les décisions sensibles. |
| `CORTEX_CORS_ORIGINS` | Tableau JSON d’origines exactes, par exemple `["http://localhost:5173"]`. Vide par défaut. |
| `CORTEX_TERMINUS_URL` | Origine TerminusDB HTTPS, ou HTTP sur loopback pour les essais. |
| `CORTEX_TERMINUS_USER`, `CORTEX_TERMINUS_PASSWORD` | Identifiants du moteur, injectés côté serveur. |
| `CORTEX_MCP_PUBLIC_URL` | Facultatif : URL HTTPS canonique terminée par `/mcp/`, annoncée à un compagnon distant. |

```sh
./target/debug/cortex-rust-core
```

Le binaire affiche seulement son adresse d’écoute. Il ne charge aucun fichier `.env`. Pour construire le binaire optimisé : `cargo build --workspace --release --locked`, puis `./target/release/cortex-rust-core` avec la même configuration. La construction optimisée ne constitue pas à elle seule une qualification de production.

`GET /health` vérifie le processus ; `GET /ready` vérifie le schéma et les protections SQL. La disponibilité de l’IdP, de TerminusDB ou du fournisseur modèle n’est pas attestée par ces sondes. `GET /openapi.json` expose les contrats, sans interface Swagger `/docs` dans ce candidat.

Les lectures métier utilisent `Authorization: Bearer …` et `X-Tenant-ID: …`. Appeler d’abord `/v1/me`, puis `/v1/domains/{domain}/version`. Le rôle vient de l’appartenance SQL, pas d’un champ de rôle déclaré par le client. Une version0 représente un graphe vide ; une version publiée supérieure à0 exige un manifeste Terminus vérifiable.

Les commandes sensibles exigent toujours `X-Cortex-Confirmation`. Le mode historique `CORTEX_HTTP_CONFIRMATION_MODE=trusted_host` ne désactive pas cette protection en Rust. La clé privée demeure dans l’hôte de confiance, jamais dans Vite, le LLM ou le backend Cortex. Le [guide frontend](frontend-guide.fr.md) décrit le parcours428 et la commande exacte à signer.

## Ajouter TerminusDB pour les essais

La CI utilise TerminusDB12.0.7 épinglé par digest. Une instance locale isolée peut être lancée avec la même image :

```sh
docker run --rm --name cortex-terminus-dev \
  -p 127.0.0.1:6363:6363 \
  -e TERMINUSDB_ADMIN_PASS=synthetic-spike-password \
  -e TERMINUSDB_SERVER_PORT=6363 \
  terminusdb/terminusdb-server@sha256:385faf298ad77aaf2d4d6df5e84a4cbe3596d01dab2e3b991af905639ae56388
```

Cette instance jetable contient seulement des données synthétiques. Configurer l’URL locale, l’utilisateur `admin` et ce mot de passe dans le processus de test. Les snapshots utilisent une base privée par préparation, un commit immuable et un manifeste SQL. Aucun accès direct au moteur n’est nécessaire au frontend ou au compagnon.

Une base historique déjà publiée ne bascule pas automatiquement vers TerminusDB. La commande interne `--import-published UUID_DOMAINE`, avec `CORTEX_MIGRATION_BEARER` et `CORTEX_MIGRATION_TENANT`, prépare les snapshots à partir de la projection déjà approuvée/publiée, sous contrôle owner et accès à toutes les preuves. La migration d’un corpus réel reste une opération à préparer avec sauvegarde et rapprochement dédié.

## Vérifier sans consommer de crédits modèle

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
uv run python scripts/verify_rust_http.py --output /tmp/cortex-rust-http.json
```

Le dernier scénario exige `CORTEX_RUST_DATABASE_URL` et `CORTEX_TEST_ADMIN_URL`, toutes deux sur une base dont le nom finit par `_test`. Il démarre le vrai binaire, génère des identités et confirmations éphémères, puis exerce HTTP, MCP, rôles, données personnelles, fichiers, feedback et reçus IA. Les appels OpenRouter/Ollama sont remplacés par un serveur HTTP synthétique local et une clé factice imposée par le test. Il conserve les fixtures dans cette base isolée et ne tronque aucune table. Le binaire de test est la version debug ; le détournement synthétique est interdit dans une compilation release.

Sans les variables TerminusDB, le rapport couvre75 opérations directement testables et annonce95 outils. Avec le moteur configuré, le même scénario couvre79 opérations et le cycle de publication/lecture avec snapshots réels. Ces nombres décrivent l’inventaire du scénario ; ils ne sont pas un pourcentage de couverture de lignes ou de branches.

Le test moteur autonome est activé séparément :

```sh
cargo test --workspace --locked --test terminus_engine -- --ignored --nocapture
```

Il attend l’instance locale sur6363 et `CORTEX_SPIKE_TERMINUS_PASSWORD`. Ne jamais pointer les tests vers une instance d’entreprise. La [CI Rust](../.github/workflows/rust.yml) donne l’ensemble de la préparation reproductible sous Linux. `make test` vérifie en plus la référence Python, les contrats et le client TypeScript ; il ne remplace pas les tests natifs.

## Activer un fournisseur ultérieurement

L’extraction OpenRouter est activée lorsque `CORTEX_MODEL_PROVIDER=openrouter`, `CORTEX_OPENROUTER_MODEL` et `CORTEX_OPENROUTER_API_KEY` sont configurés. `OPENROUTER_API_KEY` est une alternative côté serveur. La synthèse personnelle requiert aussi `CORTEX_SYNTHESIS_ENABLED=true`. Choisir un identifiant de modèle réellement disponible sur le compte ; les essais de migration ne prouvent pas la disponibilité ou la qualité d’un modèle commercial précis.

Pour l’extraction locale, configurer `CORTEX_MODEL_PROVIDER=ollama`, `CORTEX_LOCAL_MODEL` et éventuellement `CORTEX_OLLAMA_URL`, limitée à une origine HTTP sur IP loopback. La synthèse backend reste OpenRouter ; un compagnon peut utiliser son propre LLM et enregistrer ses réponses citées via MCP.

`CORTEX_MODEL_DAILY_ATTEMPT_LIMIT` limite les réservations par domaine et jour UTC, par défaut100, partagées entre extraction et synthèse. Il ne remplace pas un plafond monétaire chez le fournisseur. Une tentative `unresolved` ne doit pas être automatiquement répétée avec une nouvelle clé. Les essais de cette migration n’utilisent aucune clé réelle ni appel payant.

## Ce qui reste à qualifier

La surface HTTP/MCP est portée. Restent notamment la reprise des préparations Terminus absentes ou incomplètes (R11), le nettoyage des snapshots orphelins, les sauvegardes/restaurations cohérentes des deux stockages, le déploiement TLS/IdP réel avec rotation de clés, les performances, la haute disponibilité et l’évaluation sur corpus autorisé. Un worker autonome Rust n’est pas livré : les clients déclenchent `process` et relisent les reçus. Le [bilan technique](rust-migration.fr.md) détaille les autres limites des parseurs, du SSE et de la validation sémantique.

## Import initial du graphe publié

Le propriétaire lit `GET /v1/domains/{domain}/graph-import-attempts` (MCP `api_graph_import_attempts`) pour obtenir la version cible, l’empreinte SHA-256 du journal complet et la concordance de la projection SQL. Il confirme ensuite ces valeurs pour `POST /v1/domains/{domain}/graph-import` (`api_graph_import_published`). Un graphe incomplet peut nécessiter une reprise explicite via `POST /graph-import-attempts` (`api_graph_retry_import`), avec UUID/génération attendus, empreinte souhaitée, motif et clé personnelle stable.

Le service ne corrige pas silencieusement une projection divergente. Il vérifie chaque preuve et l’ensemble des relations avant le transfert, puis de nouveau avant l’enregistrement du manifeste. La commande de maintenance `--import-published` applique les mêmes vérifications ; elle reste une commande opérateur authentifiée, tandis que HTTP/MCP exigent la confirmation signée du contenu. Les versions acceptée/publiée et le journal de connaissance restent inchangés.

`registered` signifie qu’un manifeste immuable est enregistré. `unresolved` signifie que le résultat demeure incertain ; `superseded` qu’une décision explicite a remplacé cette tentative. Une même clé de reprise ne relance pas de création moteur. Les [contrats français des extensions](rust-extensions.fr.md) détaillent les paramètres, retours et cas de conflit.
