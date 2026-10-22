# ADR0034 — Vérifier une sauvegarde de référence sans la renvoyer

17 octobre 2026. Suite d’ADR0032, sans migration supplémentaire.

## Décision

Une réponse perdue laisse un résultat inconnu. Un refus ultérieur, même définitif pour la requête de reprise, ne prouve pas que le premier envoi a échoué. Le frontend conserve donc l’incertitude et les identifiants minimaux de la commande. Un refus d’accès masque le formulaire, sa source et la charge préparée ; il conserve la possibilité de vérifier un reçu sans texte.

`reference_draft_receipts.read` expose par HTTP et MCP un reçu immuable par clé idempotente, dans le domaine et le périmètre de l’auteur authentifié. L’appartenance écrivain actuelle est requise. Un owner ne lit pas les reçus d’un autre auteur. Le résultat ne contient que la clé, l’identifiant du reçu, celui de la question et la révision historique. Aucun titre, question, critère, extrait, source ou empreinte de contenu. Le retrait d’accès à la source ne masque pas ce reçu personnel sans contenu, mais masque toujours la question elle-même.

Bouton et commande guidée « vérifie le reçu de référence » effectuent le même GET. Un reçu absent, refusé, invalide ou inaccessible maintient l’état inconnu. Un reçu validé libère l’intention puis impose de relire le contenu courant ; il ne réinjecte pas la charge ancienne. La reprise par POST reste explicitement déclenchée et utilise la même charge et la même clé lorsqu’elles sont encore disponibles.

## Limites

Les identifiants de reprise de référence restent en mémoire dans cette tranche initiale ; ADR0035 ajoute ensuite leur conservation minimale dans l’onglet. Aucun stockage de texte dans le navigateur ; aucune récupération automatique après reload, aucun inventaire de reçus, aucune approbation ni banque partagée. Le reçu d’une écriture ne certifie ni la qualité de la question ni son contenu actuel.

## Preuves

Quatre groupes natifs : auteur/rôles, retrait source et absence de contenu, reçu historique après révision suivante, parité MCP et versions du savoir inchangées. Sept nouveaux tests de composant sur refus de reprise et reçu non confirmé, proxy GET seul et taille bornée. Scénario Chrome de réponse perdue, accès source retiré, reprise refusée, premier reçu absent puis GET confirmé ; limites responsive et résultats exacts au journal.
