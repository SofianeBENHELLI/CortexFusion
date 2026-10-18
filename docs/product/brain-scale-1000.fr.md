# Qualification locale BrainMap — 1 000 concepts

Recette du **3 octobre 2026**, dans la seconde fenêtre autonome. Ce rapport qualifie un scénario synthétique nommé et les parcours effectivement vérifiés. Il ne constitue ni une capacité de production, ni une qualification à 10 000/100 000 concepts, ni la clôture de BRN-04/08.

## Jeu et environnement

- **1 000 concepts, 1 000 sources individuelles, 2 019 relations associatives, 20 publications gouvernées**, savoir accepté/publié v20. Corps courts, avec accents et emoji ; preuves de 87 caractères Unicode.
- Vingt groupes de 50 concepts : deux liens sortants circulaires par concept, vers les positions +1 et +7. Dix-neuf liens supplémentaires relient le premier concept d’un groupe au premier du groupe précédent. Aucun lien inter-domaine. Titres Échelle 0000…0999 et identifiants déterministes ; sources/propositions/tenant isolés à chaque préparation.
- Préparation par les API existantes, sources puis propositions de 50 changements, revue signée et publication distincte : **105,699 secondes** sur cette exécution. Aucun plafond natif augmenté. Après préparation, le helper refuse les commandes de mutation pour ce jeu.
- Mac Apple M4 Pro, 12 cœurs physiques, 24 Gio de RAM ; Darwin 25.6.0 arm64, Python 3.12.13. Runtime Rust local en build de développement, PostgreSQL/TerminusDB dans les conteneurs de recette existants, boucle locale. Configuration privée sous `.runtime/brain/`, non suivie dans Git.
- Un relevé ponctuel après les lectures/browser donne **57 248 Kio de RSS** pour le processus Rust, soit environ 55,9 Mio. Ce n’est ni un pic ni une mesure différentielle ; mémoire PostgreSQL, Terminus, navigateur et système non qualifiée.

## Méthode API et complétude

`scripts/measure_brain_api.py` rejoint uniquement une fixture synthétique active sur 127.0.0.1:8011. Il n’effectue que des GET, sans accès direct à la base, retrait de droits, mutation ou remise à zéro de cache. Le runtime est déjà chaud après préparation. Vingt échantillons par cas sont alternés ; un seul appel à la fois. Le relevé final est effectué sans interaction navigateur concurrente de recette, sans prétendre isoler tous les autres processus de la machine.

Le chronomètre englobe l’appel HTTP et la lecture de son corps ; il exclut signature du jeton, parsing JSON et validation du schéma. La médiane est p50, p95 utilise le rang supérieur dans les 20 observations. Les octets désignent le **corps décodé**, sans en-têtes ni surcoût réseau. Aucune latence de rendu navigateur ou de premier chargement à cache froid n’est déduite de ces mesures.

Contrôles de complétude :

- Schémas des fenêtres, publications et différences compactes ; aller/retour des fenêtres épinglées à v20 et à leur empreinte de visibilité.
- Vingt pages de 50 concepts : exactement 1 000 identifiants distincts, titres et degrés entrants/sortants attendus. Relations internes, relations de frontière et arêtes reçues comparées à la topologie déterministe.
- Fenêtre ordinaire limitée à 24 nœuds ; aucune preuve/corps complet dans les résumés. Plafond de 120 arêtes inchangé.
- Recherche exacte d’Échelle 0999, localisation dans sa page et voisinage sortant d’Échelle 0000 : trois concepts, deux relations internes et quatre sortant du voisinage. Le total du périmètre est donc **six relations**, et non seulement les deux traits internes.
- Vingt publications sans continuation, différences auditées couvrant exactement les 1 000 créations et 2 019 nouvelles relations ; empreintes SHA-256, plages des sources, maturité et liens comparés au jeu préparé. Cela vérifie les références publiées ; la recette UI ci-dessous relit une preuve effective, pas les 1 000 textes sources au navigateur.
- Lecture finale identique à la première, version et visibilité inchangées.

Deux assertions du premier script étaient erronées : omission de `direction=outgoing`, puis assimilation des relations du périmètre aux seules relations internes. Elles ont été corrigées selon le contrat, sans changement du serveur. Les premiers essais ne sont pas comptés comme des mesures réussies. Le relevé initial réussi est conservé séparément ; le relevé final ajoute les comparaisons exactes des preuves et de la topologie.

Relevé final terminé à **10:46:44 UTC**, vingt observations par cas :

| Lecture API | p50 HTTP | p95 HTTP | Corps décodé maximum |
|---|---:|---:|---:|
| Fenêtre ordinaire, 24 résumés | 174,0 ms | 178,2 ms | 4 456 octets |
| Recherche exacte Échelle 0999 | 186,3 ms | 192,6 ms | 677 octets |
| Localisation d’Échelle 0999 | 175,8 ms | 183,6 ms | 4 665 octets |
| Voisinage sortant d’Échelle 0000 | 172,1 ms | 181,2 ms | 1 547 octets |

Le parcours complet des vingt pages de 50 concepts représente **187 759 octets** de corps décodés. La fenêtre des publications et ses vingt différences compactes représentent **569 579 octets**, sans compter les autres appels de validation de la console. Le premier appel observé par ce script, déjà après préparation et précédentes lectures, prend 178,1 ms ; ce n’est pas une mesure à froid.

## Parcours frontend et corrections

Recette manuelle par les outils de contrôle du navigateur intégré, sur le build API compilé servi à 5181. Aucune mutation depuis cette origine ; sa protection CORS demeure inchangée.

