# Contrôle d’arrêt d’une mission sans accès au contenu

17 octobre 2026. Complément du protocole de missions de lecture (ADR0043), sans nouvelle migration.

La perte d’accès à une source masque le mandat et son rapport, mais ne doit pas empêcher l’auteur de retrouver la version nécessaire pour arrêter son propre service. Ajouter une liste paginée et un détail de contrôle, disponibles seulement à l’auteur qui conserve actuellement le rôle owner/manager du domaine.

La projection SQL et le contrat filaire sont explicites : identifiant de mission, état, révision, dates, compteurs et plafonds, expiration et possibilité d’arrêt. Aucun titre, objectif, critère, source, hash, service, bail, rapport ou motif. Le client rejette toute propriété supplémentaire. Les autres responsables n’héritent pas de cet accès ; un auteur devenu contributeur perd ce contrôle.

Le contrôle ne permet que la préparation puis la confirmation explicite d’un arrêt via la commande existante, avec motif, version fraîche et clé idempotente. Il ne permet ni reprise, ni exécution, ni lecture documentaire. La reprise exige à nouveau le mandat complet sous les accès courants. Une mission expirée mais encore queued/running reste arrêtable ; stopped/completed ne propose plus d’arrêt.

UI, commandes chat et MCP emploient les mêmes routes et garanties. La reprise d’un résultat inconnu conserve seulement sa référence minimale et relit le reçu sans répéter la mutation. Aucun nouveau droit documentaire, credential ou processus agent n’est créé. La révocation ne prétend pas effacer rétroactivement des données déjà vues ; la relecture et l’envoi contrôlent les droits courants. Résultats et limites de recette : lot36 du journal autonome.
