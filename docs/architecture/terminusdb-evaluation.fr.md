# CortexFusion — évaluation de TerminusDB et plan de prototype

État au 8 septembre 2026. Décision : prototype isolé autorisé par la nouvelle orientation utilisateur ; adoption du moteur et migration du backend non décidées. Le texte d’origine reste local ; ce document est une analyse d’intégration.

## Avis et corrections à la note

La proposition renforce la thèse produit : gouverner des assertions reliées, avec preuves, évolution et consommation par les agents. CortexFusion possède déjà une partie importante de ce cycle. TerminusDB peut apporter les branches et états historiques natifs ; il ne remplace ni la gouvernance ni les garanties de transport déjà réalisées.

La version étudiée est **v12.0.7**, commit **57f2093baeafd65e16004e84b7b58e0c5cf72858**, récupéré depuis le dépôt officiel. Les [releases officielles](https://github.com/terminusdb/terminusdb/releases/tag/v12.0.7) décrivent cette livraison. Le [fichier LICENSE de cette révision](https://github.com/terminusdb/terminusdb/blob/v12.0.7/LICENSE) porte Apache 2.0 ; cela soutient l’étude commerciale du moteur, sans valider la licence de chaque dépendance, image, service hébergé ou composant optionnel. L’image réellement utilisée doit être identifiée par son digest et faire l’objet d’un inventaire séparé.

Le [guide de merge](https://terminusdb.org/docs/merge-howto/) décrit diff/apply et les conflits de champs. Le prototype s’appuie aussi sur les [tests officiels de diff/apply de cette version](https://github.com/terminusdb/terminusdb/blob/v12.0.7/tests/test/diff-id.js). Il conserve le **commit ancêtre commun immuable**, au lieu de remplacer celui-ci par la tête courante de main : les deux ne sont plus équivalents dès que main évolue. Un merge structurel sans conflit n’atteste pas l’absence de contradiction métier.

Les [permissions documentées](https://terminusdb.org/docs/access-control/) portent sur utilisateurs, rôles et capacités de ressources telles que organisation/base. Leur équivalence avec notre contrôle actuel par preuve n’est pas établie. Aucune URL TerminusDB ni credential moteur ne doit être fourni au frontend ou au companion. Les requêtes historiques doivent respecter les droits actuels ; l’accès à un ancien commit ne doit pas ressusciter des preuves révoquées.

Enfin, un historique immuable de moteur n’atteste pas à lui seul une approbation humaine. L’auteur déclaré, l’identité authentifiée, l’approbateur, le publieur et les dates de validité métier sont des informations distinctes. Un reset de branche n’est pas le rollback métier compensatoire de CortexFusion. Pour une connaissance déjà publiée, conserver l’événement historique et publier une compensation.

## Écart avec le backend livré

| Besoin | CortexFusion actuel | Apport ou travail à évaluer |
|---|---|---|
| Proposer, revoir, différer, approuver | Propositions avec preuves, digest, révision et décisions | Évolution vers KCR, sans casser les IDs ni les parcours existants |
| Publier et reprendre | Publication distincte, ciblée, atomique PostgreSQL, événement publieur, confirmations HTTP/MCP | Publication d’un commit moteur fixé dans un manifeste applicatif |
| Historique et correction | Journal accepté, projection publiée, replay, compensation | Lecture historique de graphe ; branches concurrentes et véritable merge |
| Modèle de connaissance | Concepts sourcés, relations structurelles/associatives, validation verbatim | Atomes sujet/prédicat/objet, contexte et révision métier ; relations avec preuves propres |
| Gouvernance | Rôles par domaine et lecteurs par source | RASCI, obligations de plusieurs domaines, invalidation des approbations après modification |
| Diff | Comparaison avant/après | Interprétation métier, dépendances impactées, règles de contradiction explicites |
| Agents | 79 opérations HTTP exposées en MCP, 95 outils, synthèse bornée et reçus personnels | Recherche de graphe et explication d’un changement de réponse |
| Propagation | Projection et version publiées dans une transaction PostgreSQL | Index dérivés et cache par version, reprise multi-stockages |

Les branches de proposition ne doivent pas devenir des barrières de sécurité. Une vérité partagée à l’intérieur d’un tenant reste filtrée par droits ; aucun graphe commun entre entreprises n’est introduit. La confiance numérique des exemples est un champ hypothétique, pas une probabilité calibrée à intégrer telle quelle.

## Frontière d’architecture proposée

Pendant l’essai, PostgreSQL reste le backend servi au frontend. L’expérience TerminusDB crée uniquement une base synthétique indépendante. On n’ajoute pas deux écritures non atomiques au chemin de publication existant.

Si le moteur est retenu, prévoir une frontière de stockage spécialisée : lire un snapshot fixé, préparer un changement depuis une base fixée, calculer un diff structurel, valider/appliquer ce changement et retourner un identifiant immuable. Le moteur ne décide pas des reviewers, du consentement, de la sémantique de publication ni du droit de voir une preuve. Ces responsabilités restent dans les services métier. L’interface de stockage ne doit donc pas mélanger `approveChangeRequest` et `writeGraphSnapshot`.

Une publication multi-stockages devra exposer un **manifeste de version publiée** : identifiant applicatif, commit de graphe, version du schéma et état des index requis. Préparer le graphe et les index avant de rendre ce manifeste visible ; fixer les lectures sur ses identifiants. En cas de panne entre deux stockages, reprendre par identifiant de commande et maintenir l’ancienne version servie. Une table outbox PostgreSQL ne rend pas une écriture TerminusDB automatiquement transactionnelle. Tester cette frontière avant toute migration.

Les événements de propagation doivent être émis après la publication applicative, avec identifiant stable, ordre par tenant/domaine/version et consommateurs idempotents. Un événement `KnowledgeMerged` interne à une branche ne signifie pas encore `KnowledgePublished` accessible aux agents. Les événements et caches ne doivent pas divulguer les IDs de connaissances privées. Les embeddings sont reconstruisibles et ne portent pas l’autorité métier.

## Premier essai exécutable

[experiments/terminusdb/probe.py](../../experiments/terminusdb/probe.py) cible un moteur HTTP sur loopback et une base fraîche au préfixe `cortex_spike_`. Il refuse une destination distante, les redirections et la répétition automatique d’une mutation incertaine. Il ne supprime aucune base existante et ne lit aucun corpus CortexFusion. Aucun modèle n’est appelé.

Scénario : créer Concept/Evidence/Owner/KnowledgeAtom ; créer une branche ; y ajouter l’assertion X SUPPORTS Y avec preuve ; vérifier main inchangé ; calculer le diff ; appliquer depuis la base immuable ; relire l’état historique ; provoquer deux éditions contradictoires du même champ et vérifier un refus atomique. Une règle Python distincte détecte SUPPORTS/INCOMPATIBLE_WITH pour le même sujet, objet et contexte. Cette règle étroite ne prétend pas être un moteur sémantique complet. Le KnowledgeAtom représente ici une assertion relationnelle ; une classe Relation indépendante et les intervalles de validité restent à concevoir.

Ce scénario teste le moteur, pas l’intégration des approbations CortexFusion. L’absence de relation à T0 signifie « non établi », jamais automatiquement « faux ». La disponibilité à T1 est une observation de données ; aucune qualité de réponse LLM n’en est déduite.

Exécution sur une machine équipée de Docker :

```sh
docker run --rm --name cortex-terminus-spike -p 127.0.0.1:6363:6363 \
  -e TERMINUSDB_ADMIN_PASS=synthetic-spike-password \
  terminusdb/terminusdb-server@sha256:385faf298ad77aaf2d4d6df5e84a4cbe3596d01dab2e3b991af905639ae56388
```

Dans un second terminal du dépôt :

```sh
CORTEX_SPIKE_TERMINUS_PASSWORD=synthetic-spike-password \
  uv run python experiments/terminusdb/probe.py --output /tmp/terminus-probe.json
```

Ce mot de passe public ne sert qu’au moteur jetable en loopback. Le workflow `Synthetic TerminusDB spike` crée le même service éphémère sur le runner CI et consigne le digest réel de l’image. Le premier essai a résolu le tag v12.0.7 ; le workflow et la commande sont maintenant verrouillés sur le digest observé. Cela ne remplace pas l’audit des dépendances de l’image. Aucun déploiement applicatif ni service cloud n’est créé.

## Plan détaillé et critères de décision

1. **Moteur minimal — premier jalon.** Exécuter l’essai sur v12.0.7, conserver version/digest/résultats. Critère : schéma, branche isolée, diff, apply, conflit atomique et lecture historique démontrés sur moteur réel. Les tests simulés du client ne suffisent pas. Ajouter ensuite rebase, schéma divergent et compensation qui crée une nouvelle version.
2. **Modèle atomique — 1 à 2 jours indicatifs.** Définir IDs stables, révision métier distincte du commit, prédicats, contexte, preuves et intervalles de validité. Distinguer assertion, réfutation, exception et manque de preuve. Critère : deux assertions opposées peuvent être légitimes dans des contextes différents ; une modification de contexte ne réécrit pas l’histoire.
3. **KCR et diff métier — 2 à 3 jours.** Réutiliser propositions/revues ; fixer base et tête, afficher ajout/retrait/modification et preuves. Définir les transitions sans renommer brutalement les contrats publics. Critère : un draft ne change aucune réponse publiée ; le diff relu correspond au digest approuvé.
4. **Gouvernance et sécurité — 2 à 3 jours.** Mapper tenant/domaine/source, protéger les historiques, déterminer les approbateurs requis par concepts impactés, invalider une approbation périmée. Critère bloquant : une preuve retirée reste inaccessible via toutes les lectures, diffs, historiques et erreurs. Tester les relations vers des nœuds cachés.
5. **Publication et consommation — 2 à 3 jours.** Prototyper le manifeste, la reprise après panne et les index dérivés. Même question à N puis N+1, changement expliqué par atome/preuve/approbation/publication. Critère : aucun mélange de versions ou double publication après perte de réponse ; compensation traçable ; frontend et MCP utilisent le même contrat métier.
6. **Charge et exploitation — campagne séparée.** Commencer par 10/100 branches, 10 000 commits et un graphe représentatif borné. Mesurer latences p50/p95/p99, RSS, disque, débit, profondeur des couches et coût des rollups. Monter ensuite seulement vers 1 000 branches et les volumes supérieurs. Définir avec la charge produit les SLO et ressources, puis sauvegarde/restauration, panne, upgrade, HA et isolation. Aucun résultat de petite échelle n’est extrapolé à 100 millions de relations.
7. **Décision écrite.** Choisir maintien PostgreSQL, projection TerminusDB secondaire ou moteur canonique de graphe. Exiger les preuves des jalons sécurité/publication/exploitation et un coût de migration chiffré. Pas de fork initial. Toute migration conserve les contrats publics et prévoit une sortie réversible.

Ces durées sont des ordres de grandeur pour un développeur, pas une promesse de tout livrer dans la fenêtre nocturne. Le travail déjà réalisé sur identité, confirmations, feedback, corpus, synthèse et documentation reste réutilisable. Les nouveaux endpoints produit pour atomes/KCR/historique ne seront ajoutés qu’avec contrats HTTP/MCP synchronisés et descriptions françaises ; aucun endpoint du prototype n’est encore exposé au frontend.

## Résultat du premier essai réel

Sept tests locaux passent : séparation des contextes dans la règle sémantique, refus de destinations distantes, refus de redirection et absence de rejeu après timeout. Aucun moteur Docker/Podman/SWI-Prolog n’a été trouvé localement. Le [premier workflow moteur](https://github.com/SofianeBENHELLI/CortexFusion/actions/runs/34172543003) a **réussi** sur Ubuntu avec le conteneur réel. Le serveur annonce 12.0.7, git_hash 57f2093baeafd65e16004e84b7b58e0c5cf72858 et terminusdb_store 0.19.8. Le [rapport machine](../../experiments/terminusdb/result-2026-09-08.json) consigne le digest exact et les sept vérifications. Les six premières exercent stockage/branches/diff/apply/historique/conflit sur le moteur ; la septième est une règle métier Python exécutée dans le même scénario, pas une capacité sémantique native de TerminusDB.

La validation moteur utilise un compte admin sur données jetables ; elle ne prouve pas les contrôles de sécurité CortexFusion. Aucun test de grande charge, HA, restauration, intégration du workflow d’approbation ou publication multi-stockages n’a encore été effectué. Résultat : **poursuivre le prototype**, sans décider encore la migration du backend.


## Extension de l’essai : divergence et compensation

Le scénario est étendu à une branche et un main qui ont chacun changé depuis leur ancêtre commun. Il doit conserver à la fois la modification indépendante du concept sur main et le contexte révisé de l’atome sur la proposition. Puis une nouvelle écriture rétablit le contexte antérieur avec business_version=3, conserve le changement indépendant et laisse la révision métier 2 lisible à son ancien commit. Ce test moteur ne réalise pas le cycle d’approbation d’une compensation CortexFusion. Le premier rapport ci-dessus reste celui du scénario initial. L’extension a réussi sur le moteur réel dans le [workflow34172881646](https://github.com/SofianeBENHELLI/CortexFusion/actions/runs/34172881646) : huit vérifications moteur et une règle Python. Le [rapport distinct](../../experiments/terminusdb/result-divergence-2026-09-08.json) préserve cette différence de périmètre. La CI complète du premier prototype601300f a également validé 514 tests Python et 11 tests Node, ainsi que les démonstrations PostgreSQL/MCP ; le code applicatif n’a pas migré.
