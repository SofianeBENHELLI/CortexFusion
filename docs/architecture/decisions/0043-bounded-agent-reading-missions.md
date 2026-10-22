# Missions bornées de lecture et rapport

17 octobre 2026. Première tranche B10 vérifiée : lot35 au journal de fenêtre. Le contrat global B10 reste partiel.

Introduire un protocole de coordination de service nommé, distinct des tâches humaines et des droits de connaissance. Un owner/manager prépare et confirme un mandat vers un membre dont le rôle effectif est agent, pour une source exacte déjà autorisée aux deux acteurs. Aucun transfert d’ACL, identité ou credential. Première tranche : une source par mission, lecture bornée puis rapport candidat. Le fournisseur est explicitement « Aucun » : aucun modèle ni worker n’est lancé par la création du mandat.

Le mandat fige titre, objectif, critères, source/hash, service, plafond de caractères lus et d’appels, échéance. Préparation cinq minutes liée aux versions des memberships et au contenu. Le service réclame un bail cinq minutes maximum, borné par l’échéance ; renouvellement et reprise de bail expiré restent auditables. Un ancien bail ne peut lire ni remettre un résultat après renouvellement de propriétaire logique. L’arrêt humain invalide le bail ; reprise humaine explicite conserve les budgets consommés et l’échéance.

Les lectures de mission passent par une commande idempotente : plage Unicode exacte, au plus8192 caractères, source/hash/ACL relus avant sortie, compteur d’appels et de caractères incrémenté une seule fois. Aucun plafond relevé ou passage tronqué silencieusement. Les budgets ne prétendent pas mesurer les jetons, coûts ou autres appels d’un client externe. Ils s’appliquent seulement aux opérations de cette mission et ne révoquent pas les droits déjà détenus par son identité ailleurs.

Le rapport est candidat, motivé et borné, avec références de passages effectivement lus. Il ne peut publier, approuver ou rendre un avis humain. Les relevés viennent du serveur ; les conclusions de l’agent sont signalées comme telles. Les copies de contenu documentaire ne sont pas conservées dans les reçus/événements de lecture. Les lectures historiques relisent la source actuelle ; une perte d’accès interdit la restitution de texte, même lors d’un rejeu.

Tables additives avec RLS forcée, reçus et événements immuables, CAS et clés idempotentes. Liste et détail filtrent les droits actuels avant pagination. Auteur humain et service nommé uniquement ; autres managers n’héritent pas implicitement de cette communication. Les événements doivent permettre de distinguer expiration de bail, arrêt et fin de mandat. Aucun transport externe ni notification n’est créé.

Échéance future, au plus24heures ; le formulaire propose1–1440minutes. La confirmation n’allonge jamais cette échéance et peut être refusée si elle est dépassée. Contrôles natifs10groupes, console714tests, Chrome3groupes dont reprise après réponse perdue et mobile. Aucun client modèle externe qualifié.
