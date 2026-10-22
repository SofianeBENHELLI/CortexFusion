# Retours utilisateur et tickets de connaissance

Le mode API présente les tickets accessibles du domaine. La liste paginée utilise `GET /v1/domains/{domain}/issues`, puis `after` pour la suite. Ouvrir un ticket relit `GET /v1/domains/{domain}/issues/{ident}` et charge l’épisode exact par `GET /v1/domains/{domain}/episodes/{episode_id}`. L’écran affiche motif, statut, révision, version servie, réponse et citations. Une erreur masque les données concernées, notamment après révocation des droits.

Un vote négatif envoyé à `POST /v1/domains/{domain}/episodes/{episode_id}/feedback` produit un ticket `disputed_answer`. Une absence de connaissance peut produire un ticket `knowledge_gap`. Ces tickets sont distincts des signaux comportementaux de `/feedback-signals` : consulter uniquement cette dernière route ne permet pas de retrouver les votes directs.

La consultation et le traitement des tickets sont raccordés. Un ajout sourcé peut être préparé depuis une citation du ticket ; la correction du titre d’un concept existant est également disponible. Le contrat `POST /issues/{ident}/decisions` prévoit une révision attendue, un motif, une clé d’idempotence et éventuellement une proposition corrective. Une résolution de ticket ne doit pas être présentée comme une publication de savoir. Les confirmations des décisions de proposition restent obligatoires, conformément au guide de revue.

Les réponses du ticket sont celles de l’épisode enregistré, avec leur version historique ; elles ne sont pas recalculées contre la dernière version. Les citations et les droits sont contrôlés par le backend. Aucun contenu du corpus privé n’est inclus dans les tests publics.


## Traitement depuis le frontend

Le formulaire demande un motif et propose les transitions permises par le statut courant : prise en charge, résolution, classement sans suite ou réouverture. Un identifiant UUID de proposition peut être lié à la prise en charge ou à la résolution. Le serveur vérifie son accès, son état et sa publication avant une résolution liée. Sans proposition, une résolution clôt le suivi avec un motif : elle n’atteste pas une correction du savoir.

Chaque intention contient la révision du ticket et une clé d’idempotence. En cas de résultat réseau incertain, le formulaire conserve le corps et la clé en mémoire et propose une reprise identique. Une erreur définitive (droits, absence, conflit, validation) demande une actualisation avant une nouvelle décision. Un rechargement du navigateur perd l’intention locale. Après succès, liste et détail sont relus ; le reçu est affiché. Contrairement aux décisions sur les propositions, le contrat de traitement des tickets n’exige pas de confirmation signée supplémentaire ; les droits et contrôles serveur demeurent appliqués.


## Préparation d’un ajout sourcé

Depuis le détail d’un ticket possédant des citations, le formulaire reprend une preuve au choix, un titre et un motif. Il relit la version publiée puis crée une proposition par `POST /v1/domains/{domain}/proposals`. Le corps du nouveau concept reste exactement l’extrait cité ; identifiant de source et positions Unicode sont conservés. Le serveur revérifie l’accès et la validité verbatim. Le motif contient l’identifiant du ticket pour la traçabilité ; ce n’est pas une liaison structurée automatique dans l’historique du ticket.

Il s’agit d’un **ajout**, pas d’une modification du concept existant ni d’une résolution automatique. Vérifier qu’il apporte une connaissance distincte pour éviter les doublons. Les tickets sans citation demandent d’abord une source exploitable. La modification du corps sourcé et des relations nécessite encore un parcours dédié.

La reprise réseau conserve la proposition entière, ses UUID et sa clé d’idempotence. Une erreur définitive permet de revoir le brouillon et relire la version avant une nouvelle tentative. Le brouillon/retry est en mémoire ; recharger la page le perd. La création ne modifie pas le savoir publié et n’effectue ni approbation ni publication.


## Correction d’un titre existant

Le formulaire « Corriger le titre d’un concept existant » relit les concepts publiés entre deux lectures de version. Si la publication a changé pendant cette lecture, le formulaire refuse le snapshot et demande de recommencer. La proposition conserve le même identifiant de concept, le corps, la maturité, toutes les sources et les relations ; seul le titre change. Un titre identique ne peut pas être soumis. Le motif rappelle le ticket.

Cette première correction ne modifie ni les extraits ni les relations. Le backend contrôle encore la version de base et les droits à la création ; l’approbation et la publication restent distinctes. Un résultat réseau incertain conserve la même intention en mémoire pour reprise. Après conflit ou refus définitif, il faut recharger les concepts. Ce contrôle évite d’écraser un état plus récent à partir d’une ancienne réponse.
