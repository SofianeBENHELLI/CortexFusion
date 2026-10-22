# Un brief factuel, personnel par défaut, dans la conversation

16 octobre 2026 — B02/E02, lecture native additive sans migration.

L’arrivée dans l’espace doit répondre à « Que dois-je faire ? » à partir du travail enregistré. `tasks.brief` expose cinq tâches actives au plus et les compteurs complets du périmètre courant, dans une seule transaction repeatable-read. Personnel par défaut ; la vue domaine exige owner/corpus_manager. Viewer et agent n’accèdent pas à ce suivi humain. Une sélection de périmètre ne crée aucun droit et le rôle retourné est celui actuellement enregistré.

L’ordre est explicable : échéance dépassée, revue à décider, affectation personnelle à accepter, blocage, tâche sans affectation, travail en cours, attente. Puis échéance (dates absentes en dernier), création et identifiant. Les compteurs d’états forment la totalité des tâches actives ; le compteur d’échéances dépassées les recoupe. Aucun score d’urgence appris, priorité métier déduite, SLA, qualité ou couverture du corpus n’est revendiqué. Une file vide n’exclut ni dossiers partagés, ni imports, ni décisions de publication à traiter.

HTTP et MCP exposent le même résultat horodaté, avec versions de travail/droits. La console montre le dénominateur complet même si seules cinq lignes sont présentées, et ouvre la file entière avec le filtre correspondant. Chaque carte ouvre le dossier courant, sans acceptation implicite. Le prochain pas dépend des actions effectivement autorisées sur la tâche. Toute mutation continue à relire sa révision et ses droits.

Le brief est masqué pendant une relecture et après une erreur ; rafraîchissement manuel, après mutation locale et toutes les minutes tant qu’il est monté. Ce polling n’est pas une révocation poussée en temps réel. Le contexte/session existant purge les caches lors d’un changement d’identité. Les phrases guidées et les boutons emploient la même lecture ; la compréhension sémantique générale reste ouverte.

La recette a montré qu’un brief long repoussait le composeur hors de la zone visible. Sur bureau suffisamment haut (≥851 px de large et ≥650 px de haut), le fil possède désormais son propre défilement et le composeur reste au bas de la conversation centrale. Sur petit écran, le défilement documentaire et la bascule Conversation/Dossier sont conservés. Les longues erreurs/brouillons peuvent défiler dans le composeur borné ; aucune hauteur fictive ne doit recouvrir le dossier.

Qualification native et Chrome, limites et commandes : lot11 du journal autonome. Les services privés n’ont pas été migrés/redémarrés et la clôture UI/UX reste ouverte.
