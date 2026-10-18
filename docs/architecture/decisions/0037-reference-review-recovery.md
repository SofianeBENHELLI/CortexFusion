# ADR0037 — Reprendre un reçu de revue sans conserver sa copie

17 octobre 2026. Suite de l’ADR0036 et du mécanisme de reprise des sauvegardes privées.

Avant tout envoi ou avis, la console mémorise dans sessionStorage une projection stricte : commande, domaine, identifiant de revue nullable avant sa création, état et révision attendus, date de départ. Aucun motif, question, preuve, destinataire ou jeton. Espace séparé par tenant et identité vérifiés, vingt entrées au maximum, vingt-quatre heures ; fermeture de l’espace purge les références. Une impossibilité d’enregistrer cette référence bloque le nouvel envoi.

Après rechargement, seuls ces repères sont proposés. Vérifier effectue un GET du reçu personnel et contrôle clé, état, révision et cible connue. Aucun POST automatique ; un reçu absent ou refusé conserve l’incertitude. Le corps original n’étant pas conservé, une reprise de commande après reload n’est pas proposée. Retirer explicitement un repère local n’annule rien sur le serveur et ne prouve aucun échec. Le suivi courant reste à relire après récupération d’un reçu historique.
