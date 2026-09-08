# Lectures simultanées du savoir publié

Le backend peut partager une lecture TerminusDB encore en cours entre plusieurs requêtes portant sur exactement le même instantané. Cela évite de refaire simultanément le même téléchargement, décodage et contrôle de digest. Ce mécanisme concerne les lectures du savoir publié : listes, fiches et requêtes de connaissance qui passent par `GraphService::published_concepts`.

Il ne modifie aucun endpoint, argument, schéma de réponse ou outil MCP. Chaque appel garde sa propre identité, ses transactions PostgreSQL, son contrôle de version et son filtrage des preuves. Les liens vers des concepts invisibles sont retirés dans une copie propre à la réponse. Les réponses privées et les épisodes ne sont jamais partagés.

## Durée et isolation

La clé contient le nom de base, le commit immuable, le digest et le nombre de concepts. Deux clients TerminusDB construits séparément ne partagent pas leurs lectures ; les clones d'un même client le peuvent. Seul le graphe brut entièrement validé est partagé.

L'entrée est retirée avant de livrer le résultat aux lecteurs en attente. Une requête suivante relit donc le moteur, même si le dernier résultat vient d'être calculé. Il n'existe aucun cache persistant, délai de validité ou recours au dernier résultat réussi en cas de panne. La disparition de la base reste une indisponibilité, sans retour à la projection SQL.

Les lectures de validation des propositions, de préparation/publication, de réconciliation et de maintenance continuent à interroger le moteur indépendamment. Le mécanisme ne regroupe aucune écriture et ne crée aucune nouvelle tentative métier.

## Annulation et erreurs

La première requête possède la lecture réseau. Son annulation interrompt cette lecture et libère immédiatement les lecteurs qui la partageaient avec une erreur de stockage. Aucune nouvelle tentative automatique n'est lancée. L'annulation d'un lecteur secondaire ne coupe pas la lecture des autres. Les entrées sont également retirées après un refus du moteur ou une réponse invalide.

Ce choix peut faire échouer plusieurs lectures si la première est annulée. Il évite de conserver un travail réseau détaché d'une requête pendant l'arrêt du serveur. Les limites réseau existantes restent applicables : vingt secondes et quatre millions d'octets pour une réponse TerminusDB.

Au maximum seize clés distinctes sont regroupées simultanément. Au-delà, une lecture supplémentaire suit le chemin direct. Ce nombre n'est donc ni une limite globale de concurrence moteur, ni un plafond de mémoire du processus. La mémoire et la charge des réponses, des transactions SQL et des copies filtrées restent proportionnelles aux appels actifs.

## Qualification et intégration

Les tests Rust utilisent des barrières et des compteurs réseau : douze lectures simultanées donnent un seul GET, puis une lecture suivante donne un nouveau GET. Ils couvrent les annulations, les erreurs, tous les champs de la clé, les instances séparées, la saturation et le maintien du chemin indépendant des mutations. Les contrôles HTTP/MCP avec PostgreSQL vérifient aussi les changements d'accès et de version pendant une lecture.

Le [protocole de volume](graph-volume.fr.md) conserve son profil historique, qui signe un jeton par requête. L'option `--identity-mode per_cell` ajoute un profil distinct : un jeton frais est réutilisé dans chaque cellule de mesure, comme dans une session de compagnon. Les résultats indiquent ce choix ; ils ne doivent pas être comparés comme s'il s'agissait du même protocole. Avec le moteur simulé uniquement, le rapport compte aussi les GET observés par cellule.

Une baisse du nombre de GET ne prouve pas une amélioration équivalente de la latence : les transactions SQL, la sérialisation, le filtrage et le client de mesure peuvent devenir dominants. Les résultats locaux simulés ne qualifient pas les performances de TerminusDB réel ni une capacité de production.
