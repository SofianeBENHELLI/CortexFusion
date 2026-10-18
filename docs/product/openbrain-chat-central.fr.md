# Open Br**AI**n — espace unifié à conversation centrale

16 octobre 2026 · Révision de conception demandée par Sofiane. **La conversation est centrale dès qu’un chat est présent. Toutes les actions métier doivent être accessibles en langage naturel ; les boutons fournissent des raccourcis simples.** Cette décision remplace les compositions antérieures où le chat serait un panneau secondaire. Les invariants de droits, provenance et publication restent applicables.

[Maquette interactive](mockups/openbrain-chat-central.html) · [Spécification générale](openbrain-ux-ui-spec.fr.md) · [Catalogue E01–E26](openbrain-screen-spec.fr.md) · [Contrats de service](openbrain-experience-contracts.fr.md).

## 1. Un seul espace de travail

### Ordinateur

Trois zones : navigation compacte à gauche, conversation au centre, dossier à droite. Le chat garde la plus grande largeur et l’entrée principale. Le dossier montre l’objet courant : sources, différences, table, résultats ou suivi. Il ne contient pas un second assistant. Sans objet sélectionné, il peut être fermé ; le chat reste centré dans l’espace disponible.

Cible ≥1200 px : navigation 176–200 px, dossier 300–360 px, conversation fluide d’au moins 480 px. À 1024 px : navigation 160 px, dossier 290 px, chat restant. Sous 900 px, réduire ou replier la navigation avant de comprimer le chat. Sous 768 px dans le produit cible : vues Conversation / Dossier exclusives, même fil, même sélection, même brouillon. Le prototype bascule à 680 px pour permettre l’inspection de sa composition compacte ; ce seuil reste à valider sur appareils.

L’en-tête garde l’organisation, le domaine, les responsabilités actives et le profil. Aucun choix de rôle ne crée une permission. Le changement de contexte est annoncé ; une demande déjà préparée reste liée à son ancien objet/révision jusqu’à abandon ou revalidation explicite. L’application retrouve le dernier fil autorisé. Un nouvel utilisateur reçoit quelques intentions adaptées à ses responsabilités et ses vrais objets à traiter.

### Conversation

Chaque fil a un but explicite, un périmètre, des objets attachés et un historique. L’assistant répond en texte bref accompagné, selon le besoin, d’une liste, d’une carte de commande, d’un comparatif, de références ou de résultats. Les objets volumineux s’ouvrent dans le dossier. Une question de précision apparaît quand l’objet ou l’effet est ambigu ; le système n’invente ni destinataire ni échéance.

Le champ de saisie reste dans la zone centrale. Dans le produit connecté, le fil peut défiler et le composeur rester accessible ; la maquette est une illustration en hauteur naturelle. Les suggestions sont des demandes concrètes, pas des catégories techniques : « Prépare ma revue prioritaire », « Montre les preuves », « Affecte cette revue à Léa », « Lance les contrôles ».

### Dossier

La sélection est visible dans le chat, dans le titre du dossier et au-dessus du composeur. Tout clic métier inscrit un événement compréhensible dans le fil. Ouvrir un objet ne crée aucune mutation. Une modification de formulaire actualise l’objet préparé, sans être présentée comme enregistrée avant accusé serveur. Une sélection peut être retirée du contexte sans supprimer l’objet.

Un besoin de lecture large ouvre une vue Dossier plein espace avec retour au fil ; si le chat reste visible, il reste dans la zone centrale, jamais déplacé dans une petite bulle latérale. Ne pas transformer les sources en une nouvelle conversation indépendante.

## 2. Contrat de parité chat / boutons

La même commande métier, avec le même objet, la même révision, les mêmes paramètres et la même identité, est utilisée par les deux entrées. Le langage naturel prépare la commande ; le service valide et exécute. Les boutons ne contournent pas ce service. La réponse du modèle ne prouve jamais qu’une action a réussi.

