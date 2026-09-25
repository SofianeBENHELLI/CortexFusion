# Branchement progressif du frontend — français

## État livré

Le mode par défaut reste `mock`. Il conserve tous les parcours de démonstration et leur stockage local. Le mode `api` ouvre un écran distinct de connexion : identité, domaines accessibles, rôle effectif, version acceptée et version publiée. Une erreur de connexion ne déclenche jamais un retour automatique vers des données synthétiques.

Le transport typé couvre sept opérations préparatoires. Seules `identity.read` et `domain.version` sont actuellement appelées par l’interface en mode API. Les autres sont disponibles pour raccorder les prochains parcours ; leur présence ne signifie pas que ces parcours sont déjà intégrés.

## Démarrage

Depuis la racine du dépôt :

```sh
# Démonstration existante
pnpm console:dev

# Connexion au backend, sur un autre port pour garder la démo ouverte
VITE_DATA_MODE=api CORTEX_API_TARGET=http://127.0.0.1:8000 pnpm --filter @cortexfusion/console dev --port 5174
```

L’API Rust doit être démarrée séparément. Ajuster `CORTEX_API_TARGET` à son adresse réelle. Cette variable configure le proxy Vite côté serveur ; elle ne contient aucun secret. Redémarrer Vite après modification. Le navigateur appelle uniquement `/api/v1/...` sur sa propre origine ; le proxy retire `/api`.

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
| Créer une conversation | `conversations.create` | `POST /v1/domains/{domain}/conversations` | Transport préparé |
| Lire ses messages | `conversations.messages` | `GET /v1/domains/{domain}/conversations/{ident}/messages` | Transport préparé |
| Interroger le domaine | `conversations.query` | `POST /v1/domains/{domain}/conversations/{ident}/query` | Transport préparé, réponse JSON |
| Donner un retour personnel | `episodes.feedback` | `POST /v1/domains/{domain}/episodes/{episode_id}/feedback` | Transport préparé |

Les types d’entrée et de sortie sont importés des contrats générés du dépôt. Les chemins et méthodes sont vérifiés contre OpenAPI. Le typage TypeScript ne remplace pas la validation à l’exécution : les champs utilisés par l’écran identité/versions sont vérifiés ; les futurs consommateurs devront aussi valider leurs réponses avant de les afficher. Le client ne transforme pas encore ces DTO en objets du mock.

## Erreurs et actions

- 401 : reconnexion nécessaire ; 403 : action interdite ; 404 : absent ou inaccessible.
- 409 : actualiser avant de reprendre une décision ; 422 : données invalides ; 429 : limite atteinte.
- Indisponibilité, timeout ou réponse non JSON : erreur explicite, jamais de faux succès. Le détail brut du serveur n’est pas affiché.
- Chaque appel accepte une annulation et un délai maximal, 30 secondes par défaut.
- Aucun POST n’est relancé automatiquement. Le parcours appelant doit conserver la même clé d’idempotence pour reprendre la même intention après un résultat incertain.
- Les confirmations signées restent à raccorder via un service autorisé ; aucune clé privée ne doit être placée dans le navigateur.

## Prochaine tranche

Raccorder conversation → réponse et citations réelles → retour négatif, puis les propositions et la publication. Préserver la version servie, l’identifiant de l’épisode, les preuves et les reçus réels. Les citations portent des offsets Unicode, pas des indices UTF-16 JavaScript. Les sources doivent être relues avec contrôle d’accès.

La validation actuelle couvre le transport avec réponses HTTP simulées, la connexion via tests de composants, les contrats et les sept parcours de démonstration. Elle ne constitue pas une recette de bout en bout contre Rust/TerminusDB. Cette recette viendra avec le premier parcours complet et un jeu de données synthétiques dédié.
