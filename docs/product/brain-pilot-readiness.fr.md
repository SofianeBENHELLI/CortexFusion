# BrainMap et Chronique — livraison et préparation au pilote

## Complément courant — audit du 5 octobre, après 17:44 UTC

Le [rapport code/spécification](code-audit-2026-10-05.fr.md) et le [plan actualisé](roadmap.md) prennent priorité pour les travaux restants. **Le produit n’est pas qualifié de bout en bout.** Les ruptures prioritaires concernent l’accès, le parcours owner et les différences entre les lecteurs BrainMap ; les coûts globaux/froids restent à résoudre avant de qualifier 10 000. Depuis le 5 octobre au soir, AUD-02 permet des passages littéraux sourcés de concepts longs sans faux ticket de lacune, vérifiés au natif et dans Chrome sur fixtures synthétiques. Cette correction ne livre pas le retrieval sémantique ni une nouvelle validation du corpus privé. [ADR 0015](../architecture/decisions/0015-bounded-literal-context-passages.md), preuves courantes dans le journal.

Suites relancées : 307 console, 67 Rust bibliothèque, 163 Python ciblés et 11 Node contrats/harness réussis ; typages/build API/contrats réussis. Ces tests ne ferment aucun parcours navigateur supplémentaire : le frontend 5175 n’était pas joignable lors de la sonde. Les recettes et limites de 03:12 UTC ci-dessous restent des preuves historiques. Aucune application ou donnée modifiée par l’audit, aucune clôture UI/UX ; les 29 actions AUD sont ouvertes.

## État courant — 5 octobre, 03:12 UTC

**La navigation du savoir est utilisable en recette locale. Le Step 1 à 10 000 concepts, le pilote biomimétique complet et l’UI/UX restent ouverts.** Cette synthèse remplace les états courants des jalons historiques conservés plus bas. Le [journal](brain-delivery-status.fr.md), la [matrice](frontend-acceptance-matrix.fr.md) et la [roadmap](roadmap.md) précisent les preuves et les travaux restants.

| Sujet | Livré et vérifié | Limite actuelle |
|---|---|---|
| Savoir OKF privé | 1 538 concepts et sources publiés, version 33, 33 publications, 16 217 références documentaires ; fiches, liens et preuves lisibles dans Chrome | Aucune relation Cortex déduite ; validation sémantique des références et gestionnaire d’import connecté ouverts |
| BrainMap par défaut | Caméra continue, quatre dispositions, concepts et liens navigables, recherche, texte intégral et provenance | Métadonnées globales chargées ; stabilité après ajout/retrait et signaux temporels agrégés incomplets |
| Variante progressive optionnelle | Scènes serveur limitées à 24 glyphes, 120 tracés et 64 Kio ; pages de 16 concepts/voisins et de 8 résultats de recherche ; période, événements et preuves synchronisés | Entrée encore optionnelle ; vérifications et calculs serveur globaux ; regroupements sans signaux temporels |
| Changements | Créations, poids avant/après, contenu et retraits explicitement publiés ; traits actuels reliés au journal | Couverture déclarée, aucun delta net inventé, aucune topologie historique reconstruite ; retrait ≠ archivage |
| Reprise et confidentialité | Refus de preuve 401/403/409 : données précédentes masquées ; reconnexion conservant l’URL, sessions et cache vidés, lectures fraîches | 401 vérifié dans Chrome pour les deux lecteurs ; autres refus et retard aussi en composants. Pas de nouvelle révocation d’ACL |
| Complétude à 10 000 | S20 et S100 rapprochés au natif ; S100 : 10 000 concepts/sources, 100 000 relations, 202 publications et 10 000 créations exacts | M20/M100 non publiés, budgets froid/mémoire et couverture frontend complète non qualifiés |
| Biomimétisme | Les observations de publications existantes sont explicites | Mémoire active et transferts, archivage/réactivation et sommeil durable BRN-05–07 non construits |

**Validation récente : 307 tests console dans 41 fichiers, TypeScript et builds API standard/instrumenté réussis.** P01–P16 recensent 16 parcours : 8 validés dans leur portée, 8 partiels. Les 50 parcours historiques (45 validés, 4 partiels, 1 bloqué) et S01–S11 constituent des ensembles distincts et datés ; ils ne sont pas additionnés. Les preuves Rust (67 tests) et contrats (99 tests) restent celles du précédent incrément, sans modification native ici. Les tests de composants ne remplacent pas Chrome.

