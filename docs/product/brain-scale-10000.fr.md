# Qualification Step 1 — protocole 10 000 concepts

**Protocole fixé avant mesure, le 4 octobre 2026 à 00:38 UTC. Aucune qualification 10 000 acquise à cette date.** Les résultats de 1 000 concepts et de l’import privé ne sont pas extrapolés. Toute révision du protocole sera datée avec sa raison ; un budget dépassé restera un échec du budget initial.

## Environnement et séparation

Machine locale de référence relevée : Apple M4 Pro, arm64, 12 CPU logiques, 24 Gio de mémoire physique, macOS 26.6.1. PostgreSQL et TerminusDB tournent dans les conteneurs synthétiques déjà utilisés, distincts des volumes OKF. Docker rapporte 12 CPU et 8 319 238 144 octets de mémoire ; le rapport devra préciser les ressources effectives par conteneur, leurs versions, le binaire et les builds mesurés. Aucun contenu OKF dans les fixtures, journaux de charge ou artefacts publics.

Le navigateur disponible est le navigateur intégré à Codex. Desktop 1280×900 ; mobile **simulé par viewport** 390×844 et 320×740, pas un appareil physique. Conserver cette limite. Les relevés HTTP, les durées observées via l’automatisation et les mesures de rendu internes au client ont des périmètres différents et seront présentés séparément.

## Jeux déterministes

Quatre cas à préparer, chacun avec **10 000 identités distinctes et publiées**, 10 000 sources synthétiques exactes, UUID de concepts/domaines déterministes, identités sources issues des reçus API persistés, et graine de génération `cortex-step1-20261004-v1` :

| Cas | Répartition des concepts | Relations dirigées uniques | Degrés sortants |
|---|---|---:|---|
| S20 | Un domaine de 10 000 | 20 000 | 50 hubs à 100, 5 050 concepts à 2, 4 900 à 1 |
| S100 | Un domaine de 10 000 | 100 000 | 50 hubs à 100, 5 450 concepts à 10, 4 500 à 9 |
| M20 | Trois domaines : 9 000 / 900 / 100 | 20 000 au total | Même distribution globale que S20, hubs dans le domaine de 9 000 |
| M100 | Trois domaines : 9 000 / 900 / 100 | 100 000 au total | Même distribution globale que S100, hubs dans le domaine de 9 000 |

Les relations sont associatives, poids explicite 0,5, sans marqueur principal, sans relation inter-domaine ni auto-relation. Inclure des liens vers une cible commune pour exercer de forts degrés entrants. Les autres cibles sont choisies de manière déterministe parmi les concepts du même lot ou déjà publiés ; les hubs de 100 liens sont publiés après leurs cibles. Le générateur doit vérifier les comptes exacts avant toute publication. Ces paramètres ne représentent ni apprentissage ni renforcement automatique.

Corps, comptés en points de code Unicode : **9 000 × 600**, **890 × 6 000**, **100 × 30 000**, **10 × 200 000** caractères. Préfixes synthétiques distincts, caractères non BMP et accentués ; chaque preuve cite exactement son corps. Les tests spécifiques d’échappements JSON et de casefold à 200 000 caractères restent complémentaires.

Préparation par lots gouvernés de 50 concepts au maximum et au plus 1,5 Mo JSON par requête ; le nombre réel de publications dépend du budget en octets et sera rapproché. Ne pas contourner cette borne ni attribuer une préparation directe de base de données au parcours de publication. Conserver l’historique réel et vérifier le journal par pages ; l’écran peut annoncer une couverture partielle explicite. Après la création, une publication contrôlée met à jour des concepts existants et permet de vérifier version, différences, reprise et stabilité des identités.

## Mesures et budgets initiaux

