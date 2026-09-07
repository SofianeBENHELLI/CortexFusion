"""Explicit interaction inventory. Metadata describes policy; services enforce authority."""

import re

from fastapi.openapi.utils import get_openapi

# method/path | stable action ID | role set | effect | example user intent
# Placeholder names are normalized so wording changes do not change action IDs.
DEFINITIONS = """
POST /episodes/{}/companion-responses|responses.create|member|personal|Conserve la réponse de mon companion et ses références à cet épisode.
GET /companion-responses|responses.list|member|none|Retrouve les réponses personnelles de mes companions.
GET /companion-responses/{}|responses.read|member|none|Montre cette réponse et les preuves de l'épisode associé.
GET /model-attempts|models.attempts|owner|none|Liste mes tentatives d'extraction et leurs résultats durables.
GET /model-attempts/{}|models.attempt|owner|none|Inspecte cette tentative sans relancer le fournisseur.
GET /model-usage|models.usage|owner|none|Quel quota de tentatives IA reste disponible aujourd'hui dans ce domaine ?
GET /feedback-summary|feedback.summary|member|none|Résume mes signaux accessibles en séparant votes, observations et estimations.
GET /.well-known/oauth-protected-resource|system.mcp_discovery|public|none|Découvre le fournisseur d'identité configuré pour cette ressource MCP.
GET /feedback-preferences|feedback.preferences|member|none|Quelles remontées automatiques ai-je autorisées ?
PUT /feedback-preferences|feedback.configure|member|personal|Modifie mes préférences de remontée automatique avec mon accord explicite.
POST /episodes/{}/signals|feedback.record_signal|member|personal|Enregistre ce signal de feedback avec son origine déclarée.
GET /feedback-signals|feedback.signals|member|none|Montre mes signaux de feedback accessibles.
GET /health|system.health|public|none|Vérifie que le service répond.
GET /v1/me|identity.read|member|none|Quels domaines et fonctions me sont accessibles ?
GET /v1/interactions|interactions.list|member|none|Quelles actions puis-je préparer avec cette API ?
POST /conversations|conversations.create|member|personal|Crée une conversation sur les incidents.
GET /conversations|conversations.list|member|none|Retrouve mes conversations actives.
GET /conversations/{}|conversations.read|member|none|Ouvre cette conversation.
PUT /conversations/{}|conversations.update|member|personal|Archive cette conversation.
GET /conversations/{}/messages|conversations.messages|member|none|Montre les messages précédents de cette conversation.
POST /conversations/{}/query|conversations.query|member|episode|Pose cette question dans ma conversation et cite les preuves.
GET /members|members.list|owner|none|Qui a accès à ce domaine ?
POST /members|members.change|owner|access|Prépare le changement de rôle de ce membre.
GET /membership-events|members.history|owner|none|Montre les changements d'accès du domaine.
GET /commits|commits.list|owner|none|Montre le journal des changements acceptés.
GET /proposals/{}/diff|proposals.diff|writer|none|Compare cette proposition à la connaissance publiée.
GET /sources/{}/chunks|sources.chunks|member|none|Découpe cette source en passages consultables.
POST /collections|collections.create|corpus|corpus|Crée une collection privée avec ces lecteurs.
GET /collections|collections.list|member|none|Recherche mes collections accessibles.
GET /collections/{}|collections.read|member|none|Montre cette collection.
GET /sources|sources.list|member|none|Recherche les sources sur les incidents.
POST /sources|sources.create|corpus|corpus|Enregistre ce texte avec ces droits d'accès.
POST /collections/{}/imports|imports.create|corpus|corpus|Prépare l'import de ces textes dans cette collection.
GET /imports|imports.list|member|none|Où en sont mes imports ?
GET /imports/{}|imports.read|member|none|Montre le reçu de cet import.
POST /imports/{}/process|imports.process|corpus|corpus|Traite les prochains éléments de cet import.
POST /imports/{}/cancel|imports.cancel|corpus|corpus|Annule les éléments encore en attente.
POST /imports/{}/retry|imports.retry|corpus|corpus|Reprogramme les éléments de cet import en échec.
POST /collections/{}/files|files.upload|corpus|corpus|Dépose ce fichier dans cette collection.
GET /files|files.list|member|none|Liste les fichiers auxquels j'ai accès.
GET /files/{}|files.read|member|none|Montre le résultat d'analyse de ce fichier.
GET /files/{}/download|files.download|member|none|Télécharge le fichier original.
POST /files/{}/process|files.process|corpus|corpus|Extrais le texte de ce fichier.
POST /files/{}/retry|files.retry|corpus|corpus|Reprogramme l'analyse de ce fichier.
POST /files/{}/cancel|files.cancel|corpus|corpus|Annule l'analyse de ce fichier.
GET /issues|issues.list|member|none|Liste mes signalements ouverts.
GET /issues/{}|issues.read|member|none|Montre ce signalement personnel.
GET /issues/{}/events|issues.history|member|none|Montre les décisions sur ce signalement.
POST /issues/{}/decisions|issues.decide|member|personal|Résous mon signalement avec cette justification.
GET /proposals|proposals.list|writer|none|Quelles propositions attendent une revue ?
POST /proposals|proposals.create|writer|proposal|Prépare une proposition appuyée sur ces passages.
GET /episodes|episodes.list|member|none|Retrouve mes questions et les versions servies.
POST /proposals/{}/reviews|proposals.review|owner|review|Demande une modification de cette proposition.
GET /proposals/{}/reviews|proposals.reviews|writer|none|Montre les décisions de revue de cette proposition.
POST /proposals/{}/revise|proposals.revise|writer|proposal|Crée une nouvelle révision de ma proposition.
POST /sources/{}/extract-local|sources.extract_local|owner|local_model|Sélectionne un passage de cette source avec le modèle local.
POST /sources/{}/extract|sources.extract|owner|model|Prépare l'extraction de ce passage avec le fournisseur configuré.
GET /extractions/{}|extractions.read|owner|none|Montre le reçu de mon extraction.
GET /version|domain.version|member|none|Quelle version de connaissance est publiée ?
GET /sources/{}|sources.read|member|none|Montre cette source et son empreinte.
PUT /sources/{}/access|sources.access|owner|access|Prépare la modification des lecteurs de cette source.
POST /sources/{}/propose|sources.propose|writer|proposal|Transforme cette source en proposition à relire.
GET /proposals/{}|proposals.read|writer|none|Montre le contenu et l'état de cette proposition.
POST /proposals/{}/approve|proposals.approve|owner|trusted|Prépare l'approbation de cette version précise de la proposition.
POST /publish|domain.publish|owner|trusted|Publie le changement accepté en attente.
POST /replay|domain.replay|owner|rebuild|Reconstruis la projection depuis le journal publié.
POST /commits/{}/compensate|commits.compensate|owner|proposal|Prépare une proposition compensant ce changement.
GET /concepts|concepts.list|member|none|Liste les concepts publiés accessibles.
GET /concepts/{}|concepts.read|member|none|Montre ce concept avec ses relations accessibles.
POST /query|knowledge.query|member|episode|Réponds à ma question avec les passages approuvés.
GET /episodes/{}|episodes.read|member|none|Retrouve la réponse citée à cette question passée.
POST /episodes/{}/feedback|episodes.feedback|member|personal|Signale que cette réponse ne m'aide pas.
GET /brief|domain.brief|owner|none|Résume les propositions en attente et mes signalements actifs.
"""

