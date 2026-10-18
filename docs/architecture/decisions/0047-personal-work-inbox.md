# ADR 0047 — Boîte de réception personnelle du travail

17 octobre 2026. Statut : adopté pour une tranche E26/B09, couverture partielle déclarée.

Le brief indique les objets à traiter ; il ne mesure pas ce que la personne a déjà lu. Une boîte personnelle distincte rassemble les notifications de tâches existantes, les événements entrants de revues nominatives et les prises en charge/rapports de missions propres. Elle exclut les lectures et renouvellements techniques des services. Aucun transport externe, worker de notification ou observation passive n’est introduit.

La projection SQL sélectionne uniquement des métadonnées et applique les droits actuels : destinataire de notification de tâche encore autorisé, auteur/reviewer nommé encore éligible pour une revue, auteur coordinateur de mission. Un autre manager ne reçoit pas les revues/missions d’autrui. Les revues retirées sont masquées ; une mission dont le contenu n’est plus accessible conserve uniquement les métadonnées permises par son contrôle personnel. Aucun extrait, note, rapport, empreinte de source, brouillon privé ou clé de commande n’est copié dans la boîte.

GET work-activity retourne un snapshot repeatable-read, des totaux exacts dans ce périmètre, vingt éléments au plus et un curseur opaque. Tri création/type/id décroissants. Le curseur lie les versions du travail et des appartenances, le dernier événement d’accès source et le nombre de marqueurs personnels. Un changement impose une nouvelle lecture, sans fusion silencieuse de pages incompatibles. Les compteurs ne prouvent ni livraison externe ni lecture humaine effective.

POST work-activity/{event}/read ne produit qu’un marqueur de lecture personnel immuable et un reçu idempotent. Il réutilise la table existante pour les tâches ; migration additive0042 pour revues/missions, RLS forcée tenant, écritures INSERT seulement. Aucune transition, acceptation, approbation, clôture ou version du savoir. Le serveur revalide l’événement visible avant d’accepter une clé, et refuse sa réutilisation pour un autre événement/type.

UI et commandes chat partagent les deux opérations. Ouvrir ne marque jamais lu. Une réponse perdue garde en mémoire le même envoi ; relecture GET sans renvoi automatique, reprise explicite avec la même clé. Après rechargement, la liste retrouve le marqueur durable ; elle ne restaure pas une intention de lecture non confirmée. Aucun contenu d’événement n’est persisté dans le navigateur. Les phases d’attente distinguent lecture de liste et enregistrement du marqueur.

Limites de cette tranche : owner/manager/contributeur seulement, pas encore de notifications de dossiers partagés, imports, décisions ou résolutions viewer. Pas de filtre non-lus, temps réel, recherche globale, préférences, rétention automatique ni mesure de coût à grande échelle. Ces capacités restent ouvertes et ne sont pas remplacées par les compteurs du brief.
