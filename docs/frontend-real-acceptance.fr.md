# Guide d’essai du frontend connecté

Le mode API utilise le backend Rust et son savoir publié. Le mode mock reste une démonstration indépendante : un parcours disponible dans le mock n’est pas automatiquement raccordé au backend.

## Démarrage et session

Depuis la racine du dépôt, après configuration du backend local selon `rust-start.fr.md` :

```sh
VITE_DATA_MODE=api CORTEX_API_TARGET=http://127.0.0.1:8011 pnpm --filter @cortexfusion/console dev --port 5174
```

Le port cible doit correspondre à votre instance ; l’origine `http://127.0.0.1:5174` doit être autorisée exactement côté Rust. Utiliser un JWT Cortex émis par l’autorité configurée et l’identifiant de tenant correspondant. Une clé de fournisseur de modèle ne remplace pas ce jeton. Ne placer aucun secret dans une variable `VITE_*`, Git ou un lien URL.

Le jeton reste en mémoire. Déconnexion/rechargement le retire ; une session invalide propose « Se reconnecter ». Le domaine est sélectionné parmi ceux retournés par `/v1/me`. Les versions acceptée et publiée sont affichées séparément. La préparation du frontend ne provisionne ni identité ni droits.

## Parcours disponibles et critères de recette

| Parcours | Actions | Résultat à vérifier |
| --- | --- | --- |
| Interroger | Créer/choisir une conversation, poser une question | Réponse extractive ou abstention ; version servie explicite ; aucune réponse issue d’un brouillon. |
| Consulter une citation | Déplier la source dans la réponse | Extrait, emplacement et positions ; source accessible selon les droits actuels. |
| Donner un retour | Ajouter un commentaire, choisir Utile/À améliorer | Reçu lié au bon épisode ; une reprise réseau conserve la même intention. |
| Retrouver un ticket | Actualiser les tickets et ouvrir un retour négatif | Réponse historique et sa version ; une ancienne réponse n’est pas recalculée silencieusement. |
| Traiter un ticket | Motif puis prise en charge/résolution/classement/réouverture | Révision et statut relus ; conflit demande actualisation. La résolution du suivi ne publie rien. |
| Préparer un ajout | Choisir une citation, titre et motif | Nouvelle proposition prête, preuve verbatim ; vigilance sur les doublons. |
| Corriger un titre | Charger les concepts publiés, choisir le concept, préciser titre/motif | Même identifiant, preuves et relations conservées ; proposition distincte, aucune publication immédiate. |
| Examiner une proposition | Ouvrir, comparer avant/après, lire preuve et décisions | État, base, révision et comparaison explicites ; avertissement si la base a changé. |
| Préparer une décision | Motif puis préparer la commande MCP | JSON exact pour l’hôte de confiance ; aucune signature ni exécution dans le navigateur. |
| Observer le cerveau | Onglet Cerveau, synthèse/changements, voisinage, événement puis preuve | Savoir publié accessible, même périmètre carte/journal/compteurs ; les changements sont issus des différences auditées, sans événement fictif. |

La première recette BrainMap connectée du 2 octobre a réussi dans le navigateur avec Rust, PostgreSQL et TerminusDB : approbation sans changement publié, publication puis deltas, reprise sans doublon, preuve Unicode, changement explicite de poids et retrait d’une relation. Le lecteur n’a pas accès à la fiche privée ; après révocation de la source au propriétaire, l’actualisation retire aussi le détail et les événements devenus inaccessibles. Le bandeau de version est actualisé depuis la même lecture vérifiée que l’BrainMap.

Le journal connecté est réservé au propriétaire et consulte désormais `publications.list` : 20 publications par page, des plus récentes vers les plus anciennes, avec bornes temporelles et version fixes. Les boutons « Publications plus anciennes/récentes » remplacent la page affichée ; le changement de période revient à la première page. Les compteurs de changements portent sur cette page et leur caractère partiel est visible. Pour un lecteur, il est indiqué « Indisponible », pas « zéro événement ». Une modification de version pendant la lecture provoque une erreur et demande une actualisation ; une erreur d’accès masque la lecture précédente. Le backend peut aussi filtrer certains commits inaccessibles tout en retournant le graphe encore autorisé. La carte utilise des résumés paginés et charge le détail sélectionné à la demande ; le journal utilise désormais `proposals.diff_summary`, qui remplace les corps avant/après par leurs empreintes, conserve les preuves et les liens, et réutilise les mêmes contrôles de droits. Les relations denses restent à qualifier. Les totaux et tendances d’une période complète ne sont pas encore calculés côté serveur. Cette recette d’un domaine synthétique ne qualifie ni la charge ni tous les mécanismes biomimétiques. Voir les preuves dans le [journal de livraison](product/brain-delivery-status.fr.md).

