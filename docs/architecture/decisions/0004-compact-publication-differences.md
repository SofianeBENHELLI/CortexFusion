# ADR 0004 — Différences sans corps de concepts pour la Chronique

Date : 2 octobre 2026. Statut : implémenté ; qualification de grande volumétrie ouverte.

## Problème

Les fenêtres de BrainMap évitent la lecture de tous les corps pour dessiner la carte. La Chronique utilisait encore `proposals.diff` pour chaque publication de sa page et recevait les textes avant/après. Elle a besoin de savoir si le contenu a changé, mais pas de télécharger chaque texte pour calculer ses événements.

## Décision

Ajouter la lecture native `proposals.diff_summary`, HTTP `GET /v1/domains/{domain}/proposals/{proposal_id}/diff/summary`, MCP `api_proposals_diff_summary`.

- Le handler réutilise intégralement la lecture et les contrôles de `proposals.diff`, puis compacte sa réponse avant sérialisation HTTP. La route complète reste utilisée pour la revue des propositions.
- Chaque corps avant/après est remplacé par `body_sha256`, empreinte SHA-256 de ses octets UTF-8 exacts. Identité, titre, maturité, références de preuves, liens, poids et caractère primaire restent identiques. Aucun extrait ou corps n’est renvoyé par cette route.
- Au plus 50 éléments de changement par réponse, correspondant à la borne des propositions. Les bornes existantes de 100 liens et 30 références par concept sont conservées. Les créations et retraits gardent respectivement `before: null` et `after: null`.
- Les rôles autorisés restent ceux de la lecture des propositions : owner, agent, contributor, corpus_manager. Les preuves doivent être actuellement accessibles. Le résumé n’accorde aucun accès historique supplémentaire. La Chronique connectée reste réservée au propriétaire, selon son contrat de liste des publications.
- La console utilise uniquement les différences de publications auditées, vérifie version, identité et comparaison `accepted_before_state`, puis compare les empreintes pour détecter un changement de contenu. Les événements conservent leurs identités et leurs règles de comptage. Le texte courant est lu par `concepts.read` sur sélection ; les extraits sont relus sur demande.

## Limites

Le coût serveur reste celui de la différence complète : chargement du snapshot et des preuves, contrôles de droits et comparaison. Les relations sont toujours transmises intégralement pour les concepts modifiés. Une page de vingt publications denses peut encore être volumineuse ; ce changement ne constitue ni une pagination des événements ni une agrégation serveur. Les compteurs temporels restent ceux de la page de publications. Le plafond de préparation des snapshots de 4 000 000 octets encodés reste applicable.

Le client connecté nécessite un runtime exposant cette nouvelle lecture ; l’absence de route est une erreur visible, sans repli vers des données fictives. Une empreinte de corps sert à comparer le contenu et ne remplace pas la consultation d’une preuve source.

## Validation

- Test Rust : corps Unicode supprimés, SHA-256 connu, métadonnées et références inchangées, retraits conservés, rejet de plus de 50 éléments.
- Recette HTTP/MCP sur Rust, PostgreSQL et TerminusDB : égalité avec la différence complète après remplacement des seuls corps, schéma, approbation distincte de publication, droits du lecteur, autre tenant, révocation de preuve et parité MCP.
- Scénario dense de 30 concepts/870 relations : différence complète **100 719 octets**, résumé **100 179 octets**. Le faible gain montre le poids des relations dans ce cas. Scénario d’un concept modifié avec un extrait source de 30 000 caractères : **38 494 → 6 762 octets**. Ces mesures concernent les réponses de ces scénarios, pas la latence ou la capacité de production.
- Tests frontend : mêmes événements, identités, compteurs et explications pour textes complets et empreintes ; rejet d’un hash absent/invalide, d’un corps inattendu et de doublons. La sélection historique reste visible quand son voisinage courant disparaît.

Voir le [journal de livraison](../../product/brain-delivery-status.fr.md) pour les parcours navigateur, commandes et résultats exacts.
