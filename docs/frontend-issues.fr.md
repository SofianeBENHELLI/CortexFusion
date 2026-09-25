# Retours utilisateur et tickets de connaissance

Le mode API présente les tickets accessibles du domaine. La liste paginée utilise `GET /v1/domains/{domain}/issues`, puis `after` pour la suite. Ouvrir un ticket relit `GET /v1/domains/{domain}/issues/{ident}` et charge l’épisode exact par `GET /v1/domains/{domain}/episodes/{episode_id}`. L’écran affiche motif, statut, révision, version servie, réponse et citations. Une erreur masque les données concernées, notamment après révocation des droits.

Un vote négatif envoyé à `POST /v1/domains/{domain}/episodes/{episode_id}/feedback` produit un ticket `disputed_answer`. Une absence de connaissance peut produire un ticket `knowledge_gap`. Ces tickets sont distincts des signaux comportementaux de `/feedback-signals` : consulter uniquement cette dernière route ne permet pas de retrouver les votes directs.

La consultation est raccordée. Le traitement des tickets et la création d’une correction depuis l’écran restent à intégrer. Le contrat `POST /issues/{ident}/decisions` prévoit une révision attendue, un motif, une clé d’idempotence et éventuellement une proposition corrective. Une résolution de ticket ne doit pas être présentée comme une publication de savoir. Les confirmations des décisions de proposition restent obligatoires, conformément au guide de revue.

Les réponses du ticket sont celles de l’épisode enregistré, avec leur version historique ; elles ne sont pas recalculées contre la dernière version. Les citations et les droits sont contrôlés par le backend. Aucun contenu du corpus privé n’est inclus dans les tests publics.
