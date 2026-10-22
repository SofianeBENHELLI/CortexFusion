# ADR0036 — Revue nominative d’une version de question

17 octobre 2026. Décision d’implémentation B07 ; qualification à consigner au journal.

Une question privée ne devient pas visible à l’équipe par simple sauvegarde. L’auteur humain prépare une soumission vers un responsable nommé, parmi les owners/managers déjà autorisés à lire sa source. Le serveur retourne l’aperçu complet de la version, du destinataire et des effets ; une seconde action explicite la soumet. La préparation expire en cinq minutes et lie contenu, révision et version des droits. Aucun droit source n’est ajouté.

La soumission fige la version du brouillon, son contenu, son auteur et son destinataire. Modifier le brouillon ne modifie pas cette version partagée. Seuls auteur et destinataire courant, avec accès actuel à la source et empreinte inchangée, lisent son contenu. Aucun nouveau manager ni owner non nommé n’hérite de cet accès. Une révision ne peut produire qu’une soumission : une nouvelle revue nécessite une nouvelle révision privée explicite.

Le responsable nommé peut demander des modifications ou indiquer que cette version est prête à présenter à l’owner, avec avis motivé. Ce n’est pas une approbation officielle. L’auteur peut retirer la soumission : le destinataire ne retrouve alors qu’un témoin sans contenu. Les commandes utilisent révision attendue, clé idempotente, reçu immuable personnel et relecture des droits ; leur historique conserve les avis sans les copier dans un journal public.

La banque approuvée, les confirmations indépendantes, la publication et les campagnes restent distinctes et non disponibles dans cette tranche. Un avis favorable n’est ni une référence officielle ni un verdict d’évaluation. Agents exclus de cette communication humaine tant que le mandat de partage n’est pas défini.
