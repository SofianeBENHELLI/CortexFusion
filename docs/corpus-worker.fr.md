# Worker natif de traitement du corpus

`cortex-corpus-worker` est un client HTTP Rust qui traite les fichiers et lots de textes en attente dans **un domaine, sous une identité explicitement désignée**. Il peut continuer pendant que le frontend est fermé. Il utilise les opérations publiques existantes ; ses décisions et résultats restent lisibles depuis HTTP ou MCP. Ce processus ne possède aucun accès direct à PostgreSQL, TerminusDB ou un fournisseur de modèles.

## Parcours fonctionnel

Le frontend ou le compagnon crée une collection puis soumet des fichiers ou un lot de textes. Les reçus passent en attente. Un worker configuré avec les droits `owner` ou `corpus_manager` lit ces reçus par pages et appelle leur traitement. Les sources extraites deviennent disponibles avec leurs lecteurs et leur provenance. Le frontend relit le reçu, puis la source ; il peut ensuite proposer ou extraire des connaissances dans une action distincte.

Le worker ne crée pas de propositions, n’appelle pas de LLM et ne valide ou publie rien. Il ne remet pas les éléments échoués en attente. L’utilisateur examine leur erreur et utilise explicitement les opérations `retry` existantes s’il veut les reprendre. Un lot `partial` contenant encore des éléments `pending` est traité ; un lot composé uniquement de réussites et d’échecs est laissé en l’état.

Les fichiers accessibles peuvent être partagés avec le sujet du worker, conformément aux droits actuels des fichiers, collections et sources. Les lots de textes restent personnels à leur auteur, comme dans l’API. Ce worker n’est donc pas une identité globale autorisée à traiter les imports privés de tous les utilisateurs.

## Configuration

Compiler avec `cargo build --workspace --locked`. Lancer ensuite `./target/debug/cortex-corpus-worker`, ou la version `target/release/cortex-corpus-worker` après une construction release. Le serveur CortexFusion doit déjà être lancé ; les URL SQL et paramètres de clés du serveur ne sont pas requis par ce client.

| Variable | Fonction |
|---|---|
| `CORTEX_WORKER_API_URL` | Origine API fixe, par exemple `http://127.0.0.1:8010`. HTTPS hors loopback ; aucun chemin, query, fragment ou identifiant dans l’URL. |
| `CORTEX_WORKER_TENANT` | UUID du tenant autorisé. |
| `CORTEX_WORKER_DOMAIN` | UUID du domaine à traiter. |
| `CORTEX_WORKER_SUBJECT` | Sujet `sub` exact attendu dans l’identité retournée par le serveur. |
| `CORTEX_WORKER_BEARER_FILE` | Fichier local contenant uniquement le jeton d’identité, éventuellement terminé par un saut de ligne. |
| `CORTEX_WORKER_POLL_SECONDS` | Pause entre cycles, 1 à 300 secondes ; 5 par défaut. |
| `CORTEX_WORKER_PAGE_SIZE` | 1 à 20 reçus par catégorie et cycle ; 5 par défaut. |
| `CORTEX_WORKER_MAX_RUN_SECONDS` | Durée maximale d’admission de nouveaux appels, 1 à 86400 secondes ; 3600 par défaut. |
| `CORTEX_WORKER_MAX_ACTIONS` | Plafond total de POST tentés, y compris résultats occupés/incertains ; 1 à 100000, 1000 par défaut. |
| `CORTEX_WORKER_MAX_CYCLES` | Facultatif, de 1 à 100000. Une valeur de 1 examine une page par catégorie, pas nécessairement tout le corpus. |

Le fichier de jeton est limité à 16 Kio. Sur Unix, il doit être un fichier régulier appartenant à l’utilisateur du processus, sans droits de groupe ou des autres utilisateurs et sans lien symbolique final. Le client ne fabrique pas et ne renouvelle pas les jetons : l’intégration IdP de l’opérateur peut remplacer atomiquement ce fichier privé avant expiration. Les nouveaux jetons doivent conserver le sujet et le tenant attendus. Ne pas transmettre le jeton dans les arguments de ligne de commande.

