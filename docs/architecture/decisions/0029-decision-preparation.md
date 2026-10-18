# ADR0029 — Préparer une décision sans usurper sa confirmation

17 octobre 2026. Tranche de B05, pas clôture du parcours de décision.

## Constat

Le dossier de proposition proposait des commandes de revue sans filtrage par les capacités du lecteur. La console ne dispose toujours pas d’un hôte humain indépendant configuré (ADR0016). Ajouter un bouton qui signe automatiquement depuis la session supprimerait cette frontière.

## Décision

Les actions de préparation dépendent à la fois de l’état de la proposition et des capacités effectives. Boutons et phrases guidées utilisent le même mécanisme : relire identité, version du domaine et proposition ; vérifier digest, révision, base et état ; construire la commande exacte du contrat HTTP/MCP existant. Une incohérence masque ou bloque la préparation. Les lectures sont annulées au démontage ; une intention préparée ne peut pas être remplacée silencieusement.

L’approbation exige une proposition prête sur la version publiée courante, sans lot accepté non publié. La publication exige une proposition approuvée et un lot accepté en attente. Le projet présente acteur, domaine, motif applicable, révision, versions et effet. Les identifiants et le JSON restent repliés. Aucune commande de décision n’est envoyée par cette console. Une phrase de confirmation explique la limite au lieu de simuler un succès. L’hôte de confiance reste chargé de l’examen humain indépendant et de la signature du command hash ; le serveur revalide les droits et préconditions à l’exécution.

## Portée et limites

La préparation est locale et ne réserve ni droit ni version. Actualiser ou quitter peut la supprimer ; cela n’annule jamais une décision exécutée ailleurs. Les reçus de publication, leur reprise durable dans la console, le connecteur d’hôte humain et l’orchestration sémantique restent à livrer. Aucun nouveau contrat, stockage ou endpoint de mutation BFF. Les phrases guidées ne constituent pas un agent LLM.

## Preuves

Sept tests de préparation couvrent lectures fraîches, rôle interdit, versions et révisions divergentes, échecs d’accès, parité de construction et refus d’exécution. Suite console598/598, TypeScript et build session. Chrome : contributeur sans décision, approbation bouton/clavier et chat, intention conservée jusqu’à annulation, publication préparée via les deux entrées sur un domaine synthétique approuvé distinct, mobile sombre et desktop clair. Aucun savoir publié par cette recette.