ROLE_SETS = {
    "public": [],
    "member": ["owner", "corpus_manager", "contributor", "agent", "viewer"],
    "writer": ["owner", "corpus_manager", "contributor", "agent"],
    "corpus": ["owner", "corpus_manager"],
    "owner": ["owner"],
}
EFFECTS = {
    "none": "Read only; no durable application change.",
    "personal": "Changes personal state or appends personal feedback/decision history.",
    "episode": "Retrieves approved excerpts and records a private episode; a gap can create a personal issue.",
    "corpus": "Changes corpus/import/file state; does not publish trusted knowledge.",
    "proposal": "Creates or revises a proposal; does not publish trusted knowledge.",
    "review": "Records a review decision and changes proposal review status.",
    "access": "Changes domain membership or source readers; may revoke access immediately.",
    "trusted": "Accepts or publishes a trusted-knowledge change; approval and publication are separate.",
    "rebuild": "Rebuilds the published projection from the journal.",
    "model": "Sends the selected source span to the explicitly selected configured provider; may incur charges; creates a proposal.",
    "local_model": "Sends source text to the configured loopback model and creates a proposal.",
}


def normalized(method, path):
    path = path.removeprefix("/v1/domains/{domain}")
    return method.upper() + " " + re.sub(r"\{[^}]+\}", "{}", path)