- **HTTP chaud** : cinq échauffements exclus puis 50 observations par route/scénario, p50/p95 par rang le plus proche, échecs comptés séparément. Requêtes : première fenêtre, suivante/précédente, voisinage ordinaire/hub, recherche exacte hors page, absence de résultat, détail court/long, journal récent et différence compacte. Signer avant le chronomètre ; mesurer jusqu’à la lecture complète du corps de réponse, hors validation JSON.
- **À froid** : distinguer processus redémarré avec projection existante et première construction de projection d’une nouvelle version. Rapporter chaque durée avec son effectif ; ne pas présenter un p95 statistiquement représentatif sur une seule préparation. Ne pas purger les caches système ni supprimer une projection utilisateur pour fabriquer le froid. Une limite à froid n’est pas masquée par le résultat chaud.
- **Concurrence** : cinq sessions autorisées sur la fixture synthétique, vingt séquences par session ; mélange identique de carte, recherche, détail et journal. Droits statiques ; aucun scénario de retrait de membre. Mesurer p50/p95 par opération, temps total, erreurs et contention séparément des lectures séquentielles.
- **Budgets utilisateur** : première vue utilisable ≤2 s au p95, recherche/zoom/sélection d’événement chauds ≤1 s au p95. Recette dix observations navigateur par parcours pour commencer, effectif déclaré ; une durée mesurée autour des commandes CUA inclut leur coût et ne remplace pas une mesure de rendu instrumentée. Tout indicateur impossible à mesurer avec les outils disponibles reste « non mesuré ».
- **Bornes de rendu et transport** : fenêtre normale ≤24 résumés/120 relations, recherche ≤8 résumés, voisinage paginé, journal ≤40 lignes rendues, détail long dépliable dans une région bornée. Pas de corps complets dans les réponses de synthèse. Réponse de fenêtre ≤64 Kio de JSON décodé ; limites existantes du journal (1 Mo par réponse et 8 Mo reçus cumulés) conservées. Texte exact de détail/source mesuré à part.
- **Mémoire avant mesure** : processus Rust ≤1 Gio de RSS au pic pour chaque jeu ; ensemble des conteneurs synthétiques PostgreSQL/Terminus ≤4 Gio de mémoire rapportée par Docker ; navigateur, delta de RSS des processus attribuables à la recette ≤512 Mio par rapport à son état initial. Échantillonnage 250 ms si disponible. Si l’attribution navigateur est impossible, annoncer cette mesure indisponible et conserver la réserve de qualification ; le nombre de nœuds DOM ne vaut pas mesure de mémoire. Garder au moins 10 Gio d’espace disque libre ; arrêter proprement la préparation avant de franchir ce seuil et conserver les reçus.

## Recette et conditions de passage

Rapprocher chaque identité, relation, degré, preuve et publication du manifeste synthétique avec les réponses natives paginées, sans doublon ni perte. Vérifier recherche exacte malgré de nombreuses mentions, changement de version, source cachée statique, erreur/reprise et publication répétée. Les fixtures de droits restent séparées du corpus privé.

Au navigateur : vue d’ensemble → domaine → voisinage → concept → relation → source ; recherche hors page ; événement Chronique → carte ; périodes/filtres ; retour navigateur/reconnexion ; clair/sombre ; clavier ; 320/390 px. Pour M20/M100, les compteurs et versions des trois domaines restent indépendants ; la vue d’ensemble ne prétend pas être un instantané transactionnel ou un graphe de relations inter-domaines.

**Résultats : non mesurés pour S20/S100/M20/M100.** La publication complète des textes OKF, la revue de leurs références, le gestionnaire d’import connecté et ce protocole constituent des critères distincts du Step 1. Aucune absence ni impossibilité de mesure ne sera classée comme réussite. Les Représentations, le sommeil, l’archivage et la mémoire active ne sont pas implémentés par ce protocole.


## Préparation des jeux — 4 octobre, 00:45 UTC

`scripts/brain_scale_workload.py` génère les quatre manifestes sous `.runtime/brain/scale10000-v1/`, sans mutation serveur. Cinq tests vérifient leurs 40 000 enregistrements cumulés, distributions exactes, identités uniques, références internes au bon domaine, absence de doublon/auto-relation et dépendances de publication. Les vingt premiers concepts de chaque domaine forment une cohorte initiale de cibles ; les concepts suivants ne citent que cette cohorte ou des concepts antérieurs. L’adaptation aux lots de revue devra encore vérifier le budget JSON avec les identités sources réelles.

