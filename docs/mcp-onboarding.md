# Connect a companion to Open Br**AI**n

## Extensions de travail en qualification — 16 octobre, fenêtre autonome

Le code natif ajoute `api_cases_*` : annuaire des coordinateurs, préparation/consentement d’un extrait minimal, suivi déclarant/équipe distinct, qualification, clôture sans changement et retrait. Le guide `cortex://guide` précise la séquence : aucun feedback négatif ni conversation n’est partagé automatiquement. Afficher le texte exact et les destinataires, obtenir l’accord, puis partager la charge préparée inchangée. Agent technique exclu ; viewer humain peut suivre ce parcours via MCP. Le retrait masque le contenu aux destinataires courants sans annoncer une purge physique.

Les tâches `api_tasks_*` et les lectures personnelles `api_task_notifications_*` restent séparées de la publication du savoir. Droits actuels, pagination opaque et réessais idempotents sont communs HTTP/MCP. Qualification native du lot partage :14 scénarios groupés, dont préparation/partage viewer MCP et récupération HTTP du même reçu. Cela ne qualifie pas tous les chatbots ni un fournisseur externe. **Ces extensions et migrations0027–0031 sont qualifiées sur la base synthétique ; le service privé8013 ci-dessous n’a pas été remplacé.**

Le lot avis expert ajoute `api_task_proposals_list/link` et `api_expert_reviews_list/submit` : référence explicite sans transfert de droits, avis de l’affectataire accepté sur empreinte/révision précises, refus d’auto-revue, historique marqué périmé après changement. Aucun avis n’approuve ni ne publie. **9/9 scénarios natifs groupés**, dont révocation de source et reçu identique MCP/HTTP. Les clients doivent faire confirmer le texte exact et réessayer la même charge en cas de résultat inconnu.

## État local vérifié — 16 octobre 2026

La base est déjà exposée par le backend Rust en **MCP Streamable HTTP** à
`http://127.0.0.1:8013/mcp/` lorsque le serveur privé tourne. Vérification fraîche,
sans appel modèle : `initialize`, `tools/list`, `resources/list`, `prompts/list`
réussis ; **109 outils,3 ressources statiques,3 prompts**, version de protocole
négociée `2025-03-26`. `api_domain_version` relit les versions acceptée/publiée33
du domaine privé. Un appel MCP sans identité reçoit401. Aucun appel de requête
métier, aucune publication et aucun corpus transmis à un fournisseur externe
pendant cette vérification. Ces compteurs remplacent les anciens totaux pour ce
binaire uniquement ; ce n’est pas une validation de109 outils ni de tous les clients.

| Paramètre du client | Valeur |
|---|---|
| Nom libre | Open Br**AI**n |
| Transport | Streamable HTTP |
| URL sur ce Mac | `http://127.0.0.1:8013/mcp/` |
| Header `Authorization` | `Bearer <jeton utilisateur Cortex>` fourni par l’hôte, jamais dans le prompt |
| Header `X-Tenant-ID` | UUID du tenant privé existant |
| Domaine des appels | UUID du domaine, distinct du tenant |