### Reproduire la recette BrainMap synthétique

`scripts/brain_browser_fixture.py` prépare un tenant neuf dans une base locale dédiée dont le nom se termine par `_test`. Il refuse une autre cible et ne charge aucun fournisseur de modèle. Utiliser l’environnement de recette isolé avec les migrations appliquées et le binaire Rust compilé, puis :

```sh
python scripts/brain_browser_fixture.py serve --synthetic-only --directory .runtime/brain/atlas-recipe
```

Le serveur s’arrête au bout d’une heure au maximum. Dans un autre terminal, la même commande avec l’action `session` fournit les sessions synthétiques temporaires d’`alice` (propriétaire) et de `bob` (lecteur). Ne jamais conserver ces jetons dans Git. Avec le même répertoire, les actions `stage`, `publish`, `strengthen`, `remove` puis `revoke` produisent respectivement une approbation non publiée, une publication, un poids augmenté, un retrait de relation et une révocation de source. Rejouer `publish` immédiatement après sa première exécution vérifie l’idempotence. Actualiser l’BrainMap entre les étapes. Sur une autre fixture neuve, `seed-history` produit 25 publications pour tester les pages récentes (20 puis 5 publications), les preuves et le retour à la première page lors d’un changement de période. Ce script pilote uniquement des données synthétiques et n’automatise pas le navigateur.

## Ce qui reste séparé ou incomplet

- La signature et l’exécution des décisions de proposition se font par l’hôte de confiance. Le frontend prépare les commandes de revue, pas un service de signature automatique. Approbation et publication restent deux actions distinctes.
- La correction du corps sourcé et des relations n’est pas éditable dans ces nouveaux formulaires. La référence ticket dans un motif n’est pas une liaison structurée automatique d’historique.
- La recherche actuelle est lexicale. Elle peut s’abstenir sur une formulation française pourtant couverte par une source anglaise. Les expérimentations locales de traduction/sélection ne sont pas activées dans le produit.
- Les imports, l’administration complète, le streaming et la parité visuelle avec le mock ne doivent pas être déduits de ces parcours. L’écran connecté demeure un espace fonctionnel de recette.
- Une intention de reprise est conservée en mémoire seulement : recharger la page la perd. Les reçus et décisions confirmés restent côté serveur.

## Niveau de vérification

Les tests de composants emploient des fixtures synthétiques et contrôlent les routes contre OpenAPI. Les tests Playwright du mock valident la démonstration, pas le corpus réel. Des recettes locales séparées ont exercé réellement Rust/PostgreSQL/TerminusDB à travers le navigateur : question/citation/feedback, consultation de propositions, historique de revue, tickets et correction de titre. Les fichiers de recette du corpus restent privés.

La revue Computer Use a vérifié l’écran de connexion, l’erreur 401 et le retour au formulaire, puis la première tranche BrainMap authentifiée et son rendu mobile à 390 px. Cela ne constitue pas une revue visuelle complète de tous les écrans authentifiés et de leurs variantes.

Voir aussi `frontend-issues.fr.md`, `frontend-proposals.fr.md`, `extractive-retrieval.fr.md` et `coordinated-restore.fr.md`.

## Fenêtre du graphe BrainMap — contrat et adaptation UI intégrés

L’entrée « Vue d’ensemble BrainMap » présente les domaines accessibles, six par page, avec leurs stocks et versions indépendantes. La recette `brain_browser_fixture.py serve --synthetic-only --domain-count 8 --directory .runtime/brain/...` fournit un domaine non publié v0, des domaines v1, un domaine v2 et une preuve privée. Parcourir les deux pages, ouvrir Recherche, choisir son événement et relire sa preuve ; vérifier ensuite le retour à la page initiale et la restauration du domaine/sélection après rechargement et reconnexion. Le lecteur voit zéro concept dans Support, dont la preuve est privée, et un historique indisponible. Desktop sombre et mobile clair à 390 px ont été vérifiés. Les tests synthétiques couvrent aussi une lecture partielle, une identité expirée et la réduction du répertoire. La révocation réelle de deux accès de la fixture via `revoke-viewer-page` n’a pas été exécutée : l’auto-review exige une autorisation spécifique, actuellement demandée. Ce cas ne constitue donc pas une preuve navigateur acquise.