| Jeu préparé, non publié | Octets du manifeste JSON | SHA-256 |
|---|---:|---|
| S20 | 22 576 561 | `7369d7fe0347686c33967a2a8625eb302cd7a6a148c6d8906eeec141e86b35d9` |
| S100 | 30 815 085 | `6d83b85661d728a1747602263709354a9a24711214e018131ecbcb12ebc707c1` |
| M20 | 22 576 753 | `0c565672ea4e2976bf870eee72946e263d0ae7309a6acf368b03f2394f1e01e9` |
| M100 | 30 815 279 | `e8895a96e757a2b596f1995500b73adebcd0a9d6e1723eafa455967b65145426` |

Ces tailles sont celles des fichiers de préparation, pas celles d’une réponse HTTP ni des snapshots canoniques. Les tests du générateur ne constituent **aucune preuve native ou navigateur à 10 000**. Prochaine action : préparer un runtime synthétique isolé et son parcours de publication reprenable, puis effectuer les mesures et recettes définies plus haut.

## Publication reprenable — 4 octobre, 01:45 UTC

`scripts/brain_scale_fixture.py` publie exclusivement un manifeste strictement égal au jeu synthétique du générateur figé. Clés, sources reçues, base de chaque lot, proposition, approbation et reçu de publication sont conservés sous `.runtime/brain`, écritures atomiques et verrou d'un seul auteur. Sources enregistrées par API, approbation signée et publication distincte ; seuls le tenant, les domaines et les rôles statiques de la fixture sont initialisés directement. Aucun concept ni snapshot métier injecté en SQL. Clés privées chargées une fois en mémoire ; nouveaux JWT courts et nouvelles confirmations pour chaque commande, sans cache d'autorisation.

Le plan **S20 comporte 202 lots** sous les deux budgets initiaux. Les derniers lots diminuent en taille pour les corps de 200 000 caractères et les hubs. Validation des cibles antérieures ou présentes dans le même lot, aucune coupure de concept ni dépassement de 100 liens. Les quatre plans passent ces contrôles. **Onze tests Python** valident également les pertes de réponse après création de source/proposition/approbation/publication, la reprise depuis le seul état durable, le refus d'un historique inattendu et d'un manifeste modifié. Le premier lancement a échoué avant toute mutation parce que les clés numériques du résumé devenaient des chaînes en JSON ; comparaison corrigée et test d'aller-retour ajouté.

S20 commencé à 01:32 UTC. Arrêt contrôlé à **1 800 concepts/v36**, serveur drainé, reprise dans le même tenant depuis le lot 37 avec le binaire corrigé : aucune reprise des 36 lots acquis. À **01:45 UTC : 2 900 concepts publiés/v58**, préparation encore active, **10 000 non atteints**. Les sources du lot en cours et la version acceptée peuvent précéder la publication ; elles ne sont pas comptées comme des concepts publiés. Le rapprochement exhaustif, les quatre jeux complets et les mesures finales restent à faire.

```sh
source .runtime/brain/env.sh
.venv/bin/python -m scripts.brain_scale_fixture --manifest .runtime/brain/scale10000-v1/S20.json --directory .runtime/brain/scale10000-S20 --duration 21000
```

La commande refuse les bases non synthétiques, le serveur moteur privé et un autre manifeste dans un répertoire existant. `--serve-only` permet une observation sans nouvelle publication ; `--max-batches` borne un incrément. `--duration` borne aussi la préparation et conserve les reçus à l'arrêt ; contrôler séparément l'échéance d'autonomie avant chaque relance. Le serveur courant doit être arrêté proprement avant une reprise, sans supprimer ni recréer le tenant.

Fichiers de reprise : `scale10000-S20/state.json`, logs `scale10000-S20-{run,resume}.log`, tests `scale10000-fixture-tests.log`. Le runtime repris est parent **27064/Rust 27069/session 34604**, API 8011, durée jusqu'à environ 07:26 UTC. Premier échantillon mémoire en cours de préparation : Rust 47 536 Kio de RSS, PostgreSQL synthétique 133,8 Mio et Terminus synthétique 816,9 Mio. **Ce sont des observations ponctuelles, pas des pics ni une qualification mémoire** ; les autres conteneurs de la machine ne sont pas modifiés.