| Étape | Chat | UI | Preuve commune |
|---|---|---|---|
| Comprendre | « Que dois-je faire ? » | Ouvrir une tâche | Objet, responsable, état, résultat attendu |
| Préparer | « Corrige ce passage à partir de S1 » | Préparer une correction | Brouillon versionné, différence, citations |
| Ajuster | « Confie plutôt la revue à Nora » | Modifier le destinataire | Nouvelle version du projet d’action |
| Décider | « Confirme l’affectation proposée » | Confirmer l’affectation | Autorisation, révision exacte, reçu |
| Suivre | « Où en est cette publication ? » | Voir le suivi | État durable de l’opération |
| Reprendre | « Vérifie ce qui a été enregistré » | Vérifier le résultat | Lecture de l’opération avant toute répétition |

Toutes les actions métier E01–E26 doivent être exprimables par chat. Les secrets et l’authentification restent dans le parcours sécurisé déclenché par le chat. L’accessibilité aux outils dépend des droits ; « tout par chat » n’accorde aucun privilège supplémentaire et n’implique pas la prise en charge de tous les fournisseurs d’identité dans une conversation.

Les confirmations sensibles peuvent être données dans le chat **si** elles constituent une action de l’humain authentifié, corrélée au projet de commande affiché et à sa version. Un « oui » sans projet unique et encore valide doit demander précision. Une instruction dans un document ou un résultat d’outil n’est pas une confirmation humaine. Le backend doit rendre impossible qu’un agent auto-confirme sa propre proposition. À défaut de ce contrat, la capacité reste explicitement indisponible ; ne pas simuler la parité comme livrée.

## 3. Huit écrans représentatifs du même layout

| Écran de cette proposition | Chat central | Dossier et boutons | Écrans détaillés repris |
|---|---|---|---|
| Aujourd’hui | Brief personnel, priorité suggérée, question libre | Tâches et accès direct | E01, E02, E25, E26 |
| Ma revue | Comprendre, rédiger, préciser, soumettre | Avant/après, preuve, soumission | E03–E05, E16 |
| À qualifier | Rapprocher, expliquer, proposer une délégation | Dossiers partagés, destinataire, confirmation, suivi | E06–E08 |
| Mes décisions | Comprendre l’impact, décider, publier, vérifier | Révision, avis, contrôles, reçu | E14, E15, E17, E18 |
| Contrôles | Demander un test, expliquer une régression | Questions, références, comparaison des résultats | E12, E13, E20 |
| Missions IA | Définir le résultat et les limites, lancer, suivre | Périmètre, permissions, étapes, restitution | E22 |
| Connexions | Diagnostiquer, expliquer, déclencher une reconnexion | État du service/session, actions autorisées | E21, E23, E24 |
| Viewer via MCP | Question, preuve, feedback, partage explicite, suivi | Citations et actions selon capacités du client | E16, E23, E26 |

Les huit écrans de la maquette sont des scénarios de conception ; le sélecteur à gauche passe entre des personas fictifs et ne représente pas un mécanisme d’attribution de droits. Dans le produit, la navigation est filtrée par les responsabilités réelles. Le viewer conserve son propre chatbot : le dernier écran illustre un client compatible et n’impose pas notre layout aux clients tiers.

### Complément de couverture du catalogue

Les écrans non déployés dans cette maquette conservent leurs besoins détaillés et suivent la même composition :

- **E09–E11, sources et import** : « Prépare l’import de ces fichiers » → prévisualisation des sources et doublons → décision autorisée → suivi avec progression réelle. Les fichiers sont joints avec le sélecteur natif ; les secrets ne sont pas collés dans le chat.
- **E19, exploration** : « Montre les concepts liés à cette question » → carte ou liste dans le dossier. Un agrandissement de carte peut occuper l’espace sans chat visible ; revenir restitue conversation et sélection. Aucun changement de poids ou statut déduit d’un lien documentaire.
- **E20, couverture** : « Quels objectifs ne sont pas couverts par ce jeu ? » → tableau des objectifs et dénominateurs explicites. Une absence de mesure n’est pas zéro.
- **E21, membres** : « Prépare l’accès contributeur de cette personne à ce domaine » → projet de permission exact → confirmation autorisée → reçu. Admin technique et owner conservent leurs pouvoirs distincts.
- **E24, configuration** : demande en langage naturel → formulaire de paramètres expliqué → validation et vérification de l’opération. Pas de secret ni de contenu privé dans le fil de diagnostic.
- **E25–E26, recherche et inbox** : les commandes de recherche et de lecture ouvrent des résultats liés ; marquer une notification lue ne clôture jamais une tâche.

