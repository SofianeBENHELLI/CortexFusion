# Console Cortex Fusion — démonstration locale

Première implémentation React 18 / TypeScript de la référence **Cortex Fusion v3** fournie dans l’archive du 9 septembre. La v3 est la référence visuelle, la v2 et la v1 restent des variantes de conception. Aucun `support.js`, runtime du prototype ou document confidentiel n’est embarqué.

## Démarrer

Depuis la racine du dépôt, avec Node 22+ et pnpm 10 :

```sh
pnpm install
pnpm --filter @cortexfusion/console dev
```

Ouvrir http://127.0.0.1:5173. Il n’est pas nécessaire de lancer PostgreSQL, TerminusDB ou Rust. Les polices Manrope et les icônes sont embarquées ; aucune dépendance CDN, clé API ou requête vers le backend.

```sh
pnpm --filter @cortexfusion/console build
pnpm --filter @cortexfusion/console test
pnpm --filter @cortexfusion/console exec playwright install chromium
pnpm --filter @cortexfusion/console test:e2e
```

## Essayer les parcours

1. **Valider → publier** : À valider → SIMULIA / PR-3082 → Approuver → renseigner une raison → Confirmer. Les réponses restent en v41. Publier v42 demande une seconde confirmation. Le suivi passe par une publication simulée, puis la version et les relations changent. Un rechargement conserve le résultat.
2. **Échec → reprise** : avant publication, ouvrir Démo locale et cocher « Échec de la prochaine publication ». Le diagnostic DG-7f3a apparaît, le savoir publié reste inchangé. Réessayer la publication permet de terminer. Le réglage d’échec est consommé une seule fois. Le reçu dans la conversation évolue vers le résultat final, succès avec version ou échec avec lien vers le suivi.
3. **Réponse → retour → correction** : demander le périmètre de SIMULIA ; cliquer le pouce négatif, ajouter un commentaire ; ouvrir le signal créé dans Signaux utilisateurs ; créer une correction en choisissant le concept, la cible de relation et la source justificative, puis une raison distincte. Le texte de la preuve reste visible et une confirmation de lecture est requise. La proposition liée est consultable et ne modifie pas le savoir publié.
4. **Correction d’une relation** : Concepts & relations → SIMULIA → Corriger, puis cible et raison. La relation actuelle reste en place jusqu’à approbation et publication. Le bouton « Proposer une relation » ajoute une relation au lieu de remplacer la précédente.
5. **Import → proposition** : Sources & imports → importer un TXT/Markdown non vide de moins de 500 Ko. L’extraction progresse jusqu’au statut « Texte extrait ». Un formulaire demande ensuite le nom du concept, sa description complète, la cible de relation et la justification. La preuve doit être examinée avant création de la proposition : le mock ne réalise aucune extraction sémantique par IA et ne transforme plus le nom du fichier ou un extrait tronqué en connaissance. PDF/DOCX sont refusés avec une explication explicite dans cette simulation ; le backend possède leurs vrais parseurs.
6. **Accès** : Démo locale → rôle Lecteur. Consultation et feedback disponibles ; décisions/imports/corrections désactivés et refusés aussi par le mock. La vue Administration est réservée au rôle Administrateur. Le journal administratif est masqué aux autres rôles. Le rôle de simulation est conservé dans la session du navigateur.
7. **Conversation** : « Approuve PR-3082 » ouvre une demande de confirmation, sans mutation. « Approuve cette proposition » utilise uniquement la proposition ouverte ; sans contexte explicite, aucune cible arbitraire n’est choisie. Les questions connues reçoivent une réponse progressive et une citation cliquable ; une question inconnue donne un refus explicite. Les conversations sont conservées, les URL de vues/détails sont partageables et le retour navigateur fonctionne.

Démo locale permet aussi de simuler une indisponibilité et de réinitialiser les données avec confirmation. Le contenu importé et les conversations restent dans le stockage de ce navigateur. Utiliser des fichiers de démonstration. La dictée utilise la capacité du navigateur si disponible, après activation explicite ; ce navigateur peut recourir à son propre service de reconnaissance. Aucune fausse transcription n’est générée en cas d’indisponibilité.

## Architecture

- `src/main.tsx` : vues, conversations, formulaires et navigation React Router.
- `src/styles.css` : tokens Industry, panneaux, états et adaptations mobile.
- `src/mock.ts` : modèle de démonstration, transitions asynchrones, droits simulés, persistance locale.
- `src/backend-map.ts` : correspondance vérifiée vers les identifiants d’opérations réels.
- TanStack Query : chargement, rafraîchissement et invalidation des données. Zustand : historique et état de conversation. react-intl : contexte français et dates. react-markdown : corps des réponses, sans HTML brut.

