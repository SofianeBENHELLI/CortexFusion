# ADR0038 — Coordonner la session des onglets du même navigateur

17 octobre 2026 — accepté localement. Suite de l’ADR0033 ; contrat UX de conservation des saisies et fermeture de l’espace.

## Contexte
Deux onglets avec un ancien cookie peuvent restaurer simultanément une session locale : le serveur crée deux sessions valides, la dernière réponse remplace le cookie commun, mais l’autre onglet conserve son ancien CSRF. Reproduction synthétique : deux restaurations, deux CSRF différents, POST refusé403 sans transfert au moteur. Aucun relâchement du contrôle CSRF n’est approprié.

## Décision
Web Locks sérialise les appels de session et de déconnexion du même origin jusqu’à validation de leur réponse. Le délai de dix secondes inclut l’attente ; annulation et erreur de verrou ne déclenchent aucun contournement. Aucun verrou sur une commande métier, aucune répétition automatique de POST.

BroadcastChannel diffuse uniquement `changed` ou `closed`. Une indication de changement fait relire l’autorité au serveur par les autres onglets déjà ouverts ; une fermeture masque immédiatement leur contenu, purge leurs repères de récupération et ne répète pas la déconnexion HTTP. Aucune identité, saisie, clé ou jeton dans les messages. Le renouvellement local de la même identité vérifiée conserve son montage ; changement de droits/personne ou échec purge comme auparavant. Les liens de retour acceptent le dossier `referenceReviews` dans les deux validateurs.

## Alternatives et limites
La correction serveur par suppression du contrôle CSRF est écartée. Le partage de jetons dans le stockage navigateur est écarté. Les navigateurs sans ces API gardent le comportement existant et ses refus sûrs ; la coordination inter-onglets n’y est pas garantie. Aucun effacement de contenu serveur ni changement de durée ou de droits. Une restauration peut momentanément masquer l’interface pendant la vérification. Un POST déjà refusé reste à examiner explicitement.

## Preuves
675 tests console,108 tests passerelle/session, TypeScript et build session. Chrome : deux onglets d’une origine synthétique isolée, deux grants successifs pour une expiration60s, six lectures session ; cinq sauvegardes explicites, zéro403, conflit CAS avec comparaison obligatoire ; une seule déconnexion HTTP ferme les deux onglets. Desktop clair/sombre, mobile390 clavier, capture `session-tabs-mobile-dark.jpg`. Journal de fenêtre lot30.