La correction de planification des lectures [ADR 0012](../architecture/decisions/0012-parameter-aware-read-plans.md) est déjà dans le runtime repris. Son diagnostic sur le jeu historique 1 000 ne vaut pas mesure à 10 000. Aucun budget de ce protocole n'a été relevé.

## Outillage et état — 4 octobre, 02:58 UTC

Le profil **release** est retenu avant les mesures finales : même source native, 55 tests réussis, deux tests moteur opt-in ignorés ; parité native du jeu historique 1 000 et contrôles de droits statiques vérifiés. Le préparateur accepte `--profile release` et enregistre profil/empreinte du binaire. Aucun budget de latence, mémoire, densité ou taille n’est relevé. Ne pas présenter les temps de préparation debug et release comme un benchmark comparatif.

À 02:58, S20 **7 600/v152**, S100 **4 150/v83** ; aucun rapprochement/mesure du jeu complet ni preuve navigateur à 10 000. M20/M100 restent à publier. Les deux auteurs utilisent le même environnement synthétique, ce qui doit figurer comme charge de fond des observations.

S20 a rencontré un **503 réel** à la publication 150, tenté de nouveau sans succès avec le binaire release. Inspection : accepté 150/publié 149, tentative 1 incertaine. Une commande native gouvernée de remplacement, bornée à cette version/génération/proposition et enregistrée avant envoi, a publié la génération 2 en **42,652 s** ; précédente conservée comme remplacée, empreinte/cible identiques. Cause initiale du défaut moteur non isolée. Auteur repris avec mêmes reçus : publication 150 idempotente, progression ensuite à 152. Ce n’est pas un scénario de retrait de membre, ni une preuve frontend de reprise.

Runtimes actuels : S20 parent 32863/Rust 32866/session 63956 sur 8011 (`scale10000-S20-after-recovery.log`) ; S100 parent 30652/Rust 30659/session 85642 sur 8012 (`scale10000-S100-run.log`), tous deux jusqu’à environ **06:55 UTC**. Les anciens helpers S20 sont arrêtés ; le privé 8013 reste distinct. Ne pas lancer deux auteurs pour un même checkpoint.

### Rapprochement et mesures reproductibles

`scripts/qualify_brain_scale.py` refuse de travailler sur une fixture incomplète, non synthétique ou différente du manifeste figé. Le mode `reconcile` compare concepts, corps, sources/empreintes/droits, liens/degrés, identités uniques, publications/différences et créations à la version attendue. Le rapport conserve l’avancement partiel et les échecs sans texte de source ni jeton.

Les autres modes sont `measure` (11 lectures, cinq échauffements puis 50 échantillons entrelacés), `concurrent` (cinq sessions propriétaires, vingt séquences carte/recherche/détail/journal chacune) et `first-read` (une observation, état froid à prouver séparément). Temps HTTP avec corps complet, sans signature/validation JSON cliente ; p50/p95 au rang supérieur, tailles, erreurs et RSS du processus natif échantillonné. `completed` signifie exécution terminée, **pas passage des budgets**. Les conteneurs, le navigateur, le changement de version et les cinq rôles éventuels ne sont pas qualifiés par ce seul outil ; les cinq sessions utilisent ici le même propriétaire de fixture.

Exemple à lancer **après** publication complète et contrôle des processus, avec un nom de rapport neuf et la charge de fond réellement observée :

```sh
.venv/bin/python -m scripts.qualify_brain_scale reconcile \
  --manifest .runtime/brain/scale10000-v1/S20.json \
  --directory .runtime/brain/scale10000-S20 \
  --report .runtime/brain/scale10000-S20/reconciliation-first.json \
  --background-load 'Décrire ici les préparations et services réellement actifs' \
  --duration 1800
```

Durée maximale autorisée par l’outil 3 600 secondes, également limitée à l’expiration de la fixture. Garder la fin d’autonomie 07:58 comme limite externe. L’outil ne purge aucun cache et n’interrompt aucun auteur ; arrêter/reprendre proprement les serveurs séparément si une observation froide ou isolée l’exige.