Les valeurs privées sont conservées dans `.runtime/brain/okf-workspace/` ; ne pas
les copier dans une configuration versionnée. Le mode frontend sans saisie
([guide](../apps/console/API-INTEGRATION.md#accès-local-direct-temporaire--16-octobre-2026))
ne désactive pas l’identité du serveur MCP. Un client local doit obtenir/renouveler
son jeton par son hôte ; le serveur ne distribue pas de jeton anonyme. Le helper
`scripts.okf_workspace session` émet une session locale de30 minutes dans un
fichier privé, sans afficher le jeton, pour une intégration de développement.

Exemple d’arguments MCP pour interroger un domaine :

```json
{
  "name": "api_knowledge_query",
  "arguments": {
    "path": { "domain": "<UUID du domaine>" },
    "body": { "question": "<question utilisateur>", "limit": 5, "max_chars": 8000 }
  }
}
```

`api_concepts_read`, `api_sources_read` et `api_graph_window` permettent de lire
les concepts, leurs preuves et le graphe ; découvrir leurs schémas via
`tools/list` avant de construire les arguments. `ask_cortex` est un prompt de
préparation, pas une exécution de recherche. Une interrogation métier peut créer
son épisode de traçabilité ; ne pas confondre absence de modification du savoir
avec absence d’écriture technique. Les validations/publications sensibles restent
soumises aux droits et à la confirmation signée de l’hôte.

### Ce que signifie « n’importe quel chatbot »

- **Client MCP exécuté sur ce Mac**, compatible Streamable HTTP et en-têtes
  personnalisés : endpoint local disponible ; intégration et renouvellement à
  valider dans le client choisi. Aucun chatbot externe n’a été connecté ici.
- **Client acceptant uniquement stdio** : un adaptateur local stdio↔HTTP est
  nécessaire ; ce point n’est pas livré par le lanceur de console.
- **Chatbot qui appelle les outils depuis son cloud** : il ne peut pas atteindre
  le loopback du Mac. Il faut un endpoint HTTPS accessible, un fournisseur OAuth,
  et une résolution du tenant compatible avec le client. Aucun tunnel ni service
  public n’a été créé. Les en-têtes personnalisés ne sont pas supportés par tous
  les hôtes ; l’interopérabilité universelle n’est donc pas acquise.

MCP est le protocole d’accès aux outils ; il ne rend pas automatiquement un
chatbot compatible. Voir les transports [stdio et Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
et la [spécification d’autorisation](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
Connecter un modèle hébergé lui transmettrait les extraits retournés par ses
appels : la consigne actuelle de conserver OKF privé, sans fournisseur modèle,
reste appliquée. Le choix d’un tel destinataire et du périmètre partagé reste à
arrêter avant toute connexion distante.

The server exposes Streamable HTTP at `/mcp/`, exhaustive application tools, read-only resources and user-selected prompts. It does not include a companion UI or an authorization server. Transport tests include the installed MCP Python SDK over in-process HTTP with synthetic signed identities. The SDK completes discovery, cited query, companion response receipt, targeted feedback and revoked-access rejection. No external companion product or live enterprise identity provider has been validated yet.

## Discovery primitives

| Primitive | Purpose |
|---|---|
| `initialize` | Advertises tools/resources/prompts and returns the companion guide as server instructions |
| `cortex://guide` | Evidence, consent, provenance and confirmation protocol |
| `cortex://workspace` | Current subject, domain memberships and capabilities |
| `cortex://actions` | Action effects and decision policies; inventory is not authority |
| `cortex://domains/{domain_id}/context` | Authorized domain versions and personal feedback preferences |
| `ask_cortex(domain_id, question)` | Prepares a query with citations and an episode reference |
| `review_cortex_proposal(domain_id, proposal_id)` | Prepares inspection and a concrete review decision |
| `report_cortex_feedback(domain_id, episode_id)` | Prepares provenance-aware reporting for the caller's own episode |

Use `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list` and `prompts/get` with their normal MCP request shapes. Inventory exports live in `packages/contracts/mcp-discovery.json`; CI checks them for drift. All discovery primitives require the same bearer identity and tenant transport headers as tools. Dynamic data is computed on every read; hosts must not reuse private context across users or tenant sessions.

Prompts validate the selected domain and, when applicable, proposal/episode permissions. Preparing a prompt never runs a query, records feedback, approves or publishes. Permission to inspect a proposal does not grant permission to approve it. A query prompt carries user-supplied text as data; JSON encoding does not make malicious text safe for an LLM. Hosts must continue to distinguish user intent, tool results and untrusted document/comment text.

## Bearer integration

For local development, supply a signed RS256 JWT accepted by the configured issuer/audience/public key or HTTPS JWKS, plus `X-Tenant-ID`. Use `api_identity_read` to discover actual memberships. Tenant selection is routing context, not permission. JWT role claims are not used as domain authority.

For public HTTPS discovery, explicitly configure:

```sh
CORTEX_MCP_PUBLIC_URL=https://cortex.example.com/mcp/
CORTEX_JWT_AUDIENCE=https://cortex.example.com/mcp/
CORTEX_JWT_ISSUER=https://identity.example.com/realms/cortex
CORTEX_JWKS_URL=https://identity.example.com/realms/cortex/protocol/openid-connect/certs
```

The issuer must issue an RS256 access token for this exact resource audience with `sub`, `iss`, `aud`, `iat` and `exp`. The resource URL must be canonical HTTPS with path `/mcp/`, no credentials, query or fragment. The configured issuer is advertised as the authorization server; configure a real issuer that provides its own OAuth/OIDC discovery and client registration policy. Key-file verification remains possible for deployments that manage keys explicitly.

When enabled, unauthenticated MCP requests return a `401` bearer challenge containing the configured `resource_metadata` URL. Public `GET /.well-known/oauth-protected-resource` returns the resource URI, issuer, header-only bearer method and resource name. This follows the protected-resource discovery and resource audience binding described by the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). When unconfigured, the metadata route returns `404 DISCOVERY_DISABLED` and the challenge is simply `Bearer`.

Metadata is built from server configuration, never from incoming Host or forwarded headers. The configured HTTPS host/origin is explicitly allowed in MCP transport protection; local loopback hosts remain available for operations. Other hosts/origins are rejected. A reverse proxy must terminate TLS and preserve the configured host or use an allowed loopback upstream host. This setting does not provision TLS, DNS or a public deployment.

## Host responsibilities and remaining validation

- Acquire and refresh tokens through the real issuer's client flow. This backend does not implement login, PKCE exchange, dynamic client registration, refresh tokens or token issuance.
- Supply the selected tenant in `X-Tenant-ID`. Clients without configurable transport headers need a host adapter. This remains a compatibility constraint even when OAuth metadata discovery works.
- Keep tokens and trusted-host confirmation signing keys outside model arguments. Follow [signed confirmation handling](mcp-exhaustive.md) for sensitive operations. A compatible host must collect the actual user decision before signing.
- Optionally retain the delivered answer with [companion response receipts](companion-responses.md), then associate feedback with its returned ID.
- Preserve idempotency keys, inspect state after uncertain outcomes, and display citations, served version and feedback origin faithfully.
- Re-read personal collection preferences and honor opt-out. See [feedback loop](feedback-loop.md).

No OAuth scope model is advertised by this increment; domain roles and object permissions remain enforced by the application. Deployment still requires an issuer and companion interoperability test, session/credential lifecycle policy and operational hardening. Exhaustive tool exposure and metadata discovery alone do not demonstrate compatibility with every LLM host.

## Browser origins

The optional `CORTEX_CORS_ORIGINS` exact allowlist admits browser preflights and exposes MCP session headers. Accepted origins are also passed to MCP transport origin validation; they never expand allowed server hosts. Authentication, signed confirmations and DNS-rebinding protection remain enforced. See the [French browser integration guide](frontend-guide.fr.md).
