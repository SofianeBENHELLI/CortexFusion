# ADR0033 — Continuité des saisies pendant une rotation locale

17 octobre 2026. Correctif de continuité observé pendant la recette B07.

## Décision

Dans le mode local déjà autorisé, le renouvellement d’une session conserve le montage du dossier et ses saisies en mémoire si la nouvelle identité vérifiée est identique : tenant, sujet, domaines, rôles cumulés, révisions d’appartenance et capacités. La rotation du CSRF ou de l’échéance ne constitue plus à elle seule un changement de personne. Les nouveaux identifiants de session sont installés avant que l’espace redevienne interactif.

Pendant la vérification, l’espace est masqué. Un échec, une disparition de session, un changement d’identité ou de droits purge le cache et démonte l’espace. Le logout et la sortie du document gardent leurs règles d’effacement. Le mode de session distante conserve sa frontière stricte lors d’une rotation. Aucun jeton ni texte n’est persisté pour réaliser cette continuité.

Une vérification déjà en cours ne programme pas une seconde vérification à partir d’une échéance dépassée. Cela évite une boucle d’annulation du renouvellement lent. Le délai maximal de la requête reste inchangé. Une requête métier ayant échoué n’est jamais rejouée automatiquement ; l’utilisateur conserve les actions de reprise et les clés idempotentes existantes.

## Limites

La conservation en mémoire ne survit pas à un rechargement, à un changement de code de développement, à la fermeture de page ou à une vérification refusée. Les sauvegardes privées explicites restent le moyen durable. Les droits sur les sources et objets continuent d’être relus par leurs opérations natives ; une empreinte d’identité égale ne transforme pas une lecture en permission d’écriture.

## Vérification

Tests ciblés de saisie conservée et utilisation du nouveau CSRF sans rejeu, effacement pour changement de sujet/rôle/révision/capacité, échec et rotation distante ; renouvellement lent non annulé en boucle. Recette Chrome et résultats exacts consignés au journal de fenêtre.
