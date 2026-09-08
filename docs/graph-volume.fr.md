# Mesurer le volume du graphe sans présumer sa capacité

Le script `scripts/benchmark_rust_graph.py` mesure un profil synthétique reproductible sur le binaire Rust et TerminusDB. Il ne fixe pas de seuil de latence arbitraire et ne constitue pas une homologation de capacité de production. Le workflow `Synthetic graph volume` construit le binaire optimisé, prépare des bases jetables et conserve les mesures JSON dans son journal.

## Profil et opérations

Les volumes prévus sont 100, 500 et 2000 concepts. Chaque concept possède une courte source distincte avec un extrait exact Unicode. Un concept sur deux est accessible au lecteur ; les autres sont privés au propriétaire. Une relation relie chaque concept public à son voisin privé, afin de vérifier que le filtrage retire réellement les liens invisibles. Les lots historiques contiennent au plus 50 changements, avec un journal contigu et une projection SQL concordante. L’import normal, authentifié et confirmé, enregistre ensuite le manifeste TerminusDB sans nouvelle publication métier.

Le diagnostic, l’import et la première lecture après import sont chronométrés séparément. Cette première lecture n’est pas un cache moteur froid : l’import a déjà relu et vérifié le snapshot. La matrice mesure ensuite la liste propriétaire HTTP, la liste lecteur HTTP et MCP, la fiche d’un concept lecteur, ainsi que les questions lecteur HTTP et MCP, à concurrence 1, 4 et 12. Chaque cellule comporte 12 ou 24 requêtes. Un client HTTP partagé autorise 32 connexions ; le pool SQL natif en possède 10, avec un délai d’acquisition de 3 secondes.

Chaque réponse réussie est confrontée à un oracle : concepts exacts, liens privés absents, version attendue, réponse extractive et citations exactes. Les épisodes de questions sont distincts. Un concept privé est refusé au lecteur ; une question sans preuve accessible ou avec un budget trop petit produit un manque de connaissance. L’empreinte du manifeste est comparée à la fonction canonique Python de référence.

## Interpréter les mesures

Chaque lecture de graphe charge et vérifie le snapshot complet, même pour une fiche concept. Une question ajoute la lecture des sources, le classement lexical et l’écriture d’un épisode sous verrou de domaine. Sa phase finale peut donc se sérialiser entre lecteurs du même domaine. Aucun appel modèle n’est effectué. Ce profil à sources courtes ne mesure pas le coût d’un très long document partagé par des milliers de concepts.

La durée individuelle s’arrête après réception du corps HTTP, avant les comparaisons Python. Les jetons synthétiques sont générés par tentative, avant ce chronométrage, afin qu’une cellule lente ne mesure pas leur expiration. Le débit de cellule inclut l’orchestration et les contrôles du client. Médiane et p95 utilisent le rang le plus proche ; sur si peu d’échantillons, le p95 est voisin du maximum et n’est pas une estimation statistique stable. Les échantillons, codes de réponse et erreurs restent dans le rapport, sans retry masquant la première latence.

`availability=degraded` signifie qu’au moins une requête mesurée a rencontré 503 ou une erreur de transport. Une matrice vide porte `not_measured`. Une erreur d’authentification, de contrat ou un contenu incohérent fait échouer la qualification. Pour MCP, HTTP 200 ne suffit pas : `isError` et `structuredContent.http_status` doivent être cohérents. Une préparation d’import restée `unresolved` ou une indisponibilité de stockage est consignée comme volume non qualifié, sans la rebaptiser automatiquement « limite de taille ».

Le transport moteur limite ses enveloppes à **4 000 000 octets**. La représentation TerminusDB relue contient des types et identifiants de sous-documents ; elle est plus grande que le simple JSON de concepts. Le rapport mesure les octets réellement relus lorsqu’un import réussit. La limite MCP est distincte. Aucune borne produit n’est augmentée pour faire passer un volume. Les mesures de RSS sont des relevés après cellule, pas une capture garantie du pic mémoire.

## Exécuter et conserver la portée

Utiliser uniquement une base PostgreSQL dédiée dont le nom finit par `_test`, avec les rôles de migration et d’application habituels, et une instance TerminusDB synthétique sur loopback. Le script crée de nouveaux tenants et domaines ; il ne tronque aucune table et ne contacte aucun fournisseur IA.

```sh
cargo build --release --locked --bin cortex-rust-core
uv run python scripts/benchmark_rust_graph.py --synthetic-only \
  --build-profile release --output /tmp/cortex-graph-volume.json
```

Les variables SQL sont `CORTEX_TEST_ADMIN_URL` et `CORTEX_RUST_DATABASE_URL`. Le moteur utilise `CORTEX_TERMINUS_URL`, `CORTEX_TERMINUS_USER` et `CORTEX_TERMINUS_PASSWORD`. Les identités et confirmations sont créées pour l’essai. Le worker corpus n’intervient pas dans cette mesure.

Le mode `--simulate-engine --binary target/debug/cortex-rust-core --build-profile debug --sizes 100 --concurrency 1` sert à vérifier le protocole de fixture localement. Ses durées ne sont pas des performances TerminusDB et ne doivent pas être mélangées aux résultats réels. Le rapport distingue explicitement ces modes, l’empreinte du binaire, les versions, le SHA candidat et le merge de contrôle testé par la CI.

Le rapport est écrit avant et après chaque cellule pour conserver les résultats partiels. Un arrêt forcé peut laisser `status=running` : toujours rapprocher le JSON de la conclusion CI, sans traiter ce statut comme une réussite. Les jeux de données des volumes précédents restent présents pendant le run ; les mesures ne supposent pas un moteur réinitialisé entre volumes. La CI borne le scénario à 15 minutes après compilation. Il reste nécessaire de qualifier d’autres formes de graphes, documents longs, tailles de corps/relations, nombreux tenants, fichiers, fournisseurs IA et conditions d’exploitation avant d’en déduire un dimensionnement.

## Première mesure réelle et optimisation des extraits

Le [run 34215225011](https://github.com/SofianeBENHELLI/CortexFusion/actions/runs/34215225011), associé au candidat `b97808334a58087e164af94663a6bed60193cede`, a terminé ses 54 cellules et 864 requêtes avec succès, sans 503 ni erreur de transport. À 2000 concepts, le snapshot moteur relu occupait 1247003 octets ; la médiane des questions HTTP était de 129 ms à concurrence 1 et 1104 ms à concurrence 12. Ces valeurs décrivent ce runner CI et ce profil synthétique, avec seulement 12 ou 24 échantillons par cellule. Elles ne sont pas un engagement de service.

L’extraction d’une citation utilise maintenant les frontières UTF-8 de l’itérateur de caractères. Elle conserve les positions en points de code Unicode et alloue seulement le texte retourné, sans construire un `Vec<char>` de toute la source pour chaque citation. Une plage invalide reste refusée, y compris une position extrême ; les marques combinantes ne sont pas assimilées à un caractère visuel unique.

`cargo run --release --locked --example benchmark_excerpt` compare la fonction réellement exportée par la bibliothèque au précédent algorithme. Le profil contient 200000 points de code, soit 360000 octets UTF-8, et mesure les extraits de début, de fin et de source entière. Le compteur additionne les tailles demandées à l’allocateur, y compris les réallocations : il ne mesure ni la mémoire résidente ni son pic. Les contrôles d’équivalence précèdent le chronométrage. Aucun seuil de temps n’est imposé, car il dépend de la machine. Cette optimisation n’évite ni le chargement ni la vérification du snapshot complet et ne remplace pas un essai HTTP/MCP avec documents longs.
