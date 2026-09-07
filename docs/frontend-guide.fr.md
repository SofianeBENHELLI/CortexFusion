# Guide fonctionnel d'intégration du frontend

Cette référence cadre les fonctions utilisateur, corpus manager et propriétaire de Cortex Fusion. Elle ne prescrit pas de layout. Elle accompagne le frontend React 18 / TypeScript / Vite développé séparément, avec TanStack Query pour les données serveur, Zustand pour les brouillons et états locaux, et une interface française.

La [référence exhaustive des endpoints](frontend-api.fr.md) donne, pour chaque opération, sa fonction, ses paramètres, ses schémas d'entrée/sortie, ses rôles et son outil MCP. Le [catalogue français JSON](../packages/contracts/functional-interactions.fr.json) est utilisable par un outil de génération ou un agent. Les contrats de types sont dans `packages/contracts/src/`. Les fonctions décrites ici sont celles effectivement livrées ; le tableau suivant distingue les écarts.

## Correspondance avec les sept parcours du produit

| Parcours demandé | Disponible | Écart ou limite actuelle |
|---|---|---|
| Interroger le domaine | Recherche publiée, épisode personnel, citations exactes, version servie, manque de connaissance ; compagnon de référence avec synthèse citée | Pas encore de route de chat HTTP en streaming. Le SSE du transport MCP n'est pas un flux de tokens du chat. La validation des citations ne prouve pas la vérité de chaque phrase générée. |
| Piloter et naviguer dans six vues | Brief propriétaire, concepts/relations, conversations archivables, propositions, signaux personnels, corpus/imports, journal | Le brief est un instantané à la demande, pas une synthèse quotidienne programmée. Pas de moteur de mémoire court/long terme distinct. |
| Valider et publier | Diff/preuves, rejet, report, demande de modification, réouverture, approbation et publication séparées | Pas de tâche de publication asynchrone ni de barre de progression métier ; le reçu confirme la transaction. |
| Corriger un concept ou une relation | Proposition typée de remplacement de concept avec ses relations et preuves, revue puis publication | Pas de PATCH direct sur une relation canonique. Préparer la nouvelle représentation complète à partir du concept relu. |
| Boucler sur les retours | Signal explicite/observé/inféré, signalement personnel, prise en charge, résolution, classement sans suite et historique | Pas de file de feedback partagée entre tous les membres. La décision de signalement est dans son historique personnel ; elle n'est pas une publication au journal canonique. Lien correction→signalement à expliciter, sans prétendre qu'il est automatisé. |
| Alimenter le corpus | Collections, lots texte, dépôt JSON base64, analyse bornée, états/erreurs, reprises, création de sources et propositions | L'import réussi ne crée pas automatiquement une proposition ou une publication. Pas d'OCR général ni de garantie de fidélité complète du PDF. |
| Tracer et administrer | Rôles par domaine, lecteurs par source, événements de membership, revue et journal immuables | Pas d'annuaire global, invitations, synchronisation de groupes ni d'IdP fourni par Cortex Fusion. |

## Objets et mots à employer

| Objet | Sens fonctionnel |
|---|---|
| Tenant | Frontière d'isolation de l'organisation. Le transport fournit son UUID. |
| Domaine | Périmètre de connaissance et d'appartenance à l'intérieur du tenant. |
| Collection | Ensemble privé utilisé pour organiser des sources et imports. |
| Source | Texte original immuable, provenance, empreinte et lecteurs ; pas encore une connaissance approuvée. |
| Proposition | Changement candidat avec preuves exactes, version de base, digest et historique de revue. |
| Concept / relation | Connaissance publiée ; les relations sont portées par les concepts. |
| Commit / version | Historique accepté et position publiée. Une approbation peut précéder la visibilité dans les réponses. |
| Conversation | Historique personnel dans un domaine, renommable et archivable. |
| Épisode | Une question, son résultat de recherche, ses preuves et la version servie. |
| Réponse de compagnon | Formulation finale effectivement livrée, séparée de l'extrait brut ; citations vérifiées, sémantique non certifiée. |
| Signal | Retour immuable dont l'origine est explicite, observée ou inférée. |
| Signalement | Problème personnel à suivre ; sa fermeture ne modifie pas la connaissance. |
| Tentative IA | Réservation et résultat durable d'un appel d'extraction ; pas une facture globale. |