Validation de l’outillage : **20 tests Python** (onze préparateur + neuf rapprocheur), et recette native séparée **50 concepts/sources, 100 relations, une publication**, onze routes relues exactement. Ces résultats sont des préalables, pas des mesures S20/S100. Le journal dense I10 (200 concepts/20 000 liens) vérifie en outre la continuation entre publications sous le plafond de 10 000 événements ; il ne remplace pas I03.


## Nouveau rendu spatial — 4 octobre, 19:39–20:12 UTC

La refonte répond au retour de Sofiane sur la navigation Google Maps. **Chrome** remplace le navigateur intégré pour cette nouvelle recette ; desktop normal 1920 px, mobile simulé 390×844. C’est un changement d’environnement annoncé, pas une comparaison de navigateurs. Les quatre workloads et leurs budgets initiaux restent inchangés. S20 et S100 sont publiés à v202 ; seul S20 est rapproché complètement, M20/M100 restent à publier.

### Défaut natif et première lecture

Le nouveau `/graph/map` répondait **503 STORAGE_ERROR** sur S20 avant correction. Son agrégation corrélée des sources est remplacée par une agrégation ensembliste tenant/domaine/version ; chaque source reste requise pour autoriser son concept, les deux extrémités sont filtrées. Limites SQL/transport inchangées. Le diagnostic `EXPLAIN ANALYZE` corrigé prend 175,441 ms (planification 0,971 ms), observation SQL unique. Plans avant/après conservés localement, pas de durée HTTP inventée pour les tentatives échouées.

Rapport `scale10000-S20/spatial-first-v1.json` : processus release redémarré, projection SQL déjà présente, **HTTP 200 / 318,459 ms / 2 027 262 octets JSON décodés**. Ensemble exact des 10 000 identités et des 20 000 tuples de relation comparé au manifeste figé, v202. Un seul échantillon, pas p95 ni construction à froid. Binaire SHA-256 `71d15a1f76015f1b92cb1d0e301f47fa4bef3c163de7c9d6fa59313b2adadbb2`.

**Cette réponse globale de métadonnées ne tient pas le budget initial de fenêtre 64 Kio.** Les rendus bornés et la vitesse de cet échantillon ne remplacent pas les agrégats/tuiles serveur. Les bornes historiques 24 résumés/120 liens concernent le lecteur précédent ; la carte spatiale utilise des budgets d’objets locaux différents, sans prétendre satisfaire ce contrat. Aucun budget initial n’est relevé ni aucun échec effacé.

### Concurrence continue

Le nouveau gardien vérifie toutes les 250 ms les horloges murale et monotone. Un trou >5 s, un écart >2 s ou un retour de l’horloge invalide définitivement le run (`invalid_interrupted`) ; une réponse arrivée après cette rupture ne compte pas comme succès. La durée des serveurs expire dès l’une des deux échéances. Cela empêche de qualifier comme continu l’ancien run interrompu par la machine ; ce n’est pas un diagnostic certain de mise en veille.

Exécution `concurrent-continuous-v2.json`, 19:57:49–19:58:21 UTC : **5 sessions × 20 séquences × 4 routes = 400 réponses, zéro erreur**, 30,932 s. Charge déclarée : navigateur S20 utilisé séparément pendant la recette, API privée inactive, historiques synthétiques conservés, aucun auteur. Les routes sont les lectures natives bornées, **pas cinq lectures concurrentes de la nouvelle topologie globale**.

| Route, 100 observations chacune | p50 HTTP ms | p95 HTTP ms | Budget chaud 1 s au p95 |
|---|---:|---:|---|
| Fenêtre | 299,001 | 792,596 | Tenu pour cette exécution |
| Recherche exacte | 113,002 | 589,507 | Tenu pour cette exécution |
| Détail court | 30,982 | 988,470 | Tenu pour cette exécution |
| Journal | 505,234 | **1 004,963** | **Dépassé** |

Continuité valide : trou maximal 2,072 s, divergence des horloges 0. Pic RSS Rust échantillonné **118 292 480 octets**, 123 échantillons sans erreur, dans la borne 1 Gio pour cette seule exécution. Conteneurs et delta RSS Chrome **non mesurés**. Les précédents échecs de première projection S100 (13,078 s) et de mémoire conteneurs (6,187 Go) restent ouverts.