Chrome couvre des recettes ciblées en clair/sombre, bureau et 390/320 px : recherche et pages, concept → lien → source, Chronique → relation → preuve, retour et focus, conflits et session expirée. Le dernier correctif du lecteur par défaut conserve le zoom à 320 % après actualisation, masque le contenu après 401 et retrouve la même fiche. Sur mobile : page 390/390 px, preuve 300/300 px. Le parcours privé final confirme les stocks et la lecture d’une preuve ; aucun texte privé exporté. Espace et Échap fonctionnent sur la liste des signaux ; l’activation par Entrée via l’outil reste non résolue. Lecteur d’écran et gestes tactiles physiques non qualifiés.

Les lectures chaudes mesurées précédemment sont décrites dans le [rapport 10 000](brain-scale-10000.fr.md). Le rapprochement S100 de 03:08 valide la fidélité des données et leur historique, pas une performance de production. Les échecs antérieurs à froid (13,078 s) et de mémoire du moteur (6,187 Go, OOM) restent ouverts. Les plafonds de réponse ne prouvent pas un calcul serveur borné.

**Priorités de reprise :** calcul et agrégation serveur sous droits, changements temporels sur regroupements et placements persistants ; qualification M20/M100, froid, mémoire, frontend et accessibilité ; import connecté et revue des références ; mécanismes réels BRN-05–07. La variante progressive reste optionnelle jusqu’à ses critères de parité et d’acceptation.

**La fenêtre autonome est terminée depuis le 5 octobre à 03:39 UTC (05:39 Paris).** Bilan à 03:57 UTC et automation de réalisation mise en pause. Les API locales8011/8012/8013 sont arrêtées ; Vite5175 et previews5177/5178 servent toujours les interfaces. Les données et clés persistantes sont conservées ; aucun redémarrage après l’échéance. Aucun nouveau test ou build : les preuves ci-dessus gardent leur date. Aucun déploiement, push, PR, appel modèle ou publication externe ; corpus OKF hors Git, assets et logs. UI/UX non clôturée ; Représentations différées et scénario Bob toujours exclu sans son accord spécifique.

## Historique — jalons du 3 et du 4 octobre

Les tableaux et indications de processus ci-dessous décrivent les états datés de ces jalons, pas la situation courante ci-dessus.

**Mise à jour du 4 octobre, 01:15 UTC : les 1 538 fiches OKF identifiées sont publiées et rapprochées dans Cortex privé.** 1 538 sources exactes, 33 publications, 16 217 références candidates conservées, aucune cible manquante. I08 vérifie les stocks, la couverture partielle/complète du journal, ses 39 pages et une preuve du dernier lot. Protection des fichiers runtime sur les serveurs Vite corrigée et vérifiée ; lecture individuelle ciblée avec droits inchangés, cinq observations locales de 3,6 s à 8–26 ms. **243 tests console et 55 Rust passent** ; suites Python ciblées et contrats cohérents détaillés dans le journal. **Zéro relation du corpus déduite automatiquement** : revue sémantique toujours ouverte. Le protocole et les quatre jeux 10 000 sont prêts ; leur publication, mesure et recette restent à faire. Aucun contenu OKF dans Git. Ces résultats ne clôturent ni le Step 1 ni l’UI/UX.


**Mise à jour du 4 octobre, 00:28 UTC : les 26 fiches longues sont publiées intactes ; le savoir privé atteint 35 concepts/35 sources/v2/deux publications.** Revue répétée sans doublon. Contrat Concept jusqu’à 200 000 caractères, lots bornés en octets et preuves inchangées ; parsing de fichiers encore limité à 30 000. I07 vérifie au navigateur le texte synthétique de 200 000 caractères et le texte privé et sa preuve exacte de 173 226 caractères. Recherche corrigée : titre exact prioritaire, curseurs classés et droits vérifiés au natif sur 17 concepts. **55 tests Rust, 127 Python et 236 console passent**, builds mock/API réussis. [ADR 0010](../architecture/decisions/0010-intact-long-concept-bodies.md). **1 503 fiches restantes et 16 217 références candidates en attente** ; import connecté et qualification 10 000 ouverts. Aucun contenu OKF dans Git.