Éviter « ajouté au cerveau » après un upload : dire « fichier reçu », « source enregistrée », « proposition créée », « accepté » ou « publié », selon le reçu exact.

## Identité, rôles et confirmations

L'authentification est fournie par un IdP externe. Cortex vérifie les JWT RS256 avec émetteur, audience et clé/JWKS configurés ; il ne fournit pas de formulaire de connexion ni de route de création de session utilisateur. Le rôle applicatif provient de l'appartenance stockée côté serveur ; un champ role dans le JWT ne l'impose pas.

| Rôle technique | Responsabilité |
|---|---|
| viewer | Consulte la connaissance accessible, interroge, gère ses conversations et retours personnels. |
| contributor | Prépare des propositions dans son périmètre, en plus des lectures personnelles. |
| agent | Identité d'agent autorisée à préparer des changements, jamais à s'auto-approuver. |
| corpus_manager | Organise et importe le corpus accessible, prépare des propositions. N'approuve pas la connaissance. |
| owner | Revoit, accepte, publie et administre le domaine dans les limites d'accès et des objets personnels. |

La matrice précise est celle de chaque endpoint, pas une hiérarchie implicite où un rôle autoriserait toutes les actions d'un autre.

Chaque appel protégé comporte `Authorization: Bearer <jeton>` et `X-Tenant-ID: <uuid>`. Le domaine est dans le chemin. Appeler `GET /v1/me` après connexion ; choisir un domaine parmi ceux retournés. Un lien partagé vers une proposition ne donne aucun accès supplémentaire.

**Contrôle des décisions sensibles :** MCP et les routes HTTP directes exigent par défaut une attestation `X-Cortex-Confirmation`, liée à la commande exacte, au sujet et au tenant, valide au maximum cinq minutes et à usage unique. Configurer `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE` et conserver `CORTEX_HTTP_CONFIRMATION_MODE=required`. Sans clé de vérification ou sans attestation, une commande sensible autorisée par le rôle reçoit 428 ; les consultations restent utilisables.

Le mode explicite `CORTEX_HTTP_CONFIRMATION_MODE=trusted_host` préserve l'ancien fonctionnement HTTP pour un serveur de confiance qui recueille lui-même la décision. Il ne convient pas à une API directement exposée aux commandes d'un modèle ou d'un navigateur privilégié. Il ne désactive jamais les confirmations MCP. Les fixtures métier et démonstrations synthétiques l'utilisent explicitement ; les tests de transport vérifient le mode strict. Le mode effectif est publié dans `x-cortex-http-confirmation-mode` de l'OpenAPI.

Le pont MCP transmet une preuve en mémoire après vérification pour éviter une seconde consommation au passage HTTP interne. Aucun en-tête de contournement n'est accepté depuis le réseau. Une confirmation utilisée reste consommée même si une précondition métier échoue ensuite : relire l'état avant une nouvelle décision, conserver la clé métier si l'intention est la même.

La clé privée de confirmation, les clés OpenRouter et les secrets d'IdP restent côté serveur. Ils ne doivent jamais être inclus dans les variables publiques de build Vite, le navigateur ou les arguments d'un modèle. L'hôte de confiance prépare la confirmation HTTP/MCP après avoir recueilli le choix sur les paramètres exacts.

### Préparer une confirmation depuis le serveur de l'interface

Pour HTTP direct, la forme signée est celle de l'outil MCP généré : `path`, corps JSON `body` si présent et en-têtes métier `header` si déclarés. Ne pas inclure les jetons de transport ni ajouter les valeurs par défaut absentes du corps envoyé. Les paramètres non déclarés sont refusés en mode strict.

Exemple de commande de publication :

```json
{
  "action": "domain.publish",
  "arguments": {"path": {"domain": "UUID_DU_DOMAINE"}}
}
```

L'hôte recueille la décision sur cette commande, puis utilise le helper serveur `sign_confirmed_action` de `cortex_core.confirmations` ou reproduit le contrat documenté dans [les confirmations MCP](mcp-exhaustive.md). Le hash utilise SHA-256 du JSON UTF-8, clés triées récursivement, séparateurs sans espaces et Unicode non échappé. La première réponse 428 fournit aussi `confirmation_request.command_hash`, sans le texte privé de la commande. Un champ `confirmed: true` n'est jamais une autorisation suffisante.