### Preuve navigateur distincte

S09–S11 de la matrice décrivent le zoom, les routes visibles dès le recul, la fiche 200 000 caractères, la pagination et l’inspection d’un vrai lien associatif, le clavier et 390 px clair. Dix actualisations chaudes conservent le zoom à 17 %, sans alerte ; rapport `spatial-browser-refresh-v1.json` : **p50 312,5 / p95 358,9 ms**, lecture jusqu’à la seconde animation frame. Ce signal indique une occasion de rendu, pas l’affichage physique, une interaction utilisateur, un démarrage à froid ou la mémoire. La correction ultérieure de focus du panneau de relation ne change pas ce chemin de lecture.

**Conclusion de cet incrément : S20 spatial fonctionnel sur les parcours décrits ; Step 1 à 10 000 toujours non qualifié.** Prochains critères : transport spatial borné, S100/multidomaines, nouvelle publication, erreurs/droits/reprise sur la nouvelle interface et mémoire client/serveur. Rapports locaux sous `.runtime/brain/`, sans corpus privé ni jeton.

## Transport spatial progressif — 4 octobre, 20:44–21:20 UTC

Le nouveau transport `/graph/scene` et `/graph/map/nodes` est décrit dans [ADR 0014](../architecture/decisions/0014-bounded-spatial-scenes.md). Il réduit le transfert par réponse, sans revendiquer un coût serveur limité au viewport : la topologie autorisée reste calculée globalement à chaque lecture.

Rapprochement natif S20 en lecture seule : **625 pages de 16 résumés, ensemble exact des 10 000 UUID, aucun doublon ; sept pages de voisinage, 100 tuples sortants exacts ; recherche du dernier concept exacte**. Première scène : HTTP 200, **19 546 octets**, 333,332 ms ; maximum des pages : **3 951 octets**. Ce sont des observations de transport, pas un p95 ni une mesure de rendu. Rapport `.runtime/brain/scale10000-S20/scene-pagination-v1.json`, manifeste figé inchangé, binaire `6928c61a136cdab8476b3e508c2640d9bbff06dd1fcbfc40161a824159c09b28`. Continuité valide : écart cadence maximal 0,262 s, divergence 0,002 s. La correction ultérieure de recherche Unicode est couverte séparément ; elle ne remplace pas ce rapport par un run prétendument nouveau.

**Événement d’exploitation découvert pendant la recette :** `docker inspect` établit que `cortex-brain-terminus` a été arrêté par OOM le **4 octobre à 19:58:08 UTC**, pendant le run de concurrence historique 19:57:49–19:58:21. Les 400 réponses SQL restent les réponses observées, mais elles ne prouvent donc pas un système complet sain. Le moteur synthétique était toujours arrêté pendant le début de cette nouvelle recette : une publication de six concepts a échoué 503, avec tentative durable `uncertain`. Redémarrage du même conteneur, puis remplacement gouverné de cette tentative : génération 2 publiée, historique conservé. Aucun nouveau corpus S20/S100 ingéré, aucun volume supprimé, aucune limite mémoire relevée. Le moteur privé est distinct et n’a pas été arrêté.

Chrome confirme les parcours bornés P01–P04 : zoom, recherche, lecture longue/preuve, liens, Chronique et panne/reprise. Ni ces parcours, ni les tests unitaires ne ferment les échecs mémoire/froid antérieurs. **Step 1 à 10 000 reste non qualifié** : S100 et profils multidomaines, coût serveur par viewport, mémoire et concurrence du nouveau transport restent à mesurer avec le protocole figé.

## Scènes préparées en cache — 4 octobre, 21:46–22:15 UTC

Même manifeste gelé, mêmes limites système, aucune réingestion ni hausse de budget. Binaire release `e8f309fd950fddf9e43481bd02ca530f69aeb024843ab0647b8cc415fcbbaa8f`. S20/8011 et S100/8012 : projection SQL déjà présente, nouveau processus. Le cache n'est jamais une autorisation : droits/versions/index documentaire vérifiés sous verrou à chaque lecture. Huit entrées, 128 Mio d'allocations estimées, expiration inactive cinq minutes, calcul sérialisé. Coût global restant décrit dans [ADR 0014](../architecture/decisions/0014-bounded-spatial-scenes.md).

