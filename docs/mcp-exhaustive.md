# Exposition MCP exhaustive

Le serveur Streamable HTTP est monté sur `/mcp/`. Il expose **un outil `api_*` pour chaque opération HTTP documentée et 16 outils historiques compatibles**. Les entrées de `tools/list` portent des schémas JSON d'entrée et, pour chaque outil généré, un schéma de résultat. `packages/contracts/mcp-tools.json` est l'export vérifié par CI.

La couverture exhaustive désigne les opérations applicatives du contrat OpenAPI, y compris la santé, la découverte, les collections, sources, fichiers, extractions, propositions, conversations, signalements, membres et publication. Les routes techniques de documentation `/docs`, `/redoc`, `/openapi.json` et le transport MCP lui-même ne sont pas des actions métier récursivement exposées. La spécification et le catalogue sont distribués comme artefacts et via la découverte d'actions.

## Convention des appels

L'action HTTP `sources.chunks` devient `api_sources_chunks`. Les arguments sont regroupés par emplacement : `path`, `query`, `header` (uniquement les en-têtes métier décrits, par exemple `idempotency-key`) et `body`. Les groupes optionnels peuvent être omis. Les schémas refusent les champs supplémentaires et les identifiants mal formés.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "api_sources_chunks",
    "arguments": {
      "path": {"domain": "00000000-0000-4000-8000-000000000001", "source_id": "00000000-0000-4000-8000-000000000002"},
      "query": {"offset": 0, "limit": 3}
    }
  }
}
```

L'hôte fournit `Authorization: Bearer …`, `X-Tenant-ID` et l'en-tête Accept MCP dans le transport HTTP. Les identités et confirmations ne sont jamais des arguments d'outil. Les UUID d'exemple doivent être remplacés par ceux de la découverte réelle. Même l'outil de santé exige une session MCP authentifiée, bien que `/health` soit public en HTTP.

Les outils exécutent la route ASGI exacte à l'intérieur du même processus ; aucun client HTTP arbitraire ni nouvelle connexion réseau n'est utilisé pour joindre le backend. Les dépendances d'authentification, middleware, validations, statuts et services HTTP restent actifs. Les appels à un fournisseur IA depuis la route d'extraction restent naturellement des appels externes soumis à sa configuration.

Le résultat MCP contient `structuredContent: {http_status, data}` et sa représentation JSON dans le contenu texte. Les erreurs ont `isError: true` et le code métier dans `data.error`. Les fichiers binaires sont rendus sous `{media_type, base64}`. Les clients historiques gardent leurs résultats historiques ; les nouveaux outils utilisent cette enveloppe uniforme.

## Confirmation des opérations sensibles

Appliquer la migration `0009` et configurer `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE` avec la clé publique RS256 de l'hôte de confiance. La clé privée doit rester dans le service de décision de cet hôte, hors du modèle et hors des outils d'exécution accessibles à l'agent. Utiliser une paire distincte des clés d'authentification utilisateur. Le serveur Cortex ne crée ni ne conserve la clé privée de signature.

Les changements d'accès/membres, revues, approbations, publications, reconstructions, propositions de compensation et extractions IA exigent une confirmation. Ils restent listés et typés lorsque la confirmation n'est pas configurée, mais leur exécution échoue avec `CONFIRMATION_REQUIRED` (428). Les autres commandes conservent les exigences de rôle et d'intention utilisateur existantes.

1. L'hôte prépare une commande exacte et affiche son action, ses cibles, ses effets et tous ses paramètres. Pour l'IA, afficher aussi la destination et le passage transmis.
2. L'hôte recueille la décision explicite de l'utilisateur. Il signe ensuite une attestation liée au sujet authentifié, au tenant, à l'identifiant d'action et à l'empreinte canonique de l'ensemble des arguments. Les clés, révisions et digests ne doivent plus être modifiés après cette confirmation.
3. Le jeton, valable au plus cinq minutes, est injecté dans `X-Cortex-Confirmation` pour cet appel précis. Il n'entre pas dans le prompt ni dans les arguments.
4. Le backend vérifie le rôle propriétaire, la signature, l'audience, l'émetteur, l'expiration et toutes les liaisons. Il consomme son identifiant unique dans PostgreSQL avant d'invoquer la route métier, laquelle recontrôle les droits et les préconditions.

Un premier appel sans attestation renvoie une demande contenant l'action, son empreinte et le nom de l'en-tête attendu. Il ne délivre pas de jeton de confirmation. Les erreurs `CONFIRMATION_INVALID` (403) et `CONFIRMATION_USED` (409) distinguent les attestations invalides et déjà consommées.

Le helper serveur de l'hôte `sign_confirmed_action(private_key, subject, tenant, action, arguments, ttl=120)` dans `cortex_core.confirmations` implémente la signature. Il **ne recueille pas** la décision humaine : cette responsabilité incombe à l'hôte. Le backend vérifie une attestation de cet hôte, pas la présence physique d'un humain. Un hôte qui signe automatiquement tous les appels supprimerait cette séparation.

L'empreinte est SHA-256 du JSON canonique `{"action": action, "arguments": arguments}` produit par `cortex_core.service.encoded`. Les claims sont `iss=cortex-trusted-host`, `aud=cortex-mcp-confirmation`, `sub`, `tenant`, `action`, `command_hash`, `jti` UUID, `iat` et `exp`. Une intégration dans un autre langage doit reproduire exactement cette sérialisation ou utiliser le helper. Un simple booléen `confirmed=true` fourni par le modèle est refusé.

## Reprise et limites

La consommation de confirmation est atomique et immuable, séparée de l'opération métier : une erreur métier, une interruption ou un timeout après consommation ne libère pas le jeton. Inspecter d'abord l'état et obtenir une nouvelle confirmation si nécessaire, en conservant la même clé d'idempotence métier lorsque c'est la même opération. Cette règle privilégie l'absence de réexécution d'une autorisation ; elle ne promet pas une exécution exactement une fois de bout en bout.

La confirmation lie les arguments exacts, y compris les préconditions de version/révision présentes dans le contrat. Elle n'ajoute pas une révision aux opérations HTTP qui n'en possèdent pas. L'hôte doit présenter ces limites ; le backend reste l'autorité sur les droits actuels.

Les clients MCP qui ne peuvent pas injecter un en-tête de confirmation par appel peuvent utiliser les opérations ordinaires mais doivent être adaptés pour les opérations sensibles. Aucun contournement ni mode automatique non confirmé n'est fourni. Les routes HTTP directes conservent leur politique existante ; un hôte doit également éviter de donner au modèle un accès HTTP arbitraire avec les identifiants d'un propriétaire.

La couverture des opérations est exhaustive ; la boucle de compréhension, planification et dialogue autonome du produit reste un chantier distinct. Aucun appel OpenRouter réel ni frontend n'a été ajouté dans cette étape.

Les ressources, prompts et métadonnées OAuth configurables sont décrits dans [le guide de connexion](mcp-onboarding.md). Le changement des préférences personnelles de feedback est aussi une décision confirmée ; il est accessible au membre concerné sans rôle propriétaire.
