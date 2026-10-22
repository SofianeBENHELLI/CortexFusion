# ADR0039 — Avis à préparer et revues à suivre dans l’accueil

17 octobre 2026 — accepté localement. Complète ADR0036 et l’accueil opérationnel de la spécification chat central.

## Décision et périmètre
`work_overview.read` retourne deux groupes distincts. Un responsable voit les copies qui lui sont nommément adressées et attendent son avis. Un auteur humain voit ses copies non retirées, même après un avis favorable ou une demande de corrections. Les deux prédicats imposent l’accès courant à la source et son empreinte exacte. Un rôle sans la catégorie reçoit null, jamais un faux compteur zéro. Le périmètre domaine élargit seulement les tâches.

Total complet puis cinq plus anciennes copies autorisées, dans le même snapshot PostgreSQL que le reste du brief. Métadonnées question/auteur/destinataire/état/révision/dates ; aucun extrait de source ni motif dans l’agrégat. Les nouvelles écritures de revue incrémentent work_revision une fois dans la transaction ; un rejeu du reçu ne l’incrémente pas. Le compteur ne constitue pas un score de qualité du corpus.

L’entrée choisit la première catégorie non vide suivant l’ordre explicite de l’interface, sans priorité inférée. Un choix utilisateur reste respecté. Boutons et phrases chat ouvrent les mêmes catégories. Une carte relit directement la copie via son UUID et les droits courants, sans imposer une liste intermédiaire. Un avis confirmé invalide le brief local ; les autres fenêtres le relisent à leur cadence existante. Le reçu historique ne prouve pas l’état présent.

## Alternatives, limites et preuves
Ne pas compter toutes les revues du domaine ni assimiler ready_for_owner à approuvé. Les décisions de publication, missions et contrôles officiels restent hors de cet accueil. Aucun changement de schéma ni migration.

Six groupes natifs avec sept copies, dénominateur/top5/tri, idempotence, avis, retrait, rôle et ACL, MCP et version de savoir inchangée.683 tests console,76 Python, TypeScript/build. Chrome : ouverture directe, focus, avis UI/chat et compteur5→4, suivi auteur5/6, retrait/restauration ACL, mobile390 clair/sombre. Journal lot31.
