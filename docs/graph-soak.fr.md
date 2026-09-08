# Fonctionnement répété du graphe natif

Le scénario `scripts/soak_rust_graph.py` exerce le backend Rust pendant une durée mesurée, après l’import d’un graphe synthétique dans TerminusDB. Il complète les [mesures de volume](graph-volume.fr.md) par des changements de droits, des écritures personnelles et un redémarrage. Il ne détermine ni un SLO, ni une capacité de production, ni l’absence de fuite mémoire.

## Parcours et conditions de réussite

Le graphe comporte 2000 concepts et deux sources partagées de 200000 points de code. Le propriétaire accède à tout ; le lecteur ne voit qu’un concept sur deux et aucun lien vers un concept privé. Les questions alternent entre début, milieu et fin du corpus. La source complète, son hash, les offsets et les citations servent d’oracle, indépendamment de la réponse reçue.

Un cycle alterne liste, question et lecture du reçu entre HTTP et MCP. Toutes les dix itérations, le scénario vérifie aussi la vue propriétaire, son impossibilité de lire le reçu personnel du lecteur, puis un signal négatif synthétique rejoué avec la même clé dans l’autre transport. Ces votes sont des données de qualification ; ils ne représentent pas la satisfaction d’un utilisateur réel et ne sollicitent aucun modèle.

À un quart et trois quarts de la durée, une commande signée retire puis rétablit l’accès du lecteur à sa source publique. Pendant le retrait, les listes sont vides, les nouvelles questions n’ont aucune preuve et l’ancien épisode sourcé retourne 404. Après restauration, les listes, citations et cet épisode sont retrouvés exactement. Chaque phase est contrôlée en HTTP et MCP. La version et le manifeste restent inchangés.

À mi-parcours, le vrai processus reçoit SIGTERM entre deux cycles. Il doit sortir avec le code 0 avant le démarrage d’un nouveau PID, avec le même binaire, la même configuration et les mêmes bases. Aucun réimport n’est effectué. Le manifeste, les épisodes persistés et la lecture d’un ancien reçu sont comparés avant et après. Ce scénario ne remplace pas les tests spécifiques d’arrêt pendant une publication en vol.

La réussite exige au moins trois cycles, les quatre classes liste/question × HTTP/MCP, deux transitions complètes d’accès, un redémarrage propre et les reçus/signaux attendus exactement persistés. Un statut 200 inattendu, un contenu erroné, un échec protocolaire ou un événement manquant fait échouer la qualification. Les 404 attendus des contrôles de confidentialité sont identifiés comme tels dans les échantillons ; ils ne sont pas masqués comme des succès 200.

## Durée, cadence et observations

La CI demande **1800 secondes mesurées**, hors préparation SQL, import, compilation et fermeture finale. Le délai externe du scénario est de 2100 secondes ; le job complet dispose de 55 minutes. Une interruption externe peut laisser un rapport `running` ou `preparing`, qui n’est jamais un succès. Toujours rapprocher le rapport de la conclusion du job.

La cadence cible est un cycle toutes les deux secondes, sans accumulation de travail à rattraper. Un cycle lent réduit le débit effectif ; les dépassements de cadence et le cycle maximal restent dans le rapport. Le scénario conserve une petite marge d’admission en fin de fenêtre et attend sa fin mesurée. Aucun nouvel appel n’est admis après la deadline monotone, y compris si la création du jeton a pris du temps. Le timeout HTTPX est borné à 20 secondes au plus **par phase réseau**, réduit selon le temps restant ; il ne constitue pas un timeout mural global de 20 secondes. L’arrêt et la vérification finale sont chronométrés séparément.

Les rapports partiels sont remplacés atomiquement aux frontières des cycles après dix secondes, à chaque événement complet et sur exception. Un appel bloquant peut retarder cette sauvegarde : il ne s’agit pas d’une horloge de journalisation indépendante. Les requêtes et leurs statuts, durées et tailles restent enregistrés, sans reprise réseau silencieuse.

RSS et descripteurs sont des relevés après cycle, séparés par PID et époque de processus ; le redémarrage ne doit pas masquer la croissance éventuelle d’un segment. Les descripteurs sont mesurés via `/proc` sous Linux et restent absents lorsque ce mécanisme n’existe pas. Les connexions PostgreSQL sont filtrées par un `application_name` unique. Le pool ne doit pas dépasser dix connexions ni conserver une transaction inactive après le cycle. Ces relevés ne capturent ni les pics instantanés ni la mémoire de PostgreSQL ou TerminusDB.

## Exécution synthétique

```sh
cargo build --release --locked --bin cortex-rust-core
uv run python scripts/soak_rust_graph.py --synthetic-only \
  --duration-seconds 1800 --interval-seconds 2 \
  --output /tmp/cortex-graph-soak.json
```

Les variables SQL et moteur sont celles du [benchmark de volume](graph-volume.fr.md). Les deux URL SQL doivent désigner une base dédiée dont le nom se termine par `_test`. Le moteur est limité à HTTP loopback. Un tenant neuf est créé ; aucun corpus existant n’est lu ou supprimé. Les clés éphémères de test ne sont pas enregistrées dans le rapport.

`--simulate-engine --duration-seconds 45 --interval-seconds 1` vérifie localement le protocole avec un moteur HTTP contrôlé. Ce résultat n’est pas un essai de trente minutes sur TerminusDB réel. La provenance du moteur, le SHA du binaire, le commit candidat, le merge CI, les durées réellement obtenues et les deux époques figurent dans le rapport.