La réponse de préparation ne signe rien. Le navigateur ne doit pas posséder la clé privée. Une intégration JavaScript côté serveur doit vérifier sa sérialisation contre le helper et éviter de changer les nombres ou les champs après la décision.

## Intégration React, TanStack Query et navigation

Les UUID techniques sont les identifiants des routes API. Une route frontend telle que `/validate/PR-3082` nécessite une correspondance explicite avec un UUID réel ; le backend ne résout pas actuellement cet alias humain. Inclure le domaine dans le contexte de navigation.

Clé de cache indicative : `[tenantId, subject, domainId, resource, filters]`. Ajouter l'ID d'objet et la version/révision lorsqu'ils caractérisent la lecture. Ne jamais mettre le jeton lui-même dans les clés ou les logs. Vider les données privées lors d'une déconnexion ou d'un changement de tenant/identité. Une révocation peut rendre un objet historique inaccessible : ne pas réafficher alors une ancienne copie.

Zustand peut conserver le brouillon de question, les panneaux ouverts et l'intention en cours. Les rôles, versions publiées et reçus serveur restent des données serveur. Une mutation réussie est confirmée par son reçu, pas seulement par la fermeture d'un panneau.

| Mutation réussie | Lectures à actualiser dans le même contexte |
|---|---|
| Créer/mettre à jour une conversation | Liste et détail de conversation |
| Poser une question | Messages, épisodes, signalements et brief personnel si manque de connaissance |
| Enregistrer une réponse | Réponses de compagnon de l'épisode/conversation |
| Enregistrer un signal | Signaux, résumé personnel, signalements en cas de retour négatif |
| Modifier le consentement | Préférences ; arrêter les collecteurs devenus interdits |
| Importer/traiter un fichier ou lot | Reçu, liste des imports/fichiers, sources accessibles |
| Créer/réviser une proposition | Proposition, liste, diff et revues selon le cas |
| Revoir/accepter | Proposition, revues, liste, brief ; version acceptée après acceptation |
| Publier/compenser après publication | Version, concepts, résultats de recherche futurs, journal, brief |
| Modifier les lecteurs/membres | Identité/capacités, listes et détails affectés ; purge des données désormais interdites |

Ne pas activer de retry automatique pour toute mutation. Conserver une clé par intention logique et reprendre selon le contrat. Une nouvelle clé signifie une nouvelle commande, parfois un nouvel appel facturé. Pour les lectures, temporiser les retries et arrêter sur 401/403/404 selon le contexte.

La configuration CORS n'est pas encore livrée à cet état. Un frontend servi sur une autre origine ne doit pas supposer que le navigateur accepte les prévols ; utiliser un serveur d'interface ou un proxy de développement de même origine en attendant le lot d'intégration. Le déploiement devra déclarer explicitement les origines autorisées.

## Parcours 1 — question, citations, historique et voix

1. Lire l'identité et choisir le domaine.
2. Créer une conversation avec `conversations.create`, ou relire une conversation existante.
3. Envoyer `conversations.query` avec une question, une clé stable et éventuellement les bornes de restitution.
4. Conserver `episode_id`, `served_version`, `status`, la réponse et les citations. `evidence_found` indique des preuves ; `knowledge_gap` appelle un message de manque de connaissance, pas une invention.
5. Si un compagnon génère une reformulation, lui fournir uniquement les preuves autorisées et conserver sa réponse via `responses.create`. Ce parcours n'est pas un appel implicite de la route query.
6. Associer les actions « pouce bas », commentaire et résolution à la réponse exacte lorsque son reçu existe.

Exemple de corps pour `POST /v1/domains/{domain}/conversations/{ident}/query` :

```json
{
  "question": "Quelle est la procédure d'escalade d'un incident ?",
  "limit": 5,
  "max_chars": 8000,
  "idempotency_key": "question-logique-000001"
}
```

L'ID d'épisode et les références viennent du serveur. Chaque citation porte source, début et fin ; montrer l'extrait exact et l'accès à sa provenance. Pour découper en JavaScript à partir d'offsets Unicode, `Array.from(text).slice(start, end).join("")` correspond aux points de code ; utiliser de préférence les extraits renvoyés pour éviter un décalage.