| Mesure | S20 | S100 |
|---|---:|---:|
| Première scène, n=1, projection existante | 333,547 ms / 19 546 octets | 1 063,860 ms / 19 646 octets |
| Scène chaude p50 / p95, n=50 après cinq échauffements | 30,994 / 33,275 ms | 34,684 / 40,896 ms |
| Voisinage chaud p50 / p95, n=50 | 24,237 / 30,495 ms | 23,965 / 28,463 ms |
| Recherche exacte chaude p50 / p95, n=50 | 23,548 / 26,320 ms | 23,634 / 27,039 ms |
| 625 pages catalogue, identités exactes sans doublon | 10 000 / max 3 951 octets | 10 000 / max 3 986 octets |
| Cinq sessions × vingt séquences × quatre lectures | 400, zéro erreur, 19,427 s | 400, zéro erreur, 21,501 s |
| Concurrence p95 scène/recherche/détail/journal | 529,630 / 502,906 / 143,206 / 153,416 ms | 585,063 / 546,210 / 161,277 / 175,608 ms |
| Rust RSS max observé, échantillonnage 250 ms | 114 884 608 octets | 241 336 320 octets |
| Conteneurs synthétiques max observé, environ 2 s | ≈461 Mo / 21 paires | ≈538 Mo / 23 paires |

S100 : audit natif global séparé, **100 000 tuples de relations exactement égaux au manifeste**. La mémoire inclut cet audit ; le frontend continue à utiliser les scènes bornées. Le rapprochement exhaustif des corps/preuves/publications S100 reste distinct. Les sessions concurrentes utilisent le même propriétaire autorisé, aucun changement de droits. Le journal interrogé ici est une lecture récente à huit publications ; ne pas extrapoler aux fenêtres/historiques plus larges. Continuité valide, max gap 0,256 / 0,264 s, divergence 0 ; moteur Terminus même PID vivant avant/après, pas de nouvel OOM. Aucun auteur actif ; privé 8013, consoles et S20 inactif pendant S100 constituent la charge de fond déclarée.

Chrome sur S100 : P07 partiel, véritable zoom/recherche/fiche de 200 000 caractères/liens/retour clavier, desktop clair/sombre et 390/320 px. Dix Actualiser gardent la caméra 16 %, zéro alerte. Mesure de la **dernière lecture de scène jusqu'à deux animation frames**, n=10 : p50 162,7 / p95 183,5 ms. Le rafraîchissement comporte une première lecture pour établir sa fence, exclue de cette mesure ; ni temps clic complet, ni froid, ni affichage physique, ni mémoire navigateur ne sont ainsi qualifiés.

Rapports locaux ignorés : `scale10000-{S20,S100}/scene-cache-v1.json`, `scale10000-S100/scene-browser-refresh-v1.json`, `scene-desktop-dark.png`. Helpers `measure-scene-cache.py` et `measure-scene-cache-s100.py` sous `.runtime/brain/`. Un premier lancement S100 avant disponibilité du serveur a échoué à la connexion ; conservé dans `scene-cache-startup-failed.json`, exclu des échantillons réussis. L'essai final enregistre la nouvelle empreinte réelle et aucune erreur de prélèvement.

**Step 1 toujours non qualifié.** L'ancienne construction froide S100 à 13,078 s et le pic moteur historique à 6,187 Go restent des échecs ouverts ; les nouvelles lectures chaudes n'effacent pas leurs conditions. Mémoire navigateur non mesurée ; M20/M100 non publiés ; changements temporels/publication et corpus privé non recettés dans cette variante. Recherche 16 résumés au lieu de huit et jusqu'à 64 glyphes (dont cellules unitaires possibles) restent à confronter aux bornes de rendu gelées. Ces budgets n'ont pas été rehaussés pour déclarer une réussite.

## Bornes de rendu rétablies — 5 octobre, 00:15 UTC