- Synthèse : stocks 1 000/2 019, version 20, puis domaine → voisinages. Carte de 24 résumés chargés, douze éléments maximum dans une page de rendu ; frontières explicites. Fenêtre serveur suivante et contexte retrouvé après rechargement/reconnexion.
- Chronique : 20 publications, **3 019 événements**, compteur distinct du nombre de publications. Période sans événement : aucun changement, stocks du voisinage conservés (3 concepts/7 relations dans le cas testé).
- Recherche hors page Échelle 0999 → voisinage, détail, source : texte exact avec emoji, plage Unicode 0–87 et empreinte consultés.
- Événement de la seconde page du journal → voisinage 0956/0957/0963, relation et publication v20, focus déplacé vers le détail visible sur mobile.
- **UX-16 : journal non borné.** Avant correction, « Voir les 3014 autres événements » créait 3 019 lignes et 3 020 boutons dans le journal. Après correction : aperçu de cinq événements, pages de **40 lignes maximum**, plage affichée parmi les événements chargés, précédent/suivant et choix direct de page. Le dernier écran 76/76 contient **19 lignes**, plage 3 001–3 019, suite désactivée. Aucun total de période complète n’est inféré de la seule pagination locale. La page locale n’est pas persistée dans l’URL ; un changement de périmètre revient au début.
- **UX-17 : cible connue affichée par UUID.** Le journal lisait les publications récentes avant celles donnant le nom de certaines cibles hors page. Les libellés non résolus sont maintenant complétés après les contrôles d’accès, uniquement à partir du graphe et des différences autorisées déjà chargés. Rejeu réel : Échelle 0950 → Échelle 0900 remplace l’UUID. Une cible absente des lectures conserve son identifiant ; aucun nom deviné ni lecture supplémentaire. Ce libellé de contexte ne constitue pas une reconstruction du titre à chaque version historique.
- 320 px : journal paginé, boutons au clavier et focus Journal synchronisé ; passage à un détail avec focus Détail sélectionné. Largeurs mesurées : document 320/320, conteneur API 305/305, espace BrainMap et journal 279/279, navigation 249/249. Premier essai du sélecteur de page : mot « Page » coupé à 320 px ; largeur corrigée puis capture claire vérifiée, libellé sur une ligne. À 390 px en sombre : document 390/390, API 375/375, journal 349/349 ; retour au clavier 76→75, 40 lignes. Changement de période → aperçu réduit, réouverture page 1, puis réduction → cinq lignes. Aucun avertissement/erreur console dans l’onglet de cette recette. Thème Système et viewport rétablis.

## Reproduction et validations

Commandes réellement exécutées depuis la racine, avec les paramètres de recette locale chargés pour le helper :

```sh
.venv/bin/python scripts/brain_browser_fixture.py serve --synthetic-only --directory .runtime/brain/browser-scale1000-20261003 --duration 3600 --graph-size 1000
.venv/bin/python scripts/measure_brain_api.py --directory .runtime/brain/browser-scale1000-20261003 --samples 20
npm test --prefix apps/console -- --reporter=dot
npm run build --prefix apps/console
VITE_DATA_MODE=api npm run build --prefix apps/console -- --outDir ../../.runtime/brain/console-api-dist --emptyOutDir
```

La préparation refuse de réutiliser un répertoire existant : choisir un nouveau répertoire `.runtime` pour un nouveau jeu. Le helper de cette recette a été **arrêté proprement à 10:50 UTC**, code de sortie 0, après déconnexion des navigateurs ; données conservées, serveur 8011 arrêté. Aucun jeton utilisable ne doit être déduit de ce rapport.

**218 tests / 29 fichiers réussis**, builds mock/API TypeScript/Vite réussis. Un nouveau test reproduit le journal non borné puis vérifie pages, borne finale, accès direct, réduction, focus, changement de période et sélection. Deux cas vérifient le libellé d’une cible présente/absente des preuves déjà chargées. Les échecs initiaux puis succès ciblés sont conservés sous `.runtime/brain/acceptance-{journal-page,late-title}-{before,after}.log`. Dernière correction CSS vérifiée au navigateur et recompilée, sans relance inutile de toute la suite. Ruff des deux scripts et `git diff --check` réussis.

Mesures détaillées : `.runtime/brain/scale1000-api-measurements.json`, relevé initial séparé `scale1000-api-measurements-initial.json`, préparation `acceptance-scale-fixture.log`, suite/builds `acceptance-scale-{full-tests,mock-build,api-build}.log`. Ces fichiers privés restent ignorés par Git. Les captures ont été inspectées dans la conversation ; aucun fichier de capture archivé n’est revendiqué.

## Limites et décision

Les fenêtres bornent le transport, **le serveur charge encore le snapshot complet du domaine**. Les corps sont ici courts, la topologie est peu dense et un seul domaine est utilisé. Ce jeu n’exerce pas un mélange de cycles de vie, de suppressions, de changements de droits ou de poids. Les recettes correspondantes restent suivies dans la [matrice frontend](frontend-acceptance-matrix.fr.md).

La Chronique charge ici environ un demi-mégaoctet de différences compactes ; leur dérivation est bornée à 10 000 événements et par les budgets de lecture existants. La pagination visuelle ne remplace pas les agrégats et filtres serveur de BRN-04. Pas de mesure de pic mémoire frontend, de charge concurrente, de réseau mobile, de cache froid, de lecteur d’écran complet ou de capacité à très grande échelle.

Décision : conserver les plafonds, la séparation mock/corpus/API et les indications de couverture ; utiliser ce scénario comme preuve de non-régression. Une qualification plus grande exige d’abord de traiter le coût du snapshot complet et les agrégations serveur. Les mécanismes BRN-05–07 et les Représentations ne sont pas ajoutés par cette recette.
