# ADR 0048 — Suites des partages dans la boîte personnelle

17 octobre 2026. Complément adopté à ADR0047, sans notification externe.

Un partage clos disparaît du brief des actions ouvertes, alors que son auteur doit encore retrouver la réponse. La boîte inclut donc les événements entrants des dossiers explicitement partagés. Leur auteur, y compris viewer, et les destinataires nommés encore owner/manager peuvent les lire. Les propres actions de la personne ne sont pas des notifications entrantes. Un autre manager n’acquiert aucun accès.

Les métadonnées ne comprennent ni extrait, conclusion, signal d’origine, liste de destinataires, tâche associée ou identité de l’acteur d’événement. La conclusion se lit depuis le dossier existant, sous ses droits courants. Après retrait, tous les anciens titres sont masqués pour les destinataires ; l’auteur conserve les droits déjà prévus sur sa propre copie. La révision de l’événement reste distincte de l’état/révision courants.

La capacité work_activity devient disponible au viewer pour cette seule famille. Les tâches et revues restent réservées aux humains contributeurs/coordinateurs ; les missions à leur auteur encore coordinateur. Une rétrogradation en viewer masque aussi les notifications historiques des autres familles. Aucune nouvelle autorité sur les dossiers ou les sources.

Migration0043 étend seulement la contrainte de type des marqueurs immuables. Même pagination, invalidation, reçu et reprise que ADR0047. Ouvrir ne marque pas lu ; marquer lu ne résout ni ne rouvre un dossier. UI/chat et MCP utilisent les mêmes contrôles. Les imports, décisions de publication, transport de notification négocié et compatibilité avec un chatbot tiers restent à qualifier séparément.
