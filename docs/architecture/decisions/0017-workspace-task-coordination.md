# Coordination des tâches sans exposition des conversations privées

16 octobre2026 — décision locale pour la fenêtre autorisée, implémentation et recette en cours.

B02 autorise une tâche autonome sans signal. Cette tranche crée un objet de travail de domaine, distinct du signal personnel et du futur SharedCase. Owner/corpus_manager créent une consigne et des critères explicitement destinés à l’équipe ; aucune API ne copie un épisode, une conversation ou un feedback dans une tâche. Le partage opt-in B03 reste séparé.

Le coordinateur (owner/corpus_manager courant) voit les tâches du domaine. Le contributeur courant voit uniquement celles qui lui sont actuellement proposées/affectées. Viewer et agent ne reçoivent pas cette capacité ; les missions agents B10 exigent leur propre mandat. L’annuaire d’affectation contient seulement les identifiants et rôles des membres humains éligibles, pour les coordinateurs. Une affectation ne donne aucun droit sur une source, une proposition ou un autre objet ; cette première tranche ne joint pas ces objets.

Cycle : non affectée → proposée → en cours → bloquée / en revue → terminée ; refus → non affectée, retour de revue → en cours, annulation motivée, réouverture motivée → non affectée. Les changements vérifient acteur, état, révision et idempotence sous verrou. Le rôle d’owner ne transforme pas une clôture de tâche en approbation ou publication de savoir. Aucun effet sur poids/maturité/archives.

Consigne, critères et échéance sont fixés à la création pour cette tranche ; toute modification future aura une révision dédiée. Réaffecter une tâche active requiert une annulation/réouverture explicite, afin de ne pas masquer des travaux en cours. Les dates de création et événements ne sont jamais remises à zéro. Le résultat remis et le motif sont conservés dans l’historique ; la clôture exige un résultat et une décision du coordinateur.

Chaque commande produit un événement/reçu immuable dans la même transaction. Une outbox de coordination, indépendante de celle des commits de savoir, porte uniquement des identifiants de tâche/événement/destinataire ; aucun envoi externe ni worker de notifications n’est annoncé tant qu’il n’existe pas. Toutes les lectures recontrôlent le rôle/affectation courants. Le journal de tâche n’accorde pas de droit aux anciens affectataires révoqués.

La mutation de coordination est une intention utilisateur explicite, présentée avant exécution dans l’UI/chat, sans signature owner de publication : elle ne change ni ACL, ni savoir accepté/publié. La frontière de confirmation indépendante ADR0016 reste inchangée pour les actions sensibles. Pas de clé de signature dans le frontend/BFF.

Limites choisies : stockage PostgreSQL/RLS existant, verrou de domaine pour les écritures (coût à mesurer), pagination bornée et absence de compteur global inventé. Pas encore de rôles cumulables, SharedCase, critères évalués automatiquement, rattachement de preuve/révision, recherche de tâche, SLA/notification distribuée ou mission agent. Les tests synthétiques doivent établir droits, concurrence, idempotence et reprise avant livraison de la tranche.

Complément du lot5 : tri chronologique stable, total exact dans le périmètre autorisé et curseurs opaques expirant15min après la première page. Version du travail et des appartenances invalident une traversée modifiée. Les lectures restent bornées50 et ne font pas passer un plafond pour un total. La projection de l’outbox est maintenant consultable par son destinataire avec droits courants ; marquer lu est idempotent et personnel, indépendant de l’état métier. Aucun transport externe. La purge physique des curseurs expirés et les politiques de rétention restent à définir.