Le rendu Markdown traite la réponse comme non fiable : ne pas exécuter de HTML ou d'instructions intégrées au corpus. Les citations doivent être reliées aux références du reçu, pas à des URLs inventées par le modèle.

**Streaming :** aucune route HTTP de tokens de réponse n'est exposée à cet état. Le transport MCP Streamable HTTP peut utiliser SSE pour ses messages de protocole ; cela ne fournit pas un abonnement métier à une conversation. Ne pas créer dans le frontend un contrat `/stream` supposé. Le lot backend suivant doit documenter ses événements et sa reprise avant intégration.

**Voix :** le backend actuel reçoit du texte, pas de l'audio. Le frontend peut préparer une transcription éditable, puis envoyer la même commande query. Il faut documenter la destination réelle du traitement vocal choisi ; l'usage de Web Speech API ne doit pas être présenté comme une garantie de traitement local. Aucun endpoint STT ni reçu vocal n'est encore fourni.

## Parcours 2 — brief et mémoire

Le brief propriétaire est obtenu à la demande par `domain.brief`. Les concepts/relations viennent de `concepts.list/read`, la connaissance servie de `domain.version`, les propositions de `proposals.list`, les sources/imports de leurs listes et le journal de `commits.list`.

Les conversations archivées sont un état de classement de l'historique personnel. La maturité d'un concept (`emerging`, `observed`, `established`, `reference`) est distincte de cet archivage. Aucune API ne déplace aujourd'hui des souvenirs entre trois stockages « court / long / archive ». Si ces labels sont utilisés dans le frontend, leur correspondance fonctionnelle doit être explicite.

## Parcours 3 — revoir, différer, approuver et publier

Lire la proposition et `proposals.diff`, puis les revues. Une décision de revue utilise `reject`, `defer`, `request_changes` ou `reopen`, avec raison, digest, révision attendue et clé. Ces valeurs techniques doivent être traduites en libellés français dans react-intl.

Une approbation utilise le digest et les versions attendues réellement relus. Après approbation, annoncer « accepté ». Appeler ensuite la publication distincte ; après succès, annoncer la version publiée retournée. La publication est transactionnelle : pas de pseudo-progression de 0 à 100 % calculée côté UI.

Après un timeout d'approbation, relire la proposition et réutiliser sa clé lorsque le contrat le permet. Après un timeout de publication, lire la version et le journal avant une nouvelle décision. Après conflit de révision, présenter à nouveau les changements actualisés ; ne pas approuver automatiquement un contenu différent.

## Parcours 4 — corriger un concept et ses relations

Lire le concept, ses preuves et la version actuelle. Construire une proposition contenant `changes` de type `put_concept` avec la représentation complète du concept modifié ; une relation contient `target_id`, `kind`, `primary` et `weight`. Un parent principal doit être structurel ; le serveur vérifie les contraintes du graphe et des preuves.

Conserver les liens et preuves non modifiés. Ne pas envoyer une représentation partielle en supposant une fusion automatique. La raison explique la correction. La proposition suit ensuite revue, approbation et publication ; le concept publié reste inchangé avant cette dernière étape.

## Parcours 5 — feedback, signalement et correction

| Origine | Types autorisés | Interprétation |
|---|---|---|
| explicit | thumbs_up, thumbs_down, comment, resolved | Déclaration réelle de l'utilisateur |
| observed | reformulation, correction, abandon, resolved | Événement effectivement observé par l'hôte, avec consentement |
| inferred | satisfaction | Estimation, avec consentement, sentiment, confiance et explication |

Un `iteration_index` n'appartient qu'aux événements observés. La confiance et le sentiment n'appartiennent qu'aux inférences. Le silence ne produit pas de vote positif ; fermer un onglet n'est pas automatiquement une insatisfaction.

Lire les préférences avant collecte. En cas de refus concurrent `COLLECTION_DISABLED`, interrompre la remontée. Une analyse de commentaire par modèle reste une inférence non calibrée et ne doit jamais être convertie en pouce explicite.

Le signalement personnel peut recevoir `start`, `resolve`, `dismiss` ou `reopen`, avec sa révision, sa raison et sa clé. Afficher « pris en charge », « résolu », « classé sans suite » et « rouvert ». Les décisions figurent dans `issues.history`. Pour corriger une connaissance, créer une proposition séparée ; ne pas annoncer que résoudre le signalement a publié une correction.