Le lecteur progressif reste opt-in. Son contrat est maintenant **16 cellules + huit repères = 24 objets au plus**, 120 tracés, 65 536 octets décodés. Une recherche normalisée non vide renvoie huit résultats, les autres pages seize, avec `page_size` autoritaire. Ni plafond global ni budget de qualification relevé. Binaire release `c2f61adc01e3ead0a950efea4b49b4de869e4cbe6655c69730cd25779e524cfc`.

Contrôle natif S100 persistant v202, sans réingestion : Territoires/Fireworks/Circulaire/En lignes donnent respectivement **14/14/22/24 glyphes**, **58/58/120/120 tracés**, **8 914/8 917/15 882/14 764 octets** en lecture initiale. La recherche testée rend **120 UUID exacts par rapport au manifeste**, quinze pages de huit, zéro doublon, page maximale 2 191 octets. Le privé v33 garde ses 1 538/16 217/0 et la même empreinte globale ; scènes 19–20 glyphes, au plus 15 032 octets. Rapports numériques `scene-budget-native-v1.json` et `scene-budget-native-final.log` sous `.runtime/brain/`.

Chrome S100 : quinze pages parcourues, 120 titres distincts égaux au manifeste synthétique, puis détail 09999 complet de 200 000 caractères. Quatre choix de disposition exercés ; capture mobile circulaire clair 320/320, 14 glyphes/43 tracés, et vue En lignes mobile à 24 glyphes. Les changements rapides de disposition ne constituent pas une mesure stabilisée de chaque compteur intermédiaire. Capture inspectée `scale10000-S100/scene-budget-mobile-light.png`, rapport `scene-budget-browser-v1.json`. Lisibilité de toutes les densités, agrégats serrés sur mobile, gestes tactiles physiques et lecteur d'écran restent ouverts.

**Aucune nouvelle mesure p50/p95, froid, concurrence ou mémoire dans cet incrément.** Les performances du build précédent restent datées. Les échecs froid/mémoire S100, mémoire navigateur, M20/M100 et coûts globaux de calcul/droits sont toujours ouverts ; Step 1 reste non qualifié.


## Rapprochement exhaustif S100 — 5 octobre, 03:08 UTC

Le mode `reconcile` existant de `scripts.qualify_brain_scale` termine en lecture seule sur le manifeste gelé S100 : **10 000 concepts/sources exacts, 100 000 relations, 202 publications et 10 000 créations**. Tous les corps, preuves, liens, empreintes, provenance et droits statiques attendus sont comparés ; aucun doublon d’identité ou de création. 200 pages de graphe, 100de sources, 5 de journal ; version 202 et visibilité constantes avant/après. Rapport `.runtime/brain/scale10000-S100/reconciliation-final-20261005.json`, statut completed et domaine passed. Aucune réingestion ni publication.

Exécution 03:05:47–03:08:36UTC, 168,731 s. Continuité valide : trou 3,000 s maximum, divergence 0,003 s sous les seuils 5 s/2 s. Binaire release `b9d1a5e06a07b1ee0d1f2204ad5b2d0887cdbdc0b72636016b8fe3d5c29ae61e`. Charge de fond déclarée : API privée 8013 et consoles, recette synthétique 8011 en lecture seule puis arrêtée ; aucun auteur actif. Pic RSS Rust échantillonné 48 562 176 octets, 667 mesures sans erreur, pour cette exécution séquentielle avec projections existantes. Mémoire navigateur/conteneurs non mesurée. Cette durée totale n’est ni un p95 ni un temps de chargement utilisateur ; aucune nouvelle qualification froid/concurrence.

Le rapprochement complet S100 rejoint celui de S20. **Le Step 1 reste non qualifié** : M20/M100 non publiés, coûts serveur globaux, stabilité des placements après ajouts/retraits, budgets froid/mémoire, parcours frontend et accessibilité restant ouverts. Les anciens échecs 13,078 s et 6,187 Go ne sont pas effacés. La recette Chrome P16 porte séparément sur la reprise de preuve du lecteur par défaut ; elle ne prétend pas parcourir les 10 000 fiches au navigateur.