**Mise à jour du 3 octobre, 23:18 UTC : les différences publiées de la Chronique utilisent désormais des lectures ciblées.** I06 confirme l’écran combiné, les 360 événements et une preuve exacte lorsque le moteur synthétique est inaccessible et la projection déjà préparée. Les états avant/après et les droits statiques passent une recette native de cinq publications, ainsi que les huit différences du jeu 180. **53 tests Rust passent** ; aucun frontend modifié, les 235 tests console restent historiques. Migration privée 0026 et redémarrage effectués après sauvegarde : 37 tables métier, neuf concepts exacts et clés inchangés ; v1/neuf concepts/une publication revérifiés au navigateur. [ADR 0009](../architecture/decisions/0009-targeted-publication-differences.md). Ingestion complète, exceptions longues et qualification 10 000 restent ouvertes.

**Mise à jour du 3 octobre, 22:25 UTC : fenêtres de carte et fiches individuelles disposent d’un modèle de lecture SQL vérifié.** Les lectures déjà préparées ne chargent plus tous les textes du graphe dans Rust. Recettes réelles : couverture 180/180 et droits statiques sur six concepts/trois visibles, deux versions, absence de résultat fabriqué après panne à froid, RLS et reprise après verrou SQL. I05 rejoue le parcours navigateur et sa récupération. **53 tests Rust réussis** ; les 235 tests console du lot précédent restent le dernier résultat frontend, aucun code frontend changé ici. La Chronique conserve ses lectures intégrales et empêche la disponibilité de l’écran combiné lorsque le moteur est hors ligne. Aucune qualification 10 000 nouvelle. La migration additive 0026 est appliquée uniquement à la base synthétique ; l’espace OKF privé attend encore migration et redémarrage contrôlés.

**Mise à jour du 3 octobre, 21:27 UTC : le transport des snapshots dépasse désormais 4 Mo au total grâce à des échanges bornés et paginés.** Recette gouvernée synthétique : 180 concepts longs, 180 relations cycliques, huit publications, 7 259 040 octets JSON, 360 événements visibles dans BrainMap/Chronique. Identités réconciliées sur quatre pages ; recherche hors page, relation et preuve de 30 000 caractères vérifiées au navigateur. Aperçu compact et lecture intégrale au clavier ajoutés aux longues fiches, contrôlés sur mobile clair et desktop sombre. **53 tests Rust, deux tests moteur réel et 235 tests console passent**, ainsi que les builds mock/API. [ADR 0007](../architecture/decisions/0007-paged-snapshot-transport.md), I04/UX-23 dans la matrice. Le serveur charge encore le graphe entier : ce jalon ne qualifie ni 10 000 concepts ni la concurrence. Le nombre de fiches OKF publiées reste neuf.

**Mise à jour du 3 octobre, 20:37 UTC : neuf fiches du bundle sont désormais publiées dans un espace Cortex privé persistant.** Source → proposition → approbation → publication → relecture exacte ont été vérifiées, puis BrainMap/Chronique et une preuve au navigateur, desktop/sombre et mobile/clair. Nouvelle revue identique sans doublon : neuf sources, une proposition, un commit, une publication. Préparation et garde de reprise : **35 tests Python passés**. Détails dans le [journal](brain-delivery-status.fr.md) et la ligne I01 de la [matrice](frontend-acceptance-matrix.fr.md).