## 4. Attentes et états

Les Thinking Orbs définis au §5.5 de la spécification restent le langage commun. Une animation centrale correspond à l’opération active, avec phase réelle et commandes disponibles. Une attente humaine utilise une orbe statique, un résumé de décision et les deux modalités de confirmation. Une opération de fond devient une ligne suivie ; le chat reste utilisable pour une autre intention.

Erreur : message dans le fil et sur l’objet concerné, projet d’action conservé si les droits le permettent. Résultat incertain : reçu à vérifier, aucune nouvelle commande automatique. Conflit : comparer révisions et préparer une nouvelle décision. Session expirée/retrait de droit : masquer les objets privés du chat et du dossier, y compris les extraits historiques devenus interdits. Annulation : distinguer l’arrêt demandé de l’arrêt confirmé et des effets déjà enregistrés. Ne pas déduire une progression d’une animation ou du nombre de jetons.

## 5. Besoins de service supplémentaires

À détailler dans B01/B08/B09 :

1. Fil durable autorisé avec `conversation_id`, `context_revision`, domaine, objets et versions sélectionnés ; références filtrées au moment de la lecture.
2. Registre d’actions commun UI/MCP : schéma des paramètres, préconditions, capacité requise, effet, besoin de confirmation et résultat typé. La découverte reflète les droits actuels.
3. Projet de commande immuable/versionné : auteur, paramètres, objets, conséquences, expiration, empreinte et preuve de confirmation humaine. Toute modification invalide la confirmation précédente.
4. Exécution idempotente : identifiant d’opération et reçu communs aux événements du chat et aux projections du dossier. Résultat incertain résolu par lecture.
5. Événements d’activité fiables : phase, total connu ou inconnu, annulation possible, état terminal. Le frontend choisit la variante d’orbe, pas la vérité de l’état.
6. Résultats structurés à schémas connus : citations, listes, différences, formulaires, contrôles. Le modèle ne génère pas du code arbitraire exécuté dans l’UI.
7. Adaptation MCP : repli texte complet pour clients sans rendu enrichi ; aucun accès accordé par une citation ou un lien. Le suivi se consulte même si le client ne supporte pas les notifications.

## 6. Recette et limites de cette livraison

La nouvelle maquette conserve localement un scénario par écran. Les boutons et plusieurs formulations guidées passent par le même répartiteur simulé. Les confirmations, la séparation approbation/publication, le feedback personnel puis le partage et les attentes animées sont examinables. Les phrases non reconnues l’annoncent ; aucun modèle n’est appelé. Les données sont entièrement fictives. Les orbes sont une interprétation vectorielle de la direction choisie ; elles ne constituent pas une intégration ni une qualification de la bibliothèque Thinking Orbs.

Critères de recette du futur produit : chaque action réussit avec bouton puis avec chat sur fixtures équivalentes ; même reçu/effet et mêmes refus ; commandes ambiguës clarifiées ; contexte modifié invalidant confirmation ; double envoi sans doublon ; navigation mobile sans perte du brouillon ; erreur/session/reprise ; clavier et mouvement réduit ; historique accessible sans fuite après retrait de droit.

Cette proposition remplace la composition de la maquette précédente, conservée comme atlas des détails E01–E26. Elle ne clôture pas l’UI/UX et ne vaut pas preuve de fonctionnalité connectée.