## Ce qui est représentatif et ce qui reste simulé

Les états, la séparation **accepté / publié**, les raisons requises, la révision des propositions devenues obsolètes, les droits, les refus, les signaux et les effets transversaux sont représentatifs. Les compteurs correspondent exactement aux petites collections de démonstration, plutôt qu’aux grands chiffres décoratifs du prototype.

Le mock est un **adaptateur de présentation**, pas un émulateur exhaustif du protocole HTTP. Ses objets `State`, `Proposal` et `Signal` ne sont pas les payloads du backend. La couche réseau devra transformer les DTO, utiliser les UUID du backend et relier les reçus réels. Aucun serveur MCP n’est lancé par cette console : le serveur MCP réel reste fourni par le backend.

Points de branchement à respecter :

| Fonction               | Opérations backend                                                                          | Adaptation requise                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Brief / concepts       | `domain.brief`, `domain.version`, `concepts.list/read`                                      | Agréger les cartes ; garder les versions des réponses                                                                      |
| Validation             | `proposals.diff`, `proposals.approve`, `proposals.review`                                   | Digest réel, version attendue, révision de revue, raison et clé d’idempotence                                              |
| Publication / reprise  | `proposals.publish`, `proposals.publication_attempts/events`, `proposals.retry_publication` | Suivre les tentatives réelles ; ne pas remplacer un statut incertain par un succès ou un simple nouvel appel               |
| Correction             | `proposals.create/revise`                                                                   | Construire un `PutConcept` complet ; preuves et types de relations réels                                                   |
| Feedback               | `episodes.feedback`, `feedback.record_signal`                                               | Relier le retour à l’épisode et à la réponse ; idempotence                                                                 |
| Traitement des signaux | `issues.list/decide/history`                                                                | Un signal brut n’a pas d’endpoint universel « marqué traité » : lier les signaux aux issues et propositions de gouvernance |
| Fichiers / sources     | `files.upload/process/read`, `sources.propose`                                              | Collection réelle, multipart, job/erreurs et documents extraits                                                            |
| Membres                | `members.list/change/history`                                                               | Sujet authentifié, révision attendue et confirmation signée                                                                |
| Journal                | `commits.list`, historiques membres/publication                                             | Agrégation de plusieurs flux filtrés, pagination                                                                           |
| Conversation           | `conversations.create/query/messages`                                                       | Stockage serveur, épisodes, citations et authentification                                                                  |

Les confirmations sont visuelles ici. En réel, la signature de confirmation, la session et les contrôles d’autorisation restent côté backend/companion autorisé : ne jamais installer une clé de signature dans le frontend. Le mock n’implémente ni la cryptographie, ni la concurrence multiutilisateur, ni la gestion exhaustive des erreurs réseau.

La réponse progressive est une simulation dans le navigateur, pas un endpoint SSE revendiqué. Le routage des quelques commandes texte est déterministe, sans LLM. L’analyse automatique de satisfaction, les longues itérations et l’exploitation de toutes les préférences de feedback restent à brancher sur les épisodes et signaux réels. La mémoire est une vue agrégée, pas un nouveau moteur d’archivage.

## Tests

Les tests de modèle vérifient les transitions de publication, l’échec/reprise, les versions obsolètes, les droits, les corrections et les refus d’import. Le test de correspondance recherche chaque identifiant d’opération dans les contrats OpenAPI et extensions Rust du dépôt. Playwright vérifie les trois parcours principaux, la confirmation par chat, la résolution du contexte implicite, les droits et le mobile. Validation du 25 septembre 2026 : 32 tests unitaires/composants/contrats et 7 parcours Playwright réussis, compilation TypeScript et build Vite réussis. Une vérification Computer Use a aussi couvert le contexte de proposition, le formulaire de correction, Échap dans les réglages et les accès mobiles à 390 × 844. Ces tests qualifient le mock, pas la connexion au backend réel.

## Historique mobile et limites restantes

Sur mobile, le bouton « Historique des conversations » ouvre un panneau dédié avec les titres complets. Échap ferme le panneau et restitue le focus ; sélectionner une conversation la rouvre. Les données déjà conservées dans le navigateur sont préservées : les anciennes propositions produites avant ces corrections ne sont pas régénérées. Utiliser de nouvelles propositions pour vérifier les formulaires corrigés. La validation de preuve est une attestation utilisateur dans ce mock, sans contrôle sémantique automatique.

## Préparation du mode API

Le [guide de branchement API](API-INTEGRATION.md) décrit le mode `api`, la session en mémoire, les huit opérations typées et les erreurs. Identité, domaines, versions, conversations, citations et feedback sont branchés dans ce mode ; la gouvernance reste disponible dans le mock.