REGISTRY = {}
for line in DEFINITIONS.strip().splitlines():
    key, ident, roles, effect, intent = line.split("|")
    REGISTRY[key] = {
        "action_id": ident,
        "roles": ROLE_SETS[roles],
        "effect": effect,
        "effect_description": EFFECTS[effect],
        "intent_example": intent,
        "confirmation_policy": "explicit_user_decision"
        if effect in {"access", "trusted", "rebuild", "model", "local_model", "review"}
        or ident in {"feedback.configure", "commits.compensate"}
        else "authorized_user_intent",
        "object_authorization": "Service checks membership, current evidence access and personal/author scope where applicable. Listed roles alone do not grant object access.",
    }


def install_openapi(app):
    def schema():
        if app.openapi_schema:
            return app.openapi_schema
        spec = get_openapi(
            title=app.title, version=app.version, description=app.description, routes=app.routes
        )
        spec["x-cortex-http-confirmation-mode"] = app.state.confirmation_guard.mode
        from .contracts import STREAM_CONTRACTS

        components = spec.setdefault("components", {}).setdefault("schemas", {})
        for event in STREAM_CONTRACTS:
            event_schema = event.model_json_schema(ref_template="#/components/schemas/{model}")
            for name, definition in event_schema.pop("$defs", {}).items():
                components.setdefault(name, definition)
            components[event.__name__] = event_schema
        spec.setdefault("components", {}).setdefault("securitySchemes", {})["BearerAuth"] = {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
        }
        seen = set()
        for path, methods in spec["paths"].items():
            for method, operation in methods.items():
                key = normalized(method, path)
                if key not in REGISTRY:
                    raise RuntimeError(f"Missing interaction contract: {key}")
                meta = REGISTRY[key]
                seen.add(key)
                operation["operationId"] = meta["action_id"]
                operation["x-cortex-interaction"] = meta
                operation["description"] = (
                    meta["intent_example"]
                    + "\n\n"
                    + meta["effect_description"]
                    + "\n\n"
                    + meta["object_authorization"]
                )
                if meta["roles"]:
                    operation["security"] = [{"BearerAuth": []}]
                    operation["parameters"] = [
                        p
                        for p in operation.get("parameters", [])
                        if p.get("name") != "authorization"
                    ]
                    for param in operation["parameters"]:
                        if param.get("name") == "x-tenant-id":
                            param["required"] = True
                            param["schema"] = {"type": "string", "format": "uuid"}
                    for code, description in {
                        "401": "Missing or invalid authentication.",
                        "403": "Role does not authorize this action.",
                        "404": "Absent or inaccessible object; do not infer its existence.",
                        "409": "State/version/idempotency conflict; refresh before deciding.",
                        "413": "Request exceeds body limit.",
                        "422": "Invalid parameters, evidence, state or model output.",
                        "429": "Configured domain model attempt limit reached; no new provider call started.",
                        "503": "Storage or configured model unavailable; do not claim completion.",
                    }.items():
                        operation["responses"][code] = {
                            "description": description,
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "required": ["error"],
                                        "properties": {
                                            "error": {"type": "string"},
                                            "message": {"type": "string"},
                                            "details": {
                                                "type": "array",
                                                "items": {"type": "object"},
                                            },
                                        },
                                    }
                                }
                            },
                        }
                    if meta["confirmation_policy"] == "explicit_user_decision":
                        operation["responses"]["428"] = {
                            "description": "Strict HTTP mode requires a signed trusted-host confirmation.",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "required": ["error", "confirmation_request"],
                                        "properties": {
                                            "error": {"type": "string"},
                                            "message": {"type": "string"},
                                            "confirmation_request": {
                                                "type": "object",
                                                "required": [
                                                    "action",
                                                    "command_hash",
                                                    "transport_header",
                                                    "max_lifetime_seconds",
                                                ],
                                                "properties": {
                                                    "action": {"type": "string"},
                                                    "command_hash": {
                                                        "type": "string",
                                                        "pattern": "^[a-f0-9]{64}$",
                                                    },
                                                    "transport_header": {
                                                        "const": "X-Cortex-Confirmation"
                                                    },
                                                    "max_lifetime_seconds": {"const": 300},
                                                },
                                            },
                                        },
                                    }
                                }
                            },
                        }
        if seen != set(REGISTRY):
            raise RuntimeError("Interaction inventory contains an unregistered route")
        app.openapi_schema = spec
        return spec

    app.openapi = schema


def catalog(spec):
    return {
        "version": "1",
        "openapi_url": "/openapi.json",
        "authorization_notice": "This is an inventory, not an authorization grant. Use /v1/me for actual memberships; the server rechecks every operation.",
        "items": [
            {
                **op["x-cortex-interaction"],
                "method": method.upper(),
                "path": path,
                "operation_id": op["operationId"],
            }
            for path, methods in spec["paths"].items()
            for method, op in methods.items()
        ],
    }
