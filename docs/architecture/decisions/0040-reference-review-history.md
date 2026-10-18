# Historique autorisé des revues de référence

Décision du 17 octobre 2026, lot32. Statut : implémenté, recette synthétique.

Réutiliser les commandes immuables de la migration0040 pour exposer une lecture HTTP/MCP paginée, sans nouvelle table. L’auteur et le destinataire nommé doivent encore disposer des droits de lecture de la copie et de sa source exacte. Aucun override de rôle ne donne accès à la copie d’autrui.

La page est liée à la révision courante ; une continuation exige expected_revision et échoue409 si la revue a évolué. Ordre croissant des révisions, limite1–20, total et curseur calculés dans la même transaction. Les événements donnent identifiant, auteur, action, version, état, date et motif autorisé ; jamais clé idempotente ni charge source. Après retrait, tous les motifs historiques sont null, même pour l’auteur. Une lecture ne change ni revue ni savoir.

Bouton et commande « Historique de la revue » partagent la lecture. La console contrôle le DTO, efface l’ancien historique avant relecture et masque la copie sur403/404 ou conflit de révision. Focus sur le journal. Le mécanisme courant produit au plus trois événements ; pagination testée avec limite1 côté natif, aucune prétention à une longue chronologie navigateur.

Validation et limites : journal autonome, lot32. Aucune approbation officielle ni clôture UI/UX.
