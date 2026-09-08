# Tailles, pagination et erreurs HTTP/MCP du runtime Rust

L’exposition de chaque opération en MCP conserve ses droits et sa logique métier. Les enveloppes de transport ajoutent toutefois leurs propres limites. Une taille maximale de champ en caractères ne garantit pas que toutes les combinaisons de champs tiennent dans un seul appel.

## Ce qui est effectivement borné

| Élément | Borne et unité | Conséquence pour le client |
|---|---|---|
| Requête MCP | 1000000 octets de corps HTTP | Compter le JSON-RPC complet et son échappement. Un dépassement produit un refus HTTP 413 du transport. |
| Corps JSON d’une route HTTP native | 2097152 octets par défaut de l’extracteur Axum | Les routes peuvent traduire son refus en erreur de validation. La création de source retourne 422 au-delà ; ne pas attendre systématiquement 413. |
| Réponse HTTP interne lue par le pont MCP | 4000000 octets avant conversion | Au-delà, erreur JSON-RPC interne sans résultat métier. Réduire une page de lecture quand le contrat le permet. |
| Réponse JSON-RPC transmise | Pas de borne globale de 4000000 octets | Le résultat structuré et sa représentation texte coexistent ; échappement et base64 augmentent la taille. Configurer le client et le proxy en conséquence. |
| Requête ou réponse TerminusDB | 4000000 octets de JSON encodé | La limite porte sur les documents typés moteur et ne fixe pas un nombre universel de concepts. |
| Fichier source | 500000 octets décodés | Le champ base64 peut atteindre 666668 caractères avant son enveloppe JSON. Le téléchargement MCP réencode les octets en base64. |
| Texte d’une source | 200000 points de code Unicode | Les octets UTF-8 et l’échappement JSON peuvent coûter davantage. Les passages utilisent aussi des offsets en points de code. |
| Timeline de conversation | 500000 octets de JSON applicatif | Réduire les limites enfants ou lire leurs pages séparément si le premier tour ne tient pas. |

La borne du pont ne limite pas globalement les réponses HTTP directes. Par exemple, 100 reçus personnels contenant chacun une clarification de 12000 points de code peuvent produire une page HTTP de plus de 4 Mo. Le pont refuse cette page, tandis que deux pages de 50 reçus sont lisibles en MCP. Chacune de ces enveloppes MCP peut elle-même dépasser 4 Mo transmis tout en respectant la borne interne. Les limites maximales de paramètres sont des plafonds, pas toujours la taille de page conseillée.

## Distinguer les quatre niveaux de résultat

1. **Transport HTTP** : 401, 403, 413, interruption réseau ou corps non interprétable. Il peut n’y avoir aucun JSON-RPC à décoder. HTTP 200 seul ne prouve pas une réussite métier.
2. **Erreur JSON-RPC** : objet `error` à la racine, sans `result`. Par exemple, `-32603` avec `Native response exceeded bound` lorsque le corps natif est trop gros. Ce n’est pas un résultat `isError` avec `http_status`.
3. **Résultat d’outil** : lire `result.isError`, puis `result.structuredContent.http_status` et le code métier éventuel dans `data.error`. Les erreurs de validation, droits ou confirmation restent distinctes des erreurs du protocole.
4. **Reçu fonctionnel** : même après un résultat d’outil réussi, inspecter les champs métier. Un import peut rester `unresolved`, un traitement être `failed`, ou une réponse indiquer `knowledge_gap`. Les schémas décrivent ces états pour chaque opération.

Le pont lit la réponse après l’exécution de la route HTTP. Une erreur protocolaire de réponse ne prouve donc pas l’absence d’écriture. Pour une mutation, relire le reçu et appliquer la règle d’idempotence propre à l’action ; ne pas inventer une nouvelle clé pour contourner l’erreur. Une confirmation consommée reste consommée. Pour une lecture paginée, réduire `limit` et conserver le curseur de la dernière page effectivement reçue. Aucun changement de droits ni accès SQL/moteur direct n’est nécessaire.

## Portée de la qualification

Les tests Rust `tests/engine_bounds.rs` mesurent la limite moteur exacte et son dépassement d’un octet, pour GET/POST, corps à longueur connue et transfert chunked. Une requête trop grosse et un snapshot dépassant la borne sont refusés avant tout appel moteur. Une réponse POST trop grosse reste incertaine : le moteur peut avoir écrit avant de répondre ; une réponse GET trop grosse est une erreur de taille.

Le scénario `scripts/verify_rust_transport_bounds.py` utilise le vrai runtime et PostgreSQL synthétique : reçus privés, page HTTP volumineuse, refus protocolaire MCP, reconstruction exacte par pagination, accès personnel et bornes des requêtes. Aucun modèle n’est appelé. Cette qualification ne mesure ni pic mémoire, ni résistance sous charge prolongée, ni réglages d’un proxy de production.

Dans le rapport global `verify_rust_http`, `http_inventory_operations=86` décrit l’inventaire livré. Le compteur historique `native_http_operations` vaut 82 dans le scénario sans TerminusDB réel et 86 avec l’intégration moteur ; il ne mesure pas une couverture exhaustive des branches. `native_mcp_operations=102` dénombre les outils annoncés, et non toutes les variantes d’exécution de chaque outil.
