# Planification explicite des tâches

16 octobre 2026 — B02/E03/E06, migration additive0037.

Une tâche conserve une priorité `low|normal|high` et le motif du dernier arbitrage. Les anciennes tâches reçoivent `normal` avec motif vide : cela indique une valeur par défaut, pas une priorité évaluée. Le coordinateur courant (owner/corpus manager) peut préparer puis confirmer une révision de priorité/échéance via UI, chat guidé ou MCP `tasks.plan`. L’affectataire peut lire le plan ; son affectation ne lui confère pas ce pouvoir.

`due_at` est obligatoire et nullable : null retire explicitement une date. Une commande contient la révision attendue, un motif non vide et une clé idempotente. Une absence de changement priorité/date est refusée. La transaction de permission verrouillée vérifie le rôle actuel avant de rechercher un ancien reçu. Rejouer exactement un reçu après des modifications ultérieures restitue le résultat initial sans réappliquer le plan ; une clé réutilisée pour une autre charge est un conflit. Une tâche terminée/annulée n’accepte pas un nouveau plan. Les dates sont UTC en stockage, affichées dans le fuseau du navigateur.

La planification change la révision et la dernière activité, mais conserve création, affectataire, statut, acceptation, critères et résultat. L’événement immuable contient avant/après (priorité/date), acteur et motif. Les anciens événements conservent `planning:null`, sans histoire reconstruite. Le même événement alimente l’activité personnelle existante. Aucun savoir n’est approuvé ou publié.

Le brief place les retards en premier, puis la priorité explicitement stockée, puis l’ordre opérationnel existant, échéance/création/identifiant. La file complète conserve son tri chronologique stable. Aucune priorité inférée, escalade, rappel externe ou SLA n’est ajouté. Le transport du brief est borné ; cette évolution ne qualifie aucune capacité à10 000.

La console relit le détail avant préparation, montre l’avant/après et confirme la même charge. Un bouton retire explicitement l’échéance du projet ; le simple formulaire n’applique rien. Une réponse inconnue garde corps/clé en mémoire, sans réémission automatique. La conservation d’une commande inconnue après fermeture/rechargement reste à réaliser. Les nouveaux champs du contrat de lecture sont optionnels pour les anciens serveurs, mais le serveur0037 les émet toujours ; `planning_allowed` contrôle la présentation, jamais l’autorisation serveur.

Recettes et défauts corrigés : lot16 du journal autonome. Migration appliquée uniquement à PostgreSQL synthétique55432 ; corpus privé non migré. UI/UX non close.