La recette `scripts/verify_graph_window.py --synthetic-only --output .runtime/brain/graph-window-http-report.json`, avec l’environnement local de test, publie 30 concepts et 870 relations par le runtime réel. Elle vérifie résumés sans corps/preuves, pagination, stocks autorisés, troncature explicite des relations, voisinage, rôles, tenant, publication concurrente, révocation d’accès et parité MCP. Le backend et les contrats ont passé cette recette, y compris retour, positionnement, recherche autorisée et centre conservé. La console utilise maintenant `graph.window` et `concepts.read` sur sélection.

Recette de navigation : ouvrir un domaine de plus de 24 concepts, comparer les stocks aux éléments chargés, parcourir « Concepts suivants/précédents », rechercher un concept hors page et ouvrir sa preuve. Dans un voisinage, le centre reste présent sur chaque page ; la Chronique porte sur tous ses membres autorisés. Sélectionner une relation hors page doit positionner sa cible. Après une nouvelle publication ou un changement de visibilité, une ancienne continuation est rejetée et la lecture précédente masquée ; actualiser pour relire les droits et la version. Le contexte spatial survit au rechargement du lien, après reconnexion. Les curseurs anciens du journal restent propres à la session. Les capacités 10 000/100 000 concepts ne sont pas qualifiées ; le snapshot reste chargé entier et sa préparation est plafonnée à 4 000 000 octets encodés. Voir [ADR 0003](architecture/decisions/0003-bounded-graph-windows.md).

Si le centre du voisinage devient absent ou inaccessible, « Actualiser le cerveau » revient à la synthèse du domaine après une nouvelle lecture autorisée et vérifiée. Un message explique ce retour et l’URL perd le focus périmé. Un refus 401/403, un conflit 409 ou une demande explicite de détail introuvable reste un refus ; aucune ancienne lecture n’est réaffichée.

Recette du marqueur principal : dans une fixture locale synthétique à deux concepts, exécuter `primary-on`, puis `primary-off` avec `scripts/brain_browser_fixture.py --synthetic-only --directory ...`. Après chaque publication et actualisation, « Relation principale modifiée » explique non → oui puis oui → non ; les stocks restent 2 concepts/1 relation et le compteur de renforcements reste à zéro. Le détail d’un événement conserve son marqueur historique, même si le lien courant a changé. `retire-target` puis `retire-origin` peuvent ensuite exercer la reprise après retrait et la relecture des preuves historiques. Ces recettes ont été vérifiées au navigateur ; elles ne démontrent aucune politique automatique de poids ou d’archivage.


## Frise temporelle synchronisée

Le 2 octobre, recette navigateur CUA contre Rust/PostgreSQL/TerminusDB : une première publication donne 3 événements (2 concepts, 1 relation) dans la frise. Sélectionner son intervalle au clavier, ouvrir la relation puis la preuve Unicode 0–92. Sélectionner un intervalle vide masque les deltas et le journal, tout en conservant les stocks courants 2/1. Retour, rechargement puis reconnexion restaurent les bornes exactes. Le focus revient dans la frise après une relecture sans détail explicite.

Sur la même fixture indépendante, `seed-history` publie 24 modifications supplémentaires par les API gouvernées : page récente de 20 publications/20 événements, puis page ancienne de 5 publications/7 événements. Toutes les barres indiquent une couverture partielle, les intervalles sans événement chargé affichent un tiret et des hachures ; aucun zéro global ni tendance exhaustive n’est déduit. Passer à sept jours revient à la première page, affiche sept intervalles et retire l’ancien filtre fin. Ce parcours a passé la recette mobile 390 × 844, thème clair et clavier ; le rendu sombre et les barres ont aussi été contrôlés. Il ne qualifie pas un lecteur d’écran complet ni un historique de grande taille.


## Lecture étendue de la Chronique

Avec une fixture neuve puis `seed-history`, la profondeur par défaut donne 20 publications et 20 événements récents, couverture partielle. Choisir « Jusqu’à 100 publications » rassemble les 25 publications et leurs 27 événements : 2 créations de concepts, 24 modifications, 1 création de relation. La couverture est complète seulement après les relectures d’autorisation ; les deux boutons de continuation sont désactivés. Sélectionner le dernier intervalle de la frise, étendre le journal, ouvrir la relation v1 et sa preuve Unicode 0–92. Le paramètre `history_pages=5` doit rester dans le lien, et le rechargement/reconnexion restaurer la profondeur et l’événement.

