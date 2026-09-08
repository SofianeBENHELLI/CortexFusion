# Identité Rust : source JWKS fixe et rotation des clés

Le runtime accepte les jetons d’un fournisseur d’identité externe. L’opérateur configure **une seule source** : `CORTEX_JWT_PUBLIC_KEY_FILE` pour une clé RSA PEM chargée au démarrage, ou `CORTEX_JWKS_URL` pour un jeu de clés publiques rafraîchi en arrière-plan. Les deux configurations simultanées, ou leur absence, empêchent le démarrage. Les confirmations des décisions sensibles utilisent toujours leur clé PEM distincte ; cette rotation ne change pas le protocole de confirmation.

## Configuration opérateur

| Paramètre | Fonction et limite |
|---|---|
| `CORTEX_JWKS_URL` | URL fixe HTTPS ; HTTP accepté seulement sur loopback. Sans identifiant, mot de passe, query ou fragment. |
| `CORTEX_JWKS_REFRESH_SECONDS` | Attente entre deux rafraîchissements, de 1 à 300 secondes ; 30 par défaut. |
| `CORTEX_JWKS_MAX_AGE_SECONDS` | Âge maximal depuis le dernier chargement réussi, jusqu’à 3600 secondes et au moins égal à l’intervalle ; 300 par défaut. |
| `CORTEX_JWT_ISSUER` | Émetteur `iss` exact attendu. |
| `CORTEX_JWT_AUDIENCE` | Audience exacte attendue ; doit correspondre à l’URL de ressource lorsque la découverte MCP publique est activée. |

Les paramètres de rafraîchissement sont refusés en mode PEM pour éviter une configuration trompeuse. Le fichier PEM ne tourne pas à chaud. Le serveur ne charge pas automatiquement `.env`. Un premier chargement JWKS invalide ou indisponible empêche l’annonce du serveur HTTP. Le démarrage avec un jeu valide mais vide est possible ; aucune identité ne peut alors être authentifiée.

La requête JWKS a une limite de connexion de 3 secondes, de traitement total de 5 secondes et de réponse de 64 Kio, y compris en transfert chunked. Les proxys ambiants et les redirections HTTP sont désactivés. Le cache ignore les directives de durée du fournisseur : seule la politique locale ci-dessus définit sa fraîcheur. Un HTTP 304 n’est pas considéré comme un nouveau jeu valide. Le journal signale un échec de rafraîchissement sans imprimer l’URL, une clé ou un jeton.

## Politique des clés et des jetons

Seul RS256 est accepté. En mode JWKS, le header du jeton doit contenir un `kid` non vide, sans caractères de contrôle, de 200 octets maximum. Le header encodé est limité à 4096 octets et le jeton à 16 Kio. Les extensions JOSE `crit` et `b64` ne sont pas prises en charge. `jku`, `jwk` et `x5u` ne sélectionnent jamais une clé ni une destination réseau. Un `kid` inconnu donne 401 sans fetch à la demande ; il ne déclenche pas un essai de toutes les clés.

Le jeu comporte au plus 16 entrées, avec des `kid` uniques, y compris parmi les entrées non utilisées. Chaque clé de signature RSA utilisable doit fournir `n` et `e` en base64url sans padding ni zéro initial, un module impair de 2048 à 8192 bits et un exposant impair compris entre 3 et 2³²−1. Les champs de clé privée sont refusés, ainsi que les champs `alg`, `use`, `key_ops`, `n` et `e` présents avec la valeur `null`. `alg`, lorsqu’il est présent, doit être `RS256` ; `use` doit être `sig` et `key_ops` exactement `["verify"]`. Les autres types/algorithmes/usages sont ignorés, jamais utilisés pour une signature. Une clé RSA sélectionnable malformée invalide tout le document, sans remplacement partiel du cache.

L’émetteur, l’audience, le sujet et les dates restent contrôlés avec les règles historiques du service. `X-Tenant-ID` demeure obligatoire ; les appartenances et les rôles viennent de PostgreSQL. Une clé valide ne confère aucun droit de domaine. HTTP et MCP utilisent le même authentificateur.

## Rotation et révocation observée

Pour une rotation normale, publier d’abord les clés A et B, attendre que les instances aient chargé B, puis émettre les nouveaux jetons avec B. Conserver A pendant la période de validité voulue des anciens jetons ; retirer A lorsqu’ils doivent être refusés. Ce délai doit tenir compte de l’intervalle de rafraîchissement, du temps réseau et de la politique du fournisseur.

Une requête authentifiée garde une référence à la génération de sa clé. Chaque contrôle de fraîcheur métier vérifie aussi que le cache est encore valide et contient la même clé sans interruption. Un rafraîchissement identique ou l’ajout de B conserve les requêtes A. Le retrait de A, son remplacement sous le même `kid` ou son retrait suivi d’un réajout ou une période de cache expiré invalide les anciennes requêtes. Un rafraîchissement après cette expiration peut autoriser de nouvelles requêtes, mais ne réhabilite pas leurs anciens baux. Une publication bloquée pendant un appel moteur doit ainsi échouer avant son activation si sa clé a été révoquée entre-temps.

Un jeu valide `keys: []` retire toutes les clés. Un document malformé, une réponse trop grande, une redirection ou un échec réseau garde temporairement le dernier cache valide **sans renouveler son âge**. Après son expiration, les authentifications et les contrôles de requêtes en cours échouent. Une nouvelle réponse valide rétablit l’accès des clés qu’elle contient.

La révocation n’est pas instantanée au changement distant : elle devient observable après un rafraîchissement réussi, ou après expiration du cache si la source ne répond plus correctement. L’âge utilise une horloge monotone. Une révocation survenue après le dernier contrôle applicatif n’est pas atomique avec un COMMIT SQL ; il ne faut pas présenter ces deux systèmes comme une transaction commune.

## Conséquences pour le frontend et les compagnons

Aucun nouvel endpoint n’est nécessaire. Le client obtient son jeton auprès de l’IdP, l’ajoute à chaque appel et gère 401 de la même manière sur HTTP et MCP. Il peut renouveler son identité puis relire le reçu d’une commande incertaine avec sa clé d’idempotence initiale. Il ne doit pas fabriquer une nouvelle commande ou republier automatiquement après une perte d’authentification. Les données TanStack Query doivent rester isolées par sujet, tenant et domaine, puis être invalidées au changement d’identité.

`/health` et `/ready` restent des sondes de processus et de SQL. Elles ne prouvent pas qu’un cache JWKS est valide ou que l’IdP est disponible. Cette tranche ne livre ni connexion utilisateur, ni serveur OAuth, ni auto-découverte d’URL JWKS, ni rotation des clés de confirmation. Les tests utilisent exclusivement un fournisseur HTTP synthétique sur loopback ; l’intégration avec un IdP réel et le déploiement TLS restent à qualifier.

La politique s’appuie sur la [sélection explicite des algorithmes et les limites de confiance JWT](https://www.rfc-editor.org/rfc/rfc8725.html) et le [format des jeux de clés JWK](https://www.rfc-editor.org/rfc/rfc7517.html). CortexFusion applique les restrictions locales supplémentaires décrites ici.
