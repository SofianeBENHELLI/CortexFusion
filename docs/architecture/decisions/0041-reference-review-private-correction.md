# Reprendre une correction privée depuis une revue

17 octobre2026, lot33, implémenté et vérifié sur fixtures synthétiques.

L’auteur peut ouvrir sa question privée actuelle depuis une copie relue, par bouton ou commande explicite. La revue est relue sous droits actuels et doit conserver identifiant, auteur, question, version privée figée, révision et état. La destination reçoit seulement l’identifiant et la version figée, aucun contenu de copie. Le composant privé relit sa propre version et sa preuve via les API existantes ; il refuse de remplacer une saisie, une préparation ou un résultat inconnu. La copie de revue demeure immuable.

Afficher version privée actuelle et version figée séparément. Sauvegarder une correction ne soumet pas une nouvelle revue et ne retire pas la précédente. Le responsable ne reçoit aucun raccourci vers le brouillon d’autrui ; le serveur reste l’autorité. Ce lien est une composition de lectures existantes, pas une nouvelle permission ni un nouvel endpoint MCP.

Validation détaillée dans le journal autonome, lot33. Le retour vers une nouvelle soumission reste explicite dans le dossier des revues. Pas d’approbation, publication ou campagne.
