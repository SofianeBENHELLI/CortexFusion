# Console Open Br**AI**n — démonstration locale

Première implémentation React 18 / TypeScript de la référence **Open Br**AI**n v3** fournie dans l’archive du 9 septembre. La v3 est la référence visuelle, la v2 et la v1 restent des variantes de conception. Aucun `support.js`, runtime du prototype ou document confidentiel n’est embarqué.

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

L’accès API dispose désormais d’un adaptateur optionnel de session serveur (`VITE_AUTH_MODE=session`), avec restauration au chargement, connexion au fournisseur configuré, CSRF et purge du cache à expiration/logout. Le [guide de raccordement](API-INTEGRATION.md#session-serveur-optionnelle--développement-local) précise le gateway à lancer, les variables et les limites. Le mode manuel reste inchangé par défaut ; le nouveau mode a des tests de composants/transport/HTTP, et la chaîne HTTP complète vers le natif a été éprouvée sur fixture synthétique ; sa recette Chrome et un fournisseur réel restent ouverts.

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

Le [guide de branchement API](API-INTEGRATION.md) décrit le mode `api`, la session en mémoire et les erreurs. Identité, domaines, versions, conversations, citations, feedback, tickets et revue des propositions sont branchés dans ce mode, ainsi que la tranche BrainMap documentée ci-dessous. Les opérations typées sont maintenues dans `src/api/operations.ts`.

Le point d’entrée charge exclusivement l’application du mode configuré. Le build API exclut le mock, son stockage et le catalogue OKF. Vue d’ensemble, BrainMap et conversations/gouvernance sont chargés à leur ouverture ; une erreur d’ouverture affiche une récupération explicite tout en conservant la navigation de l’espace connecté. « Recharger la page » conserve le lien mais exige une nouvelle connexion, puisque le jeton reste en mémoire. Le catalogue et les conversations de démonstration existants sont conservés dans le mode mock.

Pour vérifier les deux variantes avec les dépendances installées :

```sh
npm test --prefix apps/console -- --reporter=dot
npm run build --prefix apps/console
VITE_DATA_MODE=api npm run build --prefix apps/console -- --outDir ../../.runtime/brain/console-api-dist --emptyOutDir
```

La dernière commande vide uniquement ce répertoire de build généré, pour ne pas confondre d’anciens chunks avec la livraison courante. Les tailles minifiées ne qualifient ni le temps de chargement, ni la capacité du graphe.

## Recette connectée

Pour distinguer les parcours API effectivement raccordés des démonstrations mock, suivre le [guide d’essai du frontend connecté](../../docs/frontend-real-acceptance.fr.md). Il décrit l’authentification locale, les conversations, tickets, propositions et confirmations, ainsi que les limites actuelles.

La [matrice de recette du 3 octobre](../../docs/product/frontend-acceptance-matrix.fr.md) donne les résultats navigateur par parcours et les fonctions absentes, sans confondre simulation et raccordement. Le [bilan de préparation au pilote](../../docs/product/brain-pilot-readiness.fr.md) rassemble les preuves courantes, les limites et les consignes de reprise ; les résultats du 25 septembre ci-dessus restent un jalon historique.

## BrainMap et Chronique — première tranche

La vue `/views/brain` présente le savoir publié du mock et les changements enregistrés depuis l’activation de son suivi. Cliquer le domaine puis un voisinage révèle les concepts et relations ; la sélection ouvre les preuves. Le journal partage le périmètre et la période avec la carte. Le contexte est conservé dans l’URL et restauré au retour/rechargement. Les thèmes Système, Clair et Sombre sont monochromes ; les couleurs des changements sont facultatives.

Un nouvel onglet « Cerveau » existe aussi après connexion API et sélection d’un domaine. La carte utilise `graph.window` : 24 résumés par page, stocks autorisés distincts du nombre dessiné, navigation aller/retour et centre conservé dans le voisinage sortant. La recherche consulte tout le domaine autorisé ; une sélection depuis la recherche ou la Chronique positionne la page concernée. `concepts.read` charge le détail sélectionné et les preuves sont relues à la demande. Les curseurs spatiaux sont conservés dans l’URL.

Le journal des publications exige actuellement le rôle owner et charge les différences auditées de 20 publications par page, des plus récentes vers les plus anciennes. « Publications plus anciennes/récentes » parcourt un intervalle et une version fixes. Un changement de période ou une actualisation revient à la première page. Les droits restent actuels ; version et visibilité sont vérifiées avant/après les lectures, et un changement invalide la vue. Les compteurs de changements restent ceux de la page du journal et du périmètre, avec un avertissement tant que la période est partielle. Les événements des voisins hors page restent inclus ; ces voisins ne deviennent pas des traces historiques. Cette adaptation ne qualifie pas la grande volumétrie : le serveur charge encore le snapshot entier et les différences compactes du journal conservent les relations, dont les volumes denses restent à qualifier.

Le contrôle « Profondeur du journal » permet une lecture étendue de cinq pages serveur, jusqu’à cent publications (`history_pages=5`). Si toutes les publications accessibles et datées de la période sont couvertes depuis la première page, la frise devient complète. Sinon elle reste partielle avec continuation. Chaque lecture repart des droits et versions courants, relit les pages après les différences et conserve les vérifications finales du graphe. Des budgets de JSON et d’événements ainsi qu’une annulation à 45 secondes évitent une accumulation sans borne ; un dépassement masque le résultat et permet de réduire la profondeur. Ce mode ne remplace pas l’agrégation serveur. Voir [ADR 0006](../../docs/architecture/decisions/0006-bounded-extended-journal.md).

Le rendu de la Chronique est borné séparément : cinq événements en aperçu, puis quarante par page avec accès direct au numéro de page. Le [jeu connecté de 1 000 concepts](../../docs/product/brain-scale-1000.fr.md) vérifie 3 019 événements sur 76 pages. Cette pagination allège le DOM, sans réduire à elle seule le coût de collecte serveur ou qualifier une charge de production.

La frise des changements ajoute une lecture temporelle monochrome : 24 intervalles pour 24 heures ou l’historique disponible, 7 pour sept jours, 30 pour trente jours. Les intervalles sont des durées écoulées en UTC, pas des jours calendaires locaux. Un clic filtre les deltas de la carte, le journal et les compteurs de changements ; les stocks restent courants. `time_from` et `time_to` conservent dans l’URL les bornes inclusives/exclusives exactes. Le retour/rechargement restaure cette sélection et le focus ; changer de période l’efface. La frise compte les événements une fois, distingue les publications ayant produit ces événements et garde ses bornes au changement de périmètre spatial. Les intervalles incomplets sont hachurés : absence de barre ≠ absence d’activité. Elle ne calcule ni tendance comparative complète ni nouvel état historique, et n’ajoute aucune lecture serveur.

Les mécanismes de mémoire active, poids automatiques, archivage et sommeil restent non instrumentés ; la console ne les présente pas comme fonctionnels. Un poids modifié par publication peut être observé sans en déduire un mécanisme automatique. Voir le [suivi de réalisation et de recette](../../docs/product/brain-delivery-status.fr.md).

Le changement du marqueur de relation principale est lui aussi expliqué par publication, avec son état avant/après et ses preuves. Il n’incrémente ni les créations de relations ni les renforcements. Si un voisinage devient indisponible, l’actualisation revient à la synthèse après vérification des droits et nettoie le focus dans l’URL. Les erreurs d’accès et de version continuent de masquer la lecture précédente.

Après connexion, « Vue d’ensemble BrainMap » affiche six domaines accessibles par page, leur version publiée et leurs stocks autorisés. Les totaux portent seulement sur la page ; une lecture incomplète les rend indisponibles. Chaque domaine est observé séparément : pas de version globale ni de relation entre domaines inventée. L’ouverture d’un domaine mène à sa carte et sa Chronique, avec retour navigateur et restauration après reconnexion. Les paramètres `api_domain`, `api_view` et `domains_page` portent ce contexte dans l’URL ; les jetons restent uniquement en mémoire. La liste des domaines est relue lors de l’actualisation. Voir [ADR 0005](../../docs/architecture/decisions/0005-domain-overview-observations.md).

### Explorer un bundle OKF local

Préparer le ZIP depuis la racine du dépôt avec `python scripts/prepare_okf_bundle.py /chemin/bundle.zip --output .runtime/brain/okf`, puis ouvrir « Cerveau » → « Charger un catalogue OKF » et choisir le `catalog.json` produit. Le texte n’est pas envoyé au backend. Le catalogue est conservé dans IndexedDB sur ce navigateur ; si ce stockage échoue, il reste disponible pour la session. « Retirer le corpus local » retire cette copie, sans toucher au ZIP ni au cerveau de démonstration.

L’aperçu distingue territoires, familles et fiches, avec macro-connexions, recherche sans accents, références entrantes/sortantes et texte source intégral. Les statuts `draft`, `stable` et `deprecated` restent ceux du corpus. Ils ne deviennent ni maturité Cortex ni archivage. Aucun événement d’apprentissage, poids ou type de relation n’est inventé. La vue de publication reste distincte.

Les familles de plus de 24 fiches se subdivisent par marques déclarées, puis par plages alphabétiques, avec au plus 12 enfants par regroupement et 24 fiches par feuille. Ce classement de navigation ne crée aucune connaissance. Les compteurs et macro-connexions suivent le niveau sélectionné ; les liens directs restaurent tous ses ancêtres. Les plages restent stables pour un même catalogue, mais leurs frontières peuvent changer lors d’un nouvel import.

Le rendu est paginé : 12 éléments par page sur grand écran, 6 sur petit écran, 24 macro-connexions principales et 60 relations détaillées au maximum. Une recherche ou une sélection historique amène directement à la page correspondante. Ces bornes et ce regroupement local protègent le rendu ; l’agrégation serveur et les groupes stables entre versions comparées restent à réaliser dans BRN-04.

`node scripts/measure_brain_catalog.mjs .runtime/brain/okf/catalog.json` mesure séparément le parsing/contrôle, la préparation du modèle et l’agrégation des territoires. Cette mesure Node exclut le navigateur, le stockage, le réseau et le serveur ; elle ne qualifie pas la capacité de production.
