# Qualification de restauration coordonnée

Le script `scripts/verify_coordinated_restore.py` et le workflow `Synthetic coordinated restore` testent une sauvegarde au repos sur des conteneurs synthétiques créés pour ce seul essai. Cette procédure est une qualification technique ; elle ne lance aucune bascule de production. Tant que le workflow du commit concerné n’a pas réussi, sa restauration n’est pas considérée comme validée.

Le test crée deux versions publiées natives et un import repris à la génération2, soit trois manifestes. Il conserve les droits propriétaire/lecteur et une relation vers un concept privé. Tous les producteurs applicatifs sont arrêtés avant le dump PostgreSQL. Le moteur source est arrêté proprement, puis son stockage est copié vers un répertoire d’export distinct. Le CLI communautaire `bundle` s’exécute uniquement sur cette copie, avec un fichier par base référencée par un manifeste. Les empreintes du stockage original et de SQL sont comparées pour vérifier qu’ils sont restés inchangés pendant l’export.

Le CLI de TerminusDB12.0.7 possède `bundle` et `unbundle`. Son export modifie temporairement des métadonnées du store : il ne faut pas extrapoler ce test à une sauvegarde à chaud ni reprendre les garanties de l’API Enterprise. La qualification utilise l’image communautaire épinglée par digest et le chemin `/app/terminusdb/terminusdb`. [Implémentation communautaire figée](https://github.com/terminusdb/terminusdb/blob/57f2093baeafd65e16004e84b7b58e0c5cf72858/src/core/api/api_bundle.pl), [initialisation du conteneur](https://github.com/terminusdb/terminusdb/blob/57f2093baeafd65e16004e84b7b58e0c5cf72858/distribution/init_docker.sh).

La cible PostgreSQL est neuve. Son rôle applicatif restreint est recréé avant `pg_restore`, puis toutes les lignes applicatives, les droits RLS et les identifiants immuables sont comparés. La cible TerminusDB est initialisée sans serveur actif ; chaque base retrouve son nom exact avant `unbundle`. Le serveur démarre ensuite. Chaque identifiant de commit original doit rester accessible, avec les mêmes documents et schémas. Le test refuse de remplacer un commit ou un manifeste pour masquer une différence.

Le runtime Rust restauré doit lire ses versions et concepts, filtrer les données privées et leurs liens, répondre avec citations, conserver l’historique de reprise et rejouer la clé d’import sans POST moteur. Une cible supplémentaire omet volontairement le graphe de la version courante : la lecture doit échouer503, sans recours à la projection SQL. `/ready` peut rester200, car il vérifie le stockage SQL et ses protections, pas tous les graphes référencés. Un fichier altéré est refusé par son empreinte avant import ; cette protection appartient au protocole de sauvegarde, pas à une garantie d’`unbundle`.

## Exécution

Prérequis : Docker, le binaire Rust compilé, Python3.12 et les dépendances du dépôt. Le script crée ses propres ports loopback, conteneurs et répertoires temporaires ; il n’accepte pas de stockage ou de base existante à remplacer.

```sh
cargo build --workspace --locked
uv sync --locked
uv run python scripts/verify_coordinated_restore.py --synthetic-only --output /tmp/cortex-restore-report.json
```

Le rapport indique les images exécutées, les manifestes et leurs commits, les empreintes des fichiers et les contrôles réussis. Les dumps et bundles synthétiques restent temporaires et ne sont pas committés. Le nettoyage cible uniquement les conteneurs créés par le processus et leurs volumes anonymes.

Ce test ne qualifie pas la haute disponibilité, le chiffrement/rétention des sauvegardes, les comptes et permissions propres à TerminusDB, la sauvegarde à chaud, les branches non ancêtres, les gros volumes ni des engagements RPO/RTO. Les ACL CortexFusion viennent du dump PostgreSQL. La perte d’accusé de réception du COMMIT PostgreSQL reste une qualification distincte non réalisée.