Avant chaque lecture ou traitement, le worker relit le fichier et appelle `/v1/me`, puis réutilise exactement ce jeton pour l’appel suivant. Il vérifie le sujet, le tenant, le domaine et la capacité `manage_corpus`. Le serveur recontrôle les droits réels au moment du traitement et après les opérations longues. Une rotation de fichier ne prolonge ni la durée maximale de session ni le plafond d’actions.

Le client refuse les redirections et n’utilise pas les proxys ambiants. Chaque requête a une limite de connexion de 3 secondes, une limite totale de 30 secondes et une réponse de 4 Mio maximum. Il ne charge pas `.env` automatiquement.

## API, MCP et suivi frontend

| Usage du worker | HTTP | Outil MCP équivalent |
|---|---|---|
| Vérifier l’identité et le domaine | `GET /v1/me` | `api_identity_read` |
| Parcourir les fichiers en attente ou au bail expiré | `GET /v1/domains/{domain}/files?pending=true` | `api_files_list` |
| Traiter un fichier | `POST /v1/domains/{domain}/files/{ident}/process` | `api_files_process` |
| Parcourir les imports personnels | `GET /v1/domains/{domain}/imports` | `api_imports_list` |
| Traiter jusqu’à 20 éléments en attente d’un import | `POST /v1/domains/{domain}/imports/{import_id}/process?limit=20` | `api_imports_process` |

Les curseurs fichiers/imports sont indépendants et conservés entre cycles. Chaque parcours repart au début après sa dernière page, afin de découvrir les nouveaux reçus sans rester bloqué sur les premiers éléments terminés. Deux workers ne constituent pas deux autorisations supplémentaires : les baux des fichiers et les transactions SQL existantes conservent l’exclusion. Un bail de fichier expiré peut être repris via l’opération publique ; les échecs terminaux ne sont jamais réessayés automatiquement.

Le frontend peut utiliser TanStack Query pour relire le fichier ou l’import toutes les quelques secondes tant qu’un état est `pending` ou `processing`, puis invalider ses listes de sources et collections lorsque le reçu fournit un `source_id`. Un import `partial` doit être interprété à partir de ses éléments. Les boutons de traitement manuel restent utilisables ; un résultat `FILE_BUSY` indique une concurrence connue et invite à relire le reçu.

## Arrêt et incidents

`SIGTERM` ou `SIGINT` ferme l’admission des prochains appels et laisse terminer la requête courante, avec une grâce de 35 secondes. Si le signal arrive pendant `/v1/me`, aucun POST suivant n’est lancé. Une deuxième interruption arrête avec un code non nul. La durée maximale de session est monotone ; une requête déjà admise peut encore prendre son délai réseau borné après cette échéance.

Un refus d’identité/droits, une réponse incohérente ou une erreur de transport/serveur inattendue arrête le worker. Après un POST incertain, relire le reçu avant de décider d’un redémarrage : le traitement peut avoir été enregistré même si la réponse est perdue. Le client ne réémet pas ce POST dans une boucle cachée. Les conflits connus `FILE_BUSY`, `STALE_LEASE` et annulations observées entre lecture et traitement sont différés ; leur suite dépend des reçus relus au cycle suivant.

Les lignes JSON de sortie indiquent le démarrage, les UUID de reçus traités/différés, leur statut et les compteurs d’arrêt. Elles n’incluent pas le jeton, le texte, le nom du fichier ou les preuves. Aucun endpoint de contrôle global du processus n’est ajouté ; le superviseur reste une responsabilité d’exploitation.

La qualification couvre des données synthétiques, les droits actuels, la concurrence, les plafonds et les interruptions. Ce mode ne qualifie pas encore une orchestration distribuée pour tous les auteurs, des engagements de débit, un gestionnaire de secrets réel ou une reconnexion automatique à l’IdP.