La troisième fenêtre autonome est active du **3 octobre 19:58 UTC au 4 octobre 07:58 UTC (09:58 Paris)**. **Le bundle doit devenir du savoir Cortex et le Step 1 cible 10 000 concepts**, selon le [plan actualisé](roadmap.md#step-1-decisions--3-october-2026). Le manifeste privé couvre les 1 538 fiches et 16 217 références candidates ; Les 1 538 corps identifiés, dont les 26 hors ancienne limite, sont maintenant publiés et rapprochés. Aucune relation du bundle n’est publiée. Le gestionnaire d’import connecté et la qualification 10 000 restent à livrer. Identité locale privée, pas de SSO d’entreprise intégré. Contenus, manifestes et reçus OKF **hors Git** ; aucun appel à un fournisseur de modèle.

Les sections suivantes conservent le bilan de la seconde fenêtre : ses 234 tests console et 50 parcours sont historiques ; le nouveau résultat 243 et les parcours I01/I04–I08 sont décrits ci-dessus. L’espace privé sur 8013/5175 et ses volumes persistants sont distincts des fixtures synthétiques. Son runtime a été migré à 23:15 UTC puis relancé le 4 octobre à 01:08 UTC ; les anciennes mentions de migration en attente décrivent les jalons antérieurs.

**Bilan final de la fenêtre au 3 octobre 2026, 13:58 UTC : BrainMap et Chronique sont utilisables pour une démonstration et une recette locale encadrées. Le pilote biomimétique complet et l’utilisation en production ne sont pas qualifiés.** Les parcours exposés ont été inventoriés, exercés dans le navigateur et corrigés ; mémoire active, archivage/réactivation et sommeil durable restent à construire.

La seconde fenêtre autonome, autorisée de **05:57 à 13:57 UTC (15:57 Paris)**, est terminée. La reprise de 13:58 est limitée au bilan ; la pause de l’automation est confirmée à 14:01 UTC. Ce document consolide les résultats acquis jusqu’à 12:20, la stabilisation documentaire et le contrôle final des 77 empreintes inchangées ; aucun test/build n’a été relancé ni travail applicatif ouvert après l’échéance. Ce bilan ne clôture pas l’UI/UX. La première fenêtre du 2 octobre 14:19 au 3 octobre 02:19 est conservée dans le [journal de livraison](brain-delivery-status.fr.md). Le [plan BRN-01–08](roadmap.md#brain-experience-delivery-plan) et la [matrice de recette](frontend-acceptance-matrix.fr.md) restent les références de périmètre et de preuves.

## Couverture de recette

| Mode / parcours exposés | Recensés | Validés dans leur scénario | Partiels | Bloqués |
|---|---:|---:|---:|---:|
| Démonstration locale | 20 | 19 | 1 | 0 |
| BrainMap et catalogue partagé | 10 | 9 | 1 | 0 |
| Console API réelle sur données synthétiques | 20 | 17 | 2 | 1 |
| **Total** | **50** | **45** | **4** | **1** |

Une ligne peut couvrir plusieurs contrôles d’un même parcours. Ce tableau ne mesure pas toutes les combinaisons et exclut les six capacités absentes C01–C06 et les écarts de parité mock/API. Il ne signifie donc ni « 90 % du produit terminé » ni « toutes les fonctionnalités validées ».

Les quatre parcours partiels concernent la dictée audio réelle (M20), l’accessibilité complète avec lecteur d’écran (B10/A18) et les droits modifiés pendant une lecture (A06). A07, retrait de Bob des deux domaines de l’ancienne fixture, attend l’autorisation spécifique demandée par l’auto-review ; aucune nouvelle tentative ni cible de substitution. Les droits existants et l’invalidation de lectures ont des preuves séparées, qui ne remplacent pas A07.

## Ce qui est disponible

| Capacité | Démonstration et corpus local | Mode connecté | Limite déterminante |
|---|---|---|---|
| BrainMap + Chronique | Même écran, noir/blanc/gris, thèmes clair/sombre | Carte et événements publiés partagent sélection/période | Pas de caméra cartographique continue |
| Zoom et regroupement | Corpus : 9 territoires, 51 familles, subdivisions jusqu’à 24 fiches par feuille | Domaine → voisinages → concepts, pages et recherche autorisées | Regroupement serveur stable entre versions non construit |
| Macro-connexions | Références explicites regroupées entre territoires/familles | Relations dans les fenêtres chargées | Pas de macro-projection jointe entre domaines |
| Vue d’ensemble | Catalogue distinct du cerveau mock | 6 domaines par page, stocks/versions indépendants | Totaux de la page uniquement ; pas d’instantané global |
| Changements et frise | Événements des publications mock depuis instrumentation | Créations, contenu, poids explicites, marqueur principal, retraits | Aucun apprentissage ou poids automatique déduit |
| Historique | Le catalogue n’a pas d’historique fabriqué | 20 publications, option jusqu’à 100 ; continuation | Couverture complète seulement si tout le périmètre accessible a été parcouru et daté |
| Sources | Texte exact du corpus et provenance conservés | Texte/empreinte/positions Unicode relus avec droits actuels | Les références du corpus ne sont pas des relations Cortex validées |
| Reprise de navigation | URL, retour, thème et corpus conservés | Domaine/sélection/profondeur restaurés après reconnexion | Jeton uniquement en mémoire ; pas de SSO/renouvellement automatique intégré |
| Mémoire court terme | Capacité affichée comme non instrumentée | Non construite | Propositions en attente ≠ mémoire court terme |
| Archivage/réactivation | Statut `deprecated` attribué au corpus | Cycle gouverné non construit | Retrait publié ≠ archivage ; aucune réactivation implicite |
| Sommeil/consolidation | Pas de résultats simulés présentés comme mesurés | Orchestration durable non construite | Pas de suivi réel de phases, dette ou effets de sommeil |

Au bilan de 13:58, le bundle OKF était consultable séparément : **1 538 fiches, 16 217 références**, statuts déclarés préservés, sans publication Cortex. Le premier lot réel postérieur est décrit en tête de ce document ; le catalogue d’origine reste conservé. Les textes restent privés et aucun fournisseur de modèle ne les a traités dans ces travaux.

## Preuves actuelles et portée

| Preuve | Résultat vérifié | Limite |
|---|---|---|
| Console | **234 tests / 30 fichiers passés**, builds TypeScript/Vite mock et API réussis | Aucun test de composant ne remplace la recette navigateur ; suite Rust non relancée pour les seuls changements frontend |
| Navigateur | Desktop et 320/390 px, clair/sombre, clavier, erreurs, sources, filtres, pages, rechargement et reprise | Recette bornée dans le navigateur disponible ; pas de certification multi-navigateurs, audio ou accessibilité |
| Graphe connecté | **1 000 concepts, 1 000 sources, 2 019 relations, 20 publications**, preuves et pagination vérifiées | Jeu synthétique déterministe, snapshot complet encore chargé côté serveur ; pas de charge concurrente ou de seuil de production |
| Chronique | **3 019 événements**, aperçu de cinq puis pages de quarante ; dernière page de dix-neuf, filtres et sélection synchronisés | Couverture historique bornée ; regroupement serveur et comparaisons exhaustives absents |
| Réponse perdue après commit | Feedback enregistré puis réponse supprimée ; même payload et même reçu au réessai ; SQL **un retour/un ticket avant et après** | Qualifié pour ce feedback, pas pour chaque mutation ; intention locale perdue après rechargement |
| Lectures en vol | Changer de domaine pendant lecture du graphe, de preuve ou reprise de version affiche seulement le nouveau périmètre | Pas d’instantané transactionnel global multidomaine |
| Récupération UI | Module manquant → message de reprise → module restauré → rechargement effectif ; lien malformé → retour sûr à l’accueil | Frontière racine observée sur copie isolée ; garde d’URL limité aux serveurs locaux Vite |
| Corpus privé | **1 538 fiches / 16 217 références**, regroupements, recherche, sources et refus d’import conservant l’ancien corpus | Aperçu local, ni ingestion ni publication de ce corpus dans le backend |

Le [rapport du jeu connecté](brain-scale-1000.fr.md) donne les mesures et leur méthode : p95 HTTP local chaud **178–193 ms**, vingt lectures par cas. Elles excluent le rendu navigateur, le démarrage à froid et la concurrence. Une observation de mémoire Rust n’est pas un pic ni la consommation complète de la pile.

Les corrections UX couvrent notamment le contexte des opérations asynchrones, les brouillons, les refus définitifs, le retour de focus, l’accès à la carte et aux conversations, les textes longs, la pagination de la Chronique et l’actualisation des tickets. UX-01–22 sont détaillés dans la matrice, avec leurs preuves et limites ; la dictée est couverte par simulation, pas par un microphone réel.

Les preuves backend de la première fenêtre restent datées : suite de bibliothèque Rust de 42 tests au lot graphe, recettes HTTP/MCP avec PostgreSQL/TerminusDB, publication de 30 concepts/870 relations, contrôle de preuves et de visibilité. Elles ne sont pas additionnées à la suite console actuelle et ne constituent pas une réexécution générale récente.

Une ancienne preview a échoué à charger un module après recompilation sous un onglet resté ouvert ; la récupération a été vérifiée séparément. Les avertissements de migration React Router restent présents en développement. Aucun bilan « zéro erreur sur toute la session » n’est revendiqué.

## Budgets et limites actuelles

- Fenêtre du graphe : 24 résumés par défaut, 50 maximum, 120 relations internes maximum ; détails à la demande. Depuis le lot de 21:27, écriture moteur par lots de 1 000 000 octets/128 documents, lectures immuables paginées et transport toujours borné à 4 000 000 octets par échange. Garde globale distincte de 64 000 000 octets canoniques/100 000 concepts, sans promesse de capacité. Depuis le lot de 22:25, les fenêtres et détails déjà préparés utilisent le modèle SQL ; la construction à froid et les lectures héritées/journal conservent le graphe entier. Les agrégats/droits/verrous SQL parcourent le domaine, avec garde par instruction 5 s et attente de verrou 2 s, sans qualification de mémoire globale ou de débit. Voir ADR 0008.
- Journal étendu : cinq pages serveur au maximum, quatre différences en vol, 1 000 000 octets par réponse contrôlée, 8 000 000 cumulés, 10 000 événements dérivés ; annulation demandée après 45 secondes. Un morceau déjà reçu peut dépasser la borne avant arrêt. Ni trafic total ni mémoire serveur ne sont qualifiés par ces budgets.
- Différences : les corps sont remplacés par leurs empreintes, mais les ensembles de relations restent denses et non paginés. Sur la fixture dense : 100 719 → 100 179 octets ; sur une modification de corps long : 38 494 → 6 762 octets. Le gain dépend des données.
- Chargement API : plus gros chunk JavaScript **188,11 kB** après découpage, contre 507,00 kB ; entrée + connexion **211,56 kB**, hors CSS/polices. Aucune latence utilisateur p95 n’est établie.
- Les 3 019 événements du jeu connecté sont rendus par pages de quarante (cinq lignes en aperçu), avec accès direct à la page. Cette borne de rendu ne réduit pas à elle seule le coût de collecte du journal.
- Les relectures de version/visibilité/droits bornent l’observation sans former une transaction globale. Un résultat refusé ne doit pas conserver les données précédentes à l’écran.

## État des lots et complétude

| Lot | État réel | Ce qui empêche de le déclarer complet |
|---|---|---|
| BRN-01 — Sémantique et contrats | Partiel | Contrats des mécanismes biomimétiques et agrégats complets encore à définir/implémenter |
| BRN-02 — BrainMap et Chronique | Partiel | Navigation par niveaux/pages ; caméra continue et stabilité générale des groupes entre versions absentes |
| BRN-03 — Observation connectée | Partiel | Observation de domaines autorisés disponible ; projection jointe multidomaine absente |
| BRN-04 — Échelle et historique | Partiel | Fenêtres et lecture bornée disponibles ; agrégats serveur, périodes comparables complètes, grands volumes et concurrence non qualifiés |
| BRN-05 — Mémoire et dynamique | Non construit | Sélection active versionnée, activations, transferts et politiques automatiques |
| BRN-06 — Archive et réactivation | Non construit | Cycle gouverné conservant identités, preuves et historique ; un retrait n’est pas une archive |
| BRN-07 — Sommeil et consolidation | Non construit | Cycles durables, phases, budgets, reprise et effets mesurés |
| BRN-08 — Recette et pilote | Partiel | Quatre parcours partiels, un bloqué, parité et exploitation à compléter ; dépend aussi de BRN-04–07 |

La console API lit les propositions et prépare certaines décisions MCP ; l’approbation/publication des recettes passe par un hôte ou le script gouverné. Import de sources, administration des rôles, édition générale des relations, génération par modèle et dictée ne sont pas tous raccordés à cet écran. La [table de parité](frontend-acceptance-matrix.fr.md#parité-entre-démonstration-et-mode-connecté) détaille chaque écart. Une capacité backend sans écran n’est pas classée testée en frontend.

## Reprendre et montrer le résultat

La console locale de démonstration et son catalogue sont sur [BrainMap local](http://127.0.0.1:5173/views/brain?mode=overview&corpus=local). Le catalogue reste lié à cette origine et à ce navigateur. Sur un autre appareil, préparer et charger à nouveau le fichier privé ; ne pas le placer dans les assets publics.

Parcours conseillé : vue des territoires → Offres & produits → famille dense → sous-groupe → fiche → références → source → Échap → retour au bouton source. Rechercher SIMULIA permet aussi d’atteindre directement une fiche. Ce parcours montre le corpus, pas un cerveau déjà alimenté par son ingestion.

Pour la recette connectée, les fixtures de recette ont été arrêtées ; leurs identités temporaires ne doivent pas être réutilisées. Le port 5174 est une console, pas un backend. Repartir d’un répertoire de fixture neuf, uniquement dans l’environnement synthétique isolé préparé pour cette session :

```sh
. .runtime/brain/env.sh
.venv/bin/python scripts/brain_browser_fixture.py serve --synthetic-only --directory .runtime/brain/browser-next
```

Le script refuse un répertoire contenant déjà un `state.json` de fixture et s’arrête après une heure au maximum. PostgreSQL/TerminusDB et le binaire Rust doivent être disponibles. Dans un second terminal, l’action `session` avec le même répertoire fournit les identités temporaires à saisir dans la console ; ne pas copier ces jetons dans Git ou un document de livraison. Les [instructions de recette](../frontend-real-acceptance.fr.md) décrivent les variantes v25 et multidomaine ; le [guide API](../../apps/console/API-INTEGRATION.md) décrit le proxy et les droits. Ne pas relancer une révocation bloquée en la substituant à une autre fixture.

Ne redémarrer les serveurs Vite que s’ils ne tournent plus :

```sh
npm run dev --prefix apps/console
VITE_DATA_MODE=api CORTEX_API_TARGET=http://127.0.0.1:8011 npm run dev --prefix apps/console -- --port 5174
```

Les builds de recette restent disponibles sur 5180 (mock) et 5181 (API en lecture avec ces fixtures). Les mutations de la recette connectée utilisent 5174, seule origine autorisée par les fixtures. Une console API ouverte ne signifie pas qu’un backend est actif. Ne pas élargir CORS pour contourner un refus.

Les changements de connaissance de la fixture passent par les API gouvernées. Le parcours de lecture à présenter est : vue d’ensemble → domaine → journal → événement → carte → preuve → retour/reconnexion. Toute couverture partielle doit rester visible pendant la démonstration.

## Conditions avant d’élargir l’usage

1. **Recette restante et exploitation.** Compléter le lecteur d’écran et les appareils/navigateurs visés, qualifier la dictée avec consentement, reprendre A07 uniquement après accord spécifique. Préparer identité d’entreprise, livraison cohérente des assets, sauvegarde/reprise et mesures opérationnelles. Les états de session et intentions non durables doivent être compris avant usage réel.
2. **Ingestion réelle et volume du Step 1 (BRN-01–04/08).** Faire du bundle un savoir Cortex sourcé, revu et publié, avec rapprochement complet des 1 538 fiches et 16 217 références candidates, reprise sans doublon et parcours d’import connecté. Remplacer le chargement global par des lectures et agrégats adaptés ; maintenir les groupes entre versions et compter les macro-liens sous droits. **10 000 concepts constituent désormais le seuil de qualification obligatoire du Step 1**, frontend compris ; 100 000 reste ultérieur. Les jeux synthétiques de volume restent séparés du savoir métier du bundle. Aucune capacité supérieure n’est déduite du résultat à 1 000.
3. **Mémoire et archive (BRN-05/06).** Construire les mécanismes avant d’ajouter leurs KPI : sélection active indépendante de la maturité, causes et poids avant/après, archivage/réactivation gouvernés, sources/historique conservés. Ces lots peuvent avancer après le socle connecté sans attendre la consolidation.
4. **Sommeil (BRN-07).** Orchestrer seulement les opérations réellement disponibles ; préparation distincte de revue/publication, service du savoir publié, reprise sans doublon et comparaison de qualité mesurée.

Les changements restent locaux sur `feat/frontend-mock`, non commités ; aucun push, PR, déploiement ou partage externe. Le catalogue utilisateur et les modifications préexistantes sont conservés. Les rapports/identités synthétiques restent sous `.runtime`, ignoré par Git.

Ces étapes ne fixent pas de nouvelle date ni n’autorisent un déploiement. Les Représentations restent différées ; leur rappel dépend de la clôture explicite du travail UI/UX, pas de la fin d’une fenêtre autonome.
