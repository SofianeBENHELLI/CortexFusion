# ADR0032 — Préparations privées de questions de référence

17 octobre 2026. Première dépendance de B07 ; migration0039.

## Décision

Une question préparatoire appartient à son auteur dans un domaine. Elle comporte thème, question, critères attendus et preuve exacte (source, empreinte, passage, indices Unicode). Plusieurs questions sont sauvegardables ; chacune a une révision et un identifiant stable. La liste est paginée par vingt et filtrée avant pagination par auteur, accès source et empreinte. Un owner ne lit pas les préparations personnelles d’autrui.

`reference_drafts.list/read/save` sont les mêmes opérations natives pour HTTP et MCP. La console propose recherche de source, saisie, aperçu puis confirmation de sauvegarde privée. Les phrases guidées utilisent le même composant. Une préparation n’accorde aucun droit supplémentaire ; l’enregistrement relit la source dans la transaction autorisée et vérifie l’extrait exact. Les dépassements de taille sont refusés, jamais tronqués.

La sauvegarde utilise révision attendue et clé idempotente liée à la question et au contenu. Les reçus immuables ne contiennent aucun texte. Un ancien reçu ne décrit pas le contenu actuel et ne le remplace pas. Une réponse inconnue bloque la nouvelle préparation et conserve la même charge/clé en mémoire pour une reprise explicite. Le garde de navigation des commandes s’applique. Aucun texte ni clé de commande de référence n’est enregistré dans le navigateur ; après reload, relire les préparations enregistrées. Une source inaccessible masque ses questions ; elle ne supprime pas les données conservées.

## Frontières

Ces objets restent privés et `draft`. Ils ne sont ni une banque partagée versionnée, ni une réponse officielle, ni une référence approuvée. Aucun partage, approbation, campagne, score, modèle externe, suppression ou purge automatique dans cette tranche. Le contenu courant est mutable sous CAS ; son historique complet n’est pas exposé. Une future soumission partagée devra figer explicitement une version avec ses destinataires, preuve, révision et gouvernance, sans élargir les accès de ces brouillons.

L’édition d’un passage répété nécessite un extrait distinct ; la sélection d’une occurrence parmi plusieurs n’est pas disponible ici. La reprise de commande inconnue ne survit pas à la fermeture de la page. Le défaut de perte de saisie lors du renouvellement local a ensuite été corrigé par ADR0033 ; les autres limites de mémoire volatile demeurent.

## Preuves

Six groupes natifs HTTP/MCP,627 tests console puis45 ciblés finaux, TypeScript/build, contrôles proxy et17 tests onboarding/readiness. Chrome : préparation complète par chat, réponse perdue/reprise exacte, restauration après reload, conflit concurrent et retrait/restauration des droits, mobile clair/sombre et confirmation Enter. Dénominateurs et limites au journal de fenêtre. Migration sur la seule base synthétique55432 ; aucune migration du corpus privé.
