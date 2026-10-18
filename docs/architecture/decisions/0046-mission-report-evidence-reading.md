# ADR 0046 — Relecture humaine des preuves de mission

17 octobre 2026. Statut : adopté pour le protocole de mission borné, sans clôture B10.

Le rapport candidat conserve des plages réellement lues, mais afficher seulement leurs positions ne permet pas au coordinateur de vérifier la conclusion. Une lecture GET dédiée renvoie un seul passage cité, index 1–10 et révision du rapport obligatoires. Seul l’auteur encore owner/manager y accède, sur mission completed et source/hash encore autorisés aux deux acteurs, agent toujours membre. Les autres coordinateurs et le service n’obtiennent pas cette voie de lecture humaine. Une échéance passée n’annule pas la relecture humaine d’un rapport terminé ; elle interdit toujours l’exécution du mandat.

Cette lecture ne change ni révision, journal, compteur agent, approbation ou publication. Elle renvoie identifiants, empreinte, emplacement, positions Unicode, longueur totale et texte exact ≤8192 caractères. L’UI et la commande chat partagent le mécanisme et retirent le précédent passage avant relecture ; toute perte d’accès retire également le mandat. Aucune persistance du passage dans le navigateur, aucun appel modèle.

La préparation et l’autorisation lisent char_length(content), sans rapatrier le corps source. Les deux lectures de passage utilisent substring côté PostgreSQL après verrou partagé et contrôle ACL/hash ; un résultat plus court que la plage est refusé, jamais accepté comme troncature. Cela borne le transport et la matérialisation dans le service Rust, pas le coût de scan/décompression PostgreSQL. Aucune promesse de coût global constant ou quota des autres droits de l’agent.

Le BFF accepte explicitement cette route GET et expected_revision, avec plafond de réponse 65536 octets ; aucune généralisation du proxy ni des identifiants numériques. Le contrat MCP annonce la révision obligatoire et les mêmes droits. Pas de migration.
