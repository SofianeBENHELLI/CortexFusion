# ADR0031 — Choisir une source sans identifiant technique

17 octobre 2026. Parcours de contribution B06, sans migration.

La sélection utilise la lecture native `sources.list`, filtrée par les droits actuels et par titre côté serveur. Le BFF autorise explicitement cette seule route GET et ses paramètres ; aucune création de source ajoutée au proxy. Le catalogue est lu par pages de vingt, remplacées à chaque page, avec curseur fourni par le serveur. Aucun total global n’est inventé. Les homonymes restent distingués par position, emplacement et référence repliée.

Boutons et phrases guidées partagent `SourcePicker`. Un numéro ne désigne qu’un résultat de la page chargée. La sélection relit identité et source avant d’exposer le texte. Une erreur de liste masque les anciennes métadonnées ; une réponse tardive après nettoyage/démontage est ignorée. La recherche ne constitue pas un droit à lire le corps ni à proposer un changement.

Changer de source avec des champs modifiés exige une décision locale explicite : conserver le travail ou remplacer les champs. Le brouillon déjà sauvegardé reste distinct et aucune proposition n’est envoyée. Les identifiants techniques restent disponibles sous détails pour les liens existants. Cette tranche ne fournit ni recherche sémantique, ni agent LLM, ni banque de questions, ni couverture de qualité.

Validation : 619 tests console, puis 18 ciblés après ajustement grammatical ; TypeScript/build session ; proxy/local 75 succès et un échec d’attente HTTP corrigé puis revalidé ; trois contrôles natifs sur 22 sources synthétiques ; quatre groupes Chrome (titre/sélection, conservation/remplacement, pagination20+1, restriction/mobile/clavier). Journal de fenêtre pour preuves et limites.
