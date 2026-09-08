# Qualification de restauration coordonnée

Le script `scripts/verify_coordinated_restore.py` et le workflow `Synthetic coordinated restore` testent par défaut une **sauvegarde physique intégrale du store TerminusDB arrêté**, coordonnée avec un dump PostgreSQL. Ils n’opèrent que sur des conteneurs synthétiques créés pour cet essai, sans bascule de production. Une restauration n’est considérée comme qualifiée qu’après réussite du workflow du commit concerné.

## Procédure testée

Le test crée deux versions publiées natives et un import repris à la génération2, soit trois manifestes. Il conserve les droits propriétaire/lecteur et une relation vers un concept privé. Après arrêt des producteurs applicatifs, il capture le dump PostgreSQL puis arrête le moteur source. Son stockage complet est copié vers un répertoire distinct et archivé. Les empreintes du stockage original et de SQL sont comparées pour vérifier qu’ils restent inchangés pendant l’export.

La sauvegarde physique contient aussi le système, les identités TerminusDB et les bases orphelines. Elle n’est pas limitée aux trois bases référencées par les manifestes. Aucun fichier de couche partagé n’est supprimé ni attribué arbitrairement à une base. La qualification utilise exactement la même image et le même format de store à la restauration ; elle ne démontre pas une migration entre versions du moteur.

La cible PostgreSQL est neuve. Le rôle applicatif restreint est recréé avant `pg_restore`, puis toutes les lignes applicatives, les protections RLS et les identifiants immuables sont comparés. Le store TerminusDB cible est un répertoire neuf : l’archive y est extraite, et tous les fichiers doivent retrouver leurs empreintes avant démarrage. Le serveur démarre sur ce store complet, **sans `store init`, création des bases ni `unbundle`**. Les identifiants d’accès enregistrés dans le store source restent ceux du store restauré ; changer simplement la variable de mot de passe ne constitue pas une rotation.

Chaque identifiant de commit original doit être accessible avec les mêmes documents et schémas. Le runtime Rust restauré doit lire ses versions et concepts, filtrer les données privées et leurs liens, répondre avec citations, conserver l’historique de reprise et rejouer la clé d’import sans POST moteur. Le test refuse de remplacer un commit ou un manifeste pour masquer une différence.

Une cible négative distincte reçoit une copie restaurée, puis sa base correspondant à la version courante est retirée par la commande moteur. La lecture doit échouer503, sans recours à la projection SQL ; les autres graphes restent lisibles. `/ready` peut rester200, car il vérifie SQL et ses protections, pas tous les graphes. Une archive altérée est refusée par son empreinte avant import.

## Échec distinct de la restauration par bundles

Le CLI communautaire12.0.7 possède `bundle`/`unbundle`, mais les essais de ce projet sur un store neuf ont échoué avec `unknown_layer_reference` : le pack désigne une couche parente absente du pack et de la cible. L’export sur copie et la restauration SQL avaient réussi. Cette observation ne permet pas d’attribuer la cause au plugin d’optimisation ; son GC concerne la mémoire Prolog. [Essai réel et diagnostic](https://github.com/SofianeBENHELLI/CortexFusion/actions/runs/34208823535), [contrôle de la frange du pack](https://github.com/terminusdb/terminusdb/blob/57f2093baeafd65e16004e84b7b58e0c5cf72858/src/core/api/db_pack.pl).

Le mode `--strategy bundle_experiment` conserve cette expérience reproductible. Il n’est pas la stratégie normale, n’est pas qualifié pour restaurer CortexFusion sur un store neuf et ne bénéficie pas des garanties de l’API Enterprise. Le CLI export modifie temporairement ses métadonnées et doit lui aussi travailler sur une copie arrêtée. [Implémentation communautaire figée](https://github.com/terminusdb/terminusdb/blob/57f2093baeafd65e16004e84b7b58e0c5cf72858/src/core/api/api_bundle.pl).

## Exécution

Prérequis : Docker, le binaire Rust compilé, Python3.12 et les dépendances du dépôt. Le script crée ses propres ports loopback, conteneurs et répertoires temporaires. Il n’accepte pas de stockage ou de base existante à remplacer.

```sh
cargo build --workspace --locked
uv sync --locked
uv run python scripts/verify_coordinated_restore.py --synthetic-only --strategy cold_store --output /tmp/cortex-restore-report.json
```

Le rapport précise la stratégie, les images exécutées, les phases, les manifestes et commits, les empreintes des fichiers et les contrôles. En cas d’échec, il conserve les phases déjà réussies. Dumps et archives restent temporaires et ne sont pas committés. Le nettoyage cible uniquement les conteneurs créés et étiquetés par le processus, ainsi que leurs volumes anonymes.

Ce test ne qualifie pas la haute disponibilité, le chiffrement/rétention, la sauvegarde à chaud, des rotations de secrets, les gros volumes ni des engagements RPO/RTO. Les ACL CortexFusion viennent du dump PostgreSQL ; les identités du moteur sont présentes dans le store physique mais la fixture ne teste pas toutes les configurations de comptes TerminusDB. La perte d’accusé de réception du COMMIT PostgreSQL reste une qualification distincte non réalisée.