Ce parcours a été validé par CUA sur le runtime réel, ainsi que le retour à 20 puis à 100 publications sur écran clair 320 × 740 (largeur document/body 320 px). Les dépassements de volume, annulations, changements d’accès pendant la lecture, 121 publications et scans vides ont été exercés par tests de transport/modèle/composant, pas par une modification réelle des droits dans cette recette. Le test de retrait de Bob précédemment bloqué reste en attente de l’accord demandé. Voir [ADR 0006](architecture/decisions/0006-bounded-extended-journal.md) pour les bornes exactes et limites serveur.

## Chargement séparé des espaces — build de production

Le 3 octobre vers 00:50 UTC, les fichiers de production du mode API ont été servis uniquement en loopback sur 5175, avec proxy vers la fixture Rust locale 8011. Parcours CUA réussi : connexion → vue d’ensemble → BrainMap → profondeur 100 (25 publications, 27 événements) → conversations/gouvernance → retour navigateur → événement v25 → preuve Unicode 0–92 → rechargement/reconnexion avec détail restauré. Aucun message console de niveau error. Aucune mutation de connaissance ou de droits pendant cette recette.

Le build mock servi séparément sur 5176 a passé l’ouverture de BrainMap, la recherche SIMULIA, la sélection au clavier et sa restauration après rechargement. Thèmes sombre/clair, écran 320 × 740 sans débordement horizontal de page. Le catalogue OKF déjà présent sur 5173 a conservé ses 1 538 fiches et 16 217 références après rechargement. Les previews temporaires ont été arrêtées et leurs onglets fermés.

Les tests de `AsyncWorkspace` couvrent le module en attente, son rejet sans afficher le détail brut de l’erreur, la récupération en changeant d’espace et l’absence de montage tardif après déconnexion. Un échec réel de téléchargement de chunk n’a pas été injecté dans le navigateur. Ces contrôles ne mesurent pas la latence réseau utilisateur ; voir le journal de livraison pour les tailles produites et la séparation des modes.

## Perte de réponse après enregistrement d’un feedback

Le 3 octobre 2026, le scénario a été qualifié avec un nouveau jeu synthétique de deux concepts/une relation, sans modifier de droits ni appeler un modèle. Le préparateur accepte désormais un port local alternatif pour placer un proxy de faute devant Rust :

```sh
source .runtime/brain/env.sh
.venv/bin/python scripts/brain_browser_fixture.py serve --synthetic-only --directory .runtime/brain/browser-response-loss-next --duration 1800 --port 8012
```

Dans un second terminal, après le message de disponibilité :

```sh
.venv/bin/python scripts/brain_feedback_loss_proxy.py --synthetic-only --directory .runtime/brain/browser-response-loss-next
```

Le proxy écoute uniquement `127.0.0.1:8011`, transmet les identifiants inchangés au backend 8012 et expire avec la fixture (30 min au maximum). Il refuse les autres tenants/domaines et les écritures hors conversation/feedback. L’origine de mutation reste 5174, déjà autorisée par la fixture ; aucun CORS n’est élargi. Utiliser l’action `session` du préparateur dans le même répertoire pour la connexion temporaire, sans enregistrer le jeton dans Git.

Dans le navigateur, poser une question sourcée puis envoyer un avis négatif. La première réponse 200 de feedback est reçue du backend puis supprimée avant transmission ; le navigateur doit montrer un résultat incertain. Avant de cliquer Réessayer, lire en SQL les nombres de lignes `cf_feedback` et `cf_issues`, filtrés par tenant/domain/episode. Après la reprise explicite, comparer le reçu et l’empreinte du payload dans la trace, puis relire les deux nombres. Ne pas se contenter d’un état final qui ne prouverait pas le commit initial.

Preuve obtenue : reçu `d04978d2-2c10-45b8-82d5-448cf07c8214` commité à 12:10:13.982 UTC ; SQL un/un à 12:10:41 avant reprise ; même reçu et payload après reprise à 12:10:46 ; SQL toujours un/un à 12:11:38. Le ticket a été consulté au navigateur. La [matrice de recette](product/frontend-acceptance-matrix.fr.md) précise les corrections UX et les limites. Ce scénario ne qualifie ni les autres mutations après commit, ni la récupération d’intentions après un rechargement.

À la fin, se déconnecter et arrêter proprement le proxy et le helper ; conserver les données et les rapports. La faute se déclenche une seule fois par exécution du proxy. Ne jamais le diriger vers une instance ou des données de production.
