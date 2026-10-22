# ADR0030 — Références de récupération des tâches après rechargement

17 octobre2026. Tranche de reprise B02, sans migration.

## Problème

Les reçus personnels sont durables côté serveur, mais une réponse perdue suivie d’un rechargement faisait perdre la clé de la commande encore inconnue. Le garde de navigation ne survit pas à un arrêt de document. Reconstituer la charge depuis le formulaire ou renvoyer une nouvelle intention risquerait un doublon.

## Décision

Avant chaque envoi confirmé de création, transition ou planification de tâche, conserver dans `sessionStorage` une projection stricte : identifiant de commande, domaine, cible éventuelle, type d’action, révision résultante attendue, heure de tentative. L’enveloppe est liée au tenant et au sujet vérifiés par `/me`. Aucun titre, motif, résultat, contenu source, charge HTTP, jeton ou signature. Ce marqueur est un indice de tentative, jamais un reçu ni une autorisation. L’accès actuel au reçu est revalidé par le serveur.

Le marqueur est utilisable24h et borné à20 actions par onglet, sans éviction silencieuse d’une action non expirée. Les références expirées sont signalées puis écartées des lectures ; elles sont éliminées du stockage au prochain changement de l’enveloppe ou à sa suppression. Ce délai n’est pas une garantie de rétention des reçus serveur. Si le navigateur refuse l’enregistrement ou si la limite est atteinte, aucun nouvel envoi n’a lieu. Une réponse exacte retire la référence ; un refus métier certain aussi. Une absence de réponse, un résultat illisible ou unGET404 ne prouvent pas un échec.

Après rechargement, UI et chat permettent unGET du reçu seulement, avec concordance commande/action/cible/révision. Un reçu retrouvé ouvre la voie aux opérations suivantes. Tant qu’une référence du domaine reste à vérifier, les nouvelles préparations de tâches sont bloquées. Le retrait volontaire d’une référence est nommé comme un retrait local, sans annulation distante ni suppression du reçu. La commande mémorisée dans la page courante conserve ses mécanismes existants de rejeu exact ; aucune charge n’est reconstruite à partir du marqueur.

La fermeture explicite de l’espace/déconnexion supprime l’enveloppe locale. Une identité vérifiée différente la purge. Un rechargement ou une réauthentification du même compte peut la retrouver ; aucun objet privé n’est affiché avant vérification de session/domaine. Un ancien callback ne peut résoudre une référence après démontage. Les références d’un autre domaine ne sont pas utilisées dans le domaine courant.

## Limites

Stockage de session de cet onglet uniquement : pas de récupération promise sur un autre appareil, après fermeture définitive de l’onglet, effacement du navigateur ou déconnexion. Les navigateurs peuvent copier l’état de session lors d’une duplication d’onglet ; cette copie ne peut faire que lire un reçu, jamais réémettre la commande. Pas de chiffrement ajouté : les identifiants restent des métadonnées locales accessibles aux scripts de la même origine, sans secret d’autorisation. Les imports, avis, partages et publications ne sont pas couverts par cette tranche. Les reçus serveur restent la preuve d’exécution.

## Validation

Suite console612/612 ;14 tests supplémentaires au total (stockage, récupération, intégration envoi perdu→remontage, routage chat). Test de logout existant enrichi. Chrome : réponse perdue→reload→GET sansPOST supplémentaire ;GET404 injecté→incertitude conservée→secondGET réussi ; mobile clair/sombre et boutonEnter. Journal de fenêtre pour dénominateurs, compteurs et limites.
