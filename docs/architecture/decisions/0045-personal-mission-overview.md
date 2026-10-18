# Suivi personnel des missions dans le brief

17 octobre 2026. Complément B09/B10 des ADR0043–0044.

Le brief doit rendre les mandats propres et les rapports candidats trouvables depuis l’accueil. Ajouter my_missions à work-overview pour l’auteur qui est encore owner/manager ; null pour les autres rôles. Le scope « domaine » reste réservé aux tâches et ne transforme pas les missions des autres auteurs en objets visibles.

Compter les missions queued/running/completed de l’auteur. Les arrêtées restent dans le contrôle/historique. Quatre compteurs disjoints : attente non expirée, réclamée non expirée, mandat queued/running expiré, rapport completed. L’expiration est calculée au timestamp as_of du snapshot. Le total est complet, la liste limitée explicitement à cinq, triée mandats expirés puis rapports puis autres, création/identifiant dans chaque groupe. Un bail ou l’état running ne prouve pas l’activité actuelle d’un worker. Les rapports remis ne sont pas étiquetés « non lus » : aucun accusé de lecture n’existe encore.

La projection réutilise le périmètre du contrôle d’arrêt : identifiants, dates, état/révision et compteurs restent visibles à l’auteur même sans source. Le titre n’est sélectionné que si le même prédicat que la liste des mandats valide les memberships, ACL des deux acteurs et empreinte exacte ; sinon title=null et content_available=false. Aucun objectif, source, hash, identité de service, rapport ou motif. La console refuse les champs supplémentaires et les dénominateurs incohérents.

UI et chat ouvrent le mandat complet quand lisible, ou le contrôle sans contenu sinon. L’ouverture relit ses propres autorisations. Un arrêt confirmé invalide immédiatement le brief de l’onglet ; les autres onglets relisent selon leur cadence existante. Le serveur incrémente déjà work_revision pour les commandes de mission, sans nouvel événement pour un reçu rejoué. Aucun transport externe, score de couverture ou approbation n’est introduit.

Recette et limites : lot38 du journal autonome. Pas de nouvelle migration.
