# Branchement progressif du frontend — français

## État livré

Le mode par défaut reste `mock`. Il conserve tous les parcours de démonstration et leur stockage local. Le mode `api` ouvre un écran distinct de connexion : identité, domaines accessibles, rôle effectif, version acceptée et version publiée. Une erreur de connexion ne déclenche jamais un retour automatique vers des données synthétiques.

Le transport typé couvre huit opérations. L’interface appelle identité, versions, liste/création de conversations, historique paginé, requête extractive JSON et feedback. La lecture des concepts reste préparée dans le transport. Les propositions et publications ne sont pas encore raccordées à cette interface.

## Démarrage

Depuis la racine du dépôt :

```sh
# Démonstration existante
pnpm console:dev

# Connexion au backend, sur un autre port pour garder la démo ouverte
VITE_DATA_MODE=api CORTEX_API_TARGET=http://127.0.0.1:8010 pnpm --filter @cortexfusion/console dev --port 5174
```

L’API Rust doit être démarrée séparément. Ajuster `CORTEX_API_TARGET` à son adresse réelle. Cette variable configure le proxy Vite côté serveur ; elle ne contient aucun secret. Redémarrer Vite après modification. Le backend doit autoriser l’origine exacte du navigateur avec `CORTEX_CORS_ORIGINS='["http://127.0.0.1:5174"]'`, y compris derrière le proxy : celui-ci conserve le header Origin. Le navigateur appelle uniquement `/api/v1/...` sur sa propre origine ; le proxy retire `/api`.

En production, `VITE_DATA_MODE=api` doit être défini au build et un reverse proxy doit fournir le même routage `/api` vers Rust. Le proxy de développement Vite n’est pas inclus dans les fichiers statiques produits. Utiliser HTTPS et le fournisseur d’identité prévu pour le déploiement.

## Session et droits

L’écran demande un UUID de tenant et un **jeton utilisateur Cortex** déjà émis par le système d’identité. Ce n’est ni une clé OpenRouter, ni une clé de signature serveur. Aucun jeton n’est embarqué dans le bundle ou enregistré dans localStorage/sessionStorage. Le jeton est effacé du champ à la connexion, reste en mémoire et disparaît au rechargement ou à la déconnexion.

Le transport envoie `Authorization: Bearer …` et `x-tenant-id`. La déconnexion annule les lectures en cours et retire les données API du cache. Les redirections sont refusées et les cookies ne sont pas envoyés. Les rôles et capacités proviennent de `/v1/me` ; le sélecteur de rôle de démonstration n’existe pas en mode API. L’authentification SSO et le renouvellement automatique du jeton ne sont pas encore intégrés.

## Contrats disponibles

| Intention | Opération | Endpoint | État UI |
| --- | --- | --- | --- |
| Identifier l’utilisateur et ses domaines | `identity.read` | `GET /v1/me` | Branché |
| Distinguer savoir accepté et publié | `domain.version` | `GET /v1/domains/{domain}/version` | Branché |
| Lire les concepts | `concepts.list` | `GET /v1/domains/{domain}/concepts` | Transport préparé |
| Retrouver les conversations personnelles | `conversations.list` | `GET /v1/domains/{domain}/conversations` | Branché, pagination |
| Créer une conversation | `conversations.create` | `POST /v1/domains/{domain}/conversations` | Branché |
| Lire ses messages | `conversations.messages` | `GET /v1/domains/{domain}/conversations/{ident}/messages` | Branché |
| Interroger le domaine | `conversations.query` | `POST /v1/domains/{domain}/conversations/{ident}/query` | Branché, réponse JSON |
| Donner un retour personnel | `episodes.feedback` | `POST /v1/domains/{domain}/episodes/{episode_id}/feedback` | Branché |

Les types d’entrée et de sortie sont importés des contrats générés du dépôt. Les chemins et méthodes sont vérifiés contre OpenAPI. Le typage TypeScript ne remplace pas la validation à l’exécution : les champs utilisés par l’écran identité/versions sont vérifiés ; les futurs consommateurs devront aussi valider leurs réponses avant de les afficher. Le client ne transforme pas encore ces DTO en objets du mock.

## Erreurs et actions

- 401 : reconnexion nécessaire ; 403 : action interdite ; 404 : absent ou inaccessible.
- 409 : actualiser avant de reprendre une décision ; 422 : données invalides ; 429 : limite atteinte.
- Indisponibilité, timeout ou réponse non JSON : erreur explicite, jamais de faux succès. Le détail brut du serveur n’est pas affiché.
- Chaque appel accepte une annulation et un délai maximal, 30 secondes par défaut.
- Aucun POST n’est relancé automatiquement. Le parcours appelant doit conserver la même clé d’idempotence pour reprendre la même intention après un résultat incertain.
- Les confirmations signées restent à raccorder via un service autorisé ; aucune clé privée ne doit être placée dans le navigateur.

## Prochaine tranche

Raccorder les propositions et la publication après la conversation et le feedback maintenant disponibles. Préserver la version servie, l’identifiant de l’épisode, les preuves et les reçus réels. Les citations portent des offsets Unicode, pas des indices UTF-16 JavaScript. Les sources doivent être relues avec contrôle d’accès.

La validation actuelle couvre le transport et les composants avec réponses HTTP simulées, les contrats et les sept parcours de démonstration. Une vérification locale réelle du proxy vers Rust/PostgreSQL a aussi confirmé identité, historique, idempotence et abstention avant publication. Elle ne constitue pas une recette de bout en bout contre Rust/TerminusDB. La validation de réponses sur un graphe publié exige encore TerminusDB et la publication des propositions relues.

## Conversation, citations et reprise

La question crée une conversation si nécessaire puis appelle le moteur extractif, sans synthèse externe. L’interface affiche la version servie, les lacunes et les extraits de citation dépliables avec leur source et localisation. Les images Markdown distantes ne sont pas chargées automatiquement. Les listes et échanges disposent d’une pagination.

La création, la question et le feedback disposent chacun d’une clé d’idempotence. En cas de résultat incertain, « Réessayer la même demande » ou « Réessayer le même retour » réemploie le payload initial et sa clé ; aucun nouveau POST n’est lancé automatiquement. La question reste en mémoire mais un rechargement, un changement de domaine ou une déconnexion perd la reprise locale. L’historique confirmé reste côté serveur. Un refus de lecture masque les données précédemment affichées.

Les retours sont rattachés à l’épisode réel et leur réception est confirmée par le serveur. Ils ne modifient pas le savoir publié. Le choix de modèle, SSE et la génération de corrections restent à raccorder.
