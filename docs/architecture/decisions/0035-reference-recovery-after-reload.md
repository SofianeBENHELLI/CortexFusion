# ADR0035 — Références minimales de sauvegarde après rechargement

17 octobre 2026. Suite d’ADR0034, sans nouveau contrat natif.

## Décision

Avant un POST de sauvegarde privée, la console conserve dans `sessionStorage` une projection stricte : domaine, question, clé idempotente, révision attendue du reçu et heure de tentative. Le conteneur est isolé par tenant/sujet vérifiés. Aucun texte, preuve, source, empreinte de contenu, jeton ou corps de commande n’y entre. La conservation maximale est vingt références, utilisables pendant vingt-quatre heures. Une saturation ou un refus de stockage empêche le nouvel envoi ; aucune référence inconnue n’est évincée pour faire de la place.

Après rechargement, le dossier propose exclusivement la lecture du reçu par GET. Reçu absent ou refusé : résultat toujours inconnu. Reçu validé : retrait de la référence locale, puis relecture explicite de la question courante. Aucune réhydratation du corps ni renvoi automatique. La préparation d’une nouvelle sauvegarde dans le domaine reste suspendue tant qu’une référence est à vérifier.

L’utilisateur peut retirer explicitement une référence récupérée après interruption, avec l’explication que cela n’annule pas l’écriture et ne prouve pas son échec. Une commande encore inconnue et conservée en mémoire doit d’abord être vérifiée. Fermer l’espace efface les références locales ; activer une autre identité vérifiée purge celles de l’identité précédente. Le serveur garde ses reçus immuables.

## Limites

Cette reprise concerne le même onglet ; ni synchronisation entre appareils, ni garantie de conservation après fermeture du navigateur. L’expiration des références est signalée et ne certifie pas l’échec de l’écriture. Les autres parcours gardent leurs propres contrats. Une future factorisation avec le stockage de reprise des tâches devra conserver les namespaces et validations strictes ; elle n’est pas nécessaire à ce correctif.

## Preuves

Tests de stockage borné/isolé et sans contenu, interruption-remontage avec GET404 puis reçu valide, absence de POST si stockage refusé, retrait explicitement local et nettoyage au logout. Chrome : réponse perdue après commit, reload sans texte, vérification chat puis clavier par GET uniquement. Dénominateurs et limites responsive au journal de fenêtre.
