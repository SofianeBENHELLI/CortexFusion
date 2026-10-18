# ADR 0023 — Dossier partagé et tâche : référence sans transfert d’accès

16 octobre2026 · Tranche locale B03/B02.

Un dossier partagé est un extrait volontaire destiné à des coordinateurs nommés. Une tâche a ses propres instructions, affectataire, critères et cycle. Associer les deux ne doit pas copier du contenu personnel dans une file plus large ni ouvrir le dossier à l’expert.

Ajouter une référence réversible, créée ou retirée explicitement par un coordinateur actuellement destinataire du dossier. L’API vérifie les deux révisions dans une transaction sous verrou de domaine. Vingt références actives maximum, refus explicite au-delà. Le lien incrémente la révision et l’historique minimal du dossier ; il ne change pas la tâche et ne génère pas de notification contenant le dossier. Les anciens événements et reçus sont immuables ; retirer un lien ne les efface pas. La commande idempotente revalide le destinataire actuel, même en reprise. Un partage retiré bloque les lectures d’association de l’équipe et la reprise de ses commandes.

Le déclarant lit uniquement le nombre de tâches associées : aucun identifiant, titre, affectataire ni résultat interne. Le coordinateur destinataire lit les références et états actuels des tâches, qu’il est déjà autorisé à lire. Un expert affecté à une tâche ne reçoit aucun droit de lecture du dossier par cette association. Une tâche terminée ne résout pas implicitement le signal ; la conclusion partageable et les preuves de correction restent des étapes distinctes.

La création et l’affectation de la tâche restent les commandes existantes. Pas de préremplissage depuis l’extrait : le responsable rédige des instructions minimales autorisées, puis associe la tâche. Une future délégation explicite d’extrait exige un contrat de consentement distinct ; cette tranche ne modifie pas la politique `named-excerpt-v1`. Le statut « qualifié » reste indépendant du nombre de liens. Les références peuvent être retirées après clôture sans supprimer la tâche. Pas de suppression en cascade, ni de nouvelle identité ou rôle.

Migrations0035–0036 additives, recette synthétique seulement.0036 ajoute la cible de tâche aux événements immuables futurs ; les premières tentatives synthétiques0035 gardent leurs traces sans cible historique inventée. Cette cible interne n’entre pas dans le DTO déclarant. Aucun changement de droits sur le corpus privé.
