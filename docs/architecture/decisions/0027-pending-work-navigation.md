# Préserver les commandes incertaines à la navigation

17 octobre 2026 — protection locale, sans migration.

Une commande en cours d’envoi ou dont le résultat est inconnu enregistre une description non sensible dans une frontière commune de navigation. La console utilise le routeur de données React Router pour intercepter aussi les retours d’historique entre domaines/espaces. Les changements de dossier dans le même espace conservent leurs protections locales et ne sont pas bloqués globalement.

Une tentative de sortie ouvre un dialogue modal accessible, avec focus initial sur « Rester et vérifier », Échap qui reste dans l’espace et restauration du focus. Une commande encore en cours ne permet pas la sortie par ce dialogue. Un résultat inconnu permet une sortie explicitement assumée. Le dialogue ne renvoie aucune commande et ne prétend pas annuler le travail déjà reçu par le serveur. Si l’action se résout pendant le dialogue, la navigation tentée est abandonnée : elle ne reprend jamais automatiquement.

La fermeture volontaire de l’espace partage cette frontière. Une expiration ou révocation d’accès continue à purger le contenu privé : une protection de navigation n’autorise jamais à conserver des données après perte d’accès. Un avertissement navigateur `beforeunload` est enregistré pendant les opérations concernées ; son affichage réel dépend des règles du navigateur. Les simples saisies et préparations non envoyées ne sont pas couvertes par cette tranche.

Les corps et clés restent en mémoire de l’onglet. Ce mécanisme ne fournit aucune persistance durable d’intention, aucune garantie lors d’un arrêt brutal, et aucune reprise automatique après rechargement. Les reçus de tâches enregistrées restent consultables selon ADR0026. Les autres mécanismes conservent leurs règles de reprise exactes et explicites.

Preuves nouvelles : 587 tests console, TypeScript et trois builds (session/API manuelle/mock). Chrome sur fixture synthétique : perte contrôlée d’une réponse après commit ; domaine, fermeture, Échap, vue d’ensemble, mobile sombre et récupération GET. Compteur observé : un POST, une réponse perdue, une lecture de reçu ; passage de révision9 à10. La protection pendant l’envoi, le retour historique et `beforeunload` sont prouvés ici par tests de composant, pas encore par scénario Chrome dédié. Détails dans le journal de fenêtre.