## Parcours 6 — importer, traiter et proposer

Le dépôt binaire utilise JSON/base64 et accepte au plus 500 000 octets décodés ; le schéma limite la chaîne encodée à 666 668 caractères. Le nom de fichier n'est pas un chemin. Les analyses restent bornées à 30 000 caractères extraits dans cette version. Ne pas promettre la prise en charge de tous les PDF scannés.

Pour plusieurs textes, créer un lot d'import et traiter ses éléments par fenêtres. Pour plusieurs fichiers binaires, suivre chaque reçu de fichier ; ne pas supposer l'existence d'un endpoint multipart de lot binaire. Les états et erreurs doivent être montrés par élément.

Lire le reçu jusqu'à l'état pertinent, avec temporisation et arrêt du polling lorsqu'il n'y a plus de travail en cours. L'annulation ou la reprise doit être confirmée par le reçu. Une erreur de format nécessite une source corrigée, pas des retries illimités.

Après extraction réussie, utiliser la source créée pour proposer un passage exact. Le propriétaire garde la revue et la publication. Les fichiers ne deviennent pas automatiquement une connaissance servie.

## Parcours 7 — droits et audit

L'administration porte sur un domaine. Une modification de membre renseigne sujet, rôle (ou null pour retrait selon le contrat), révision attendue, raison et clé. Les lecteurs d'une source sont un autre contrôle ; appartenir au domaine ne rend pas toute source lisible.

L'historique de membership, les revues, le journal canonique et les événements personnels de signalement sont des historiques distincts. Le frontend peut proposer une navigation entre eux, mais ne doit pas les présenter comme un journal universel auquel le propriétaire aurait accès.

## Erreurs et états transitoires

| HTTP / situation | Fonction attendue du frontend |
|---|---|
| 401 | Rétablir la session externe ; garder le brouillon local si approprié, sans exposer les jetons |
| 403 | Afficher le refus de capacité/collecte/confirmation ; actualiser les droits si nécessaire |
| 404 | Objet absent ou inaccessible ; ne pas révéler son existence via un cache d'une autre identité |
| 409 | Relire l'objet ; distinguer révision périmée, clé réutilisée avec autre contenu, état incompatible ou tentative IA déjà réservée |
| 413 | Réduire la taille ; vérifier octets et taille base64 avant nouvel envoi |
| 422 | Corriger les paramètres ou traiter une preuve/sortie invalide ; conserver les codes pour diagnostic |
| 428 | Préparer la confirmation exacte côté hôte, puis recueillir la décision |
| 429 | Attendre la remise à disposition du quota ; ne pas contourner avec de nouvelles clés |
| 503 / réseau interrompu | État incertain ; relire le reçu/version, ne pas afficher réussite ou relancer une génération aveuglément |

Les codes sont plus stables que les messages. Les traductions react-intl doivent prévoir un message générique pour un code inconnu, avec identifiant d'opération et possibilité de reprise appropriée. Ne pas afficher les exceptions brutes, jetons ou textes confidentiels dans la console.

## Trois scénarios d'acceptation pour le frontend

1. **Question sourcée puis manque de preuve** : utilisateur autorisé, conversation, question, citations/version affichées, reprise même clé sans doublon, seconde question sans preuve qui affiche le manque. Vérifier l'absence de contenu d'une source révoquée.
2. **Import → revue → publication** : corpus manager dépose un fichier, traite, crée une proposition ; sa tentative d'approbation est refusée. Le propriétaire lit le diff, diffère puis rouvre/accepte, publie et constate la nouvelle version.
3. **Pouce bas → traitement personnel → correction** : cibler le reçu de réponse, envoyer un vote explicite, lire le signalement, prendre en charge, créer une proposition séparée, puis résoudre ou classer avec raison. Vérifier qu'aucune inférence ne gonfle le nombre de votes.

Ces scénarios peuvent guider Playwright côté frontend ; le backend maintient les tests HTTP/MCP et PostgreSQL correspondants avec données synthétiques. Les demandes de streaming, CORS et vues agrégées doivent être rattachées à des contrats livrés, sans endpoints imaginaires.
