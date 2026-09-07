"""Export reviewed French semantics together with exact existing wire contracts."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EFFECTS = {
    "none": "Lecture sans modification métier durable.",
    "personal": "Écriture personnelle ou ajout à un historique personnel.",
    "corpus": "Enregistrement ou traitement de corpus ; aucune publication automatique.",
    "proposal": "Création/révision de proposition ; connaissance servie inchangée.",
    "review": "Décision de revue ; approbation et publication restent distinctes.",
    "access": "Modification des accès ; révocation potentiellement immédiate.",
    "trusted": "Acceptation ou publication selon l'opération ; consulter le reçu.",
    "rebuild": "Reconstruction de la projection publiée depuis le journal.",
    "episode": "Recherche avec création d'un épisode personnel.",
    "model": "Traitement par fournisseur configuré, potentiellement facturé.",
    "local_model": "Traitement par modèle local configuré.",
}


def cell(value):
    return str(value).replace("|", "&#124;").replace("\n", " ")


def schema_type(schema):
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        return f"[{name}](#schema-{name.lower()})"
    for union in ("anyOf", "oneOf", "allOf"):
        if union in schema:
            return " / ".join(schema_type(s) for s in schema[union])
    if schema.get("type") == "array":
        return "liste de " + schema_type(schema.get("items", {}))
    if "const" in schema:
        return "`" + cell(json.dumps(schema["const"], ensure_ascii=False)) + "`"
    if "enum" in schema:
        return ", ".join(
            "`" + cell(json.dumps(v, ensure_ascii=False)) + "`" for v in schema["enum"]
        )
    return {
        "string": "texte",
        "integer": "entier",
        "number": "nombre",
        "boolean": "booléen",
        "object": "objet",
        "null": "null",
    }.get(schema.get("type"), "voir schéma JSON")


def constraints(schema):
    labels = {
        "format": "format",
        "minimum": "minimum",
        "maximum": "maximum",
        "exclusiveMinimum": "strictement supérieur à",
        "exclusiveMaximum": "strictement inférieur à",
        "minLength": "longueur min.",
        "maxLength": "longueur max.",
        "minItems": "éléments min.",
        "maxItems": "éléments max.",
        "pattern": "motif",
        "default": "défaut",
    }
    values = [
        f"{label} : `{cell(json.dumps(schema[key], ensure_ascii=False))}`"
        for key, label in labels.items()
        if key in schema
    ]
    return "; ".join(values) or "—"


def build(spec, inventory, translations, mcp):
    items = inventory["items"]
    ids = {i["action_id"] for i in items}
    if len(ids) != len(items) or ids != set(translations):
        raise ValueError(
            f"French action coverage differs: missing={sorted(ids - set(translations))}, "
            f"obsolete={sorted(set(translations) - ids)}"
        )
    tool_names = {t["name"] for t in mcp["tools"]}
    result = []
    for item in items:
        action = item["action_id"]
        wording = translations[action]
        if set(wording) != {"description", "frontend"} or any(
            not isinstance(v, str) or not v.strip() for v in wording.values()
        ):
            raise ValueError(f"Missing French functional description: {action}")
        operation = spec["paths"][item["path"]][item["method"].lower()]
        if operation["operationId"] != action:
            raise ValueError(f"OpenAPI operation mismatch: {action}")
        name = "api_" + action.replace(".", "_")
        if name not in tool_names:
            raise ValueError(f"Missing generated MCP tool: {name}")
        result.append(
            {
                **item,
                "description_fr": wording["description"],
                "frontend_fr": wording["frontend"],
                "effect_fr": EFFECTS[item["effect"]],
                "mcp_tool": name,
                "mcp_confirmation_required": item["confirmation_policy"] == "explicit_user_decision"
                or action == "commits.compensate",
                "parameters": operation.get("parameters", []),
                "request_body": operation.get("requestBody"),
                "responses": {
                    status: response
                    if status.startswith("2")
                    else {"error_contract": "common_error"}
                    for status, response in operation["responses"].items()
                },
            }
        )
    return {
        "language": "fr",
        "version": "1",
        "notice": "Catalogue documentaire ; aucune autorisation individuelle n'est accordée.",
        "items": result,
        "http_confirmation_mode": spec["x-cortex-http-confirmation-mode"],
        "common_error": {
            "required": ["error"],
            "optional": ["message", "details", "confirmation_request"],
            "confirmation_request": {
                "required": ["action", "command_hash", "transport_header", "max_lifetime_seconds"],
                "transport_header": "X-Cortex-Confirmation",
                "max_lifetime_seconds": 300,
            },
        },
        "schemas": spec.get("components", {}).get("schemas", {}),
    }


def render(document):
    items = document["items"]
    lines = [
        "# Référence fonctionnelle française des endpoints",
        "",
        "Générée par `scripts/export_frontend_reference.py` depuis OpenAPI, le catalogue "
        "HTTP/MCP et les descriptions relues de `docs/fr/actions.json`. Ne pas modifier "
        "ce fichier directement. Le contrôle `make contracts` refuse une opération non documentée.",
        "",
        "Lire d'abord le [guide des parcours frontend](frontend-guide.fr.md). Cette référence "
        "décrit le comportement actuel, pas des fonctions futures. Le catalogue machine français "
        "est `packages/contracts/functional-interactions.fr.json`.",
        "",
        f"Couverture : **{len(items)} opérations HTTP**, chacune liée à son outil MCP généré. "
        "Les outils de compatibilité et les ressources/prompts sont décrits dans le guide MCP.",
        "",
        "## Règles communes",
        "",
        "- Les rôles listés sont des prérequis ; tenant, domaine, droits sur les preuves et "
        "propriété des objets personnels restent contrôlés par le serveur.",
        "- Sur les routes protégées, envoyer `Authorization: Bearer …` et `X-Tenant-ID`. "
        "Le jeton provient de l'hôte authentifié, jamais d'un modèle.",
        "- Les actions sensibles requièrent `X-Cortex-Confirmation` en MCP et en HTTP direct "
        "par défaut (`CORTEX_HTTP_CONFIRMATION_MODE=required`). Le mode HTTP `trusted_host` "
        "est une compatibilité explicite réservée à un hôte qui recueille les décisions ; "
        "il ne désactive jamais les confirmations MCP.",
        "- Pour une reprise, conserver la clé d'idempotence uniquement si le schéma ou les "
        "paramètres la prévoient. Sans clé, ne pas répéter aveuglément une écriture.",
        "- Les réponses d'erreur sont `{error, message?, details?}`. Les statuts ci-dessous "
        "sont le contrat déclaré commun, pas la preuve que chaque erreur est atteignable sur chaque route.",
        "- Les champs absents et `null` sont distincts. Les bornes et champs requis sont "
        "repris du schéma ; des règles métier supplémentaires sont contrôlées à l'exécution.",
        "",
        "## Index",
        "",
        "| Action | HTTP | Fonction |",
        "|---|---|---|",
    ]
    for item in items:
        action = item["action_id"]
        lines.append(
            f"| [{action}](#action-{action.replace('.', '-')}) | "
            f"`{item['method']} {item['path']}` | {cell(item['intent_example'])} |"
        )
    for item in items:
        action = item["action_id"]
        lines += [
            "",
            f'<a id="action-{action.replace(".", "-")}"></a>',
            f"## {action}",
            "",
            item["description_fr"],
            "",
            f"**Utilisation frontend :** {item['frontend_fr']}",
            "",
            f"- HTTP : `{item['method']} {item['path']}`.",
            f"- MCP : `{item['mcp_tool']}` ; arguments structurés `path`, `query`, "
            "`body` et éventuellement `header` selon `mcp-tools.json`. "
            "Authentification et confirmation sont ajoutées par le transport de l'hôte.",
            f"- Rôles préalables : {', '.join(item['roles']) or 'public'}.",
            f"- Effet : {item['effect_fr']}",
            "- Décision : "
            + (
                "accord explicite ; confirmation signée en MCP et HTTP strict."
                if item["mcp_confirmation_required"]
                else "intention utilisateur autorisée ; aucune élévation de rôle implicite."
            ),
            "",
            "### Paramètres",
            "",
        ]
        if item["parameters"]:
            lines += [
                "| Emplacement | Nom | Requis | Type | Contraintes |",
                "|---|---|---|---|---|",
            ]
            for p in item["parameters"]:
                lines.append(
                    f"| {p['in']} | `{p['name']}` | {'oui' if p.get('required') else 'non'} | "
                    f"{schema_type(p.get('schema', {}))} | {constraints(p.get('schema', {}))} |"
                )
        else:
            lines.append("Aucun paramètre déclaré.")
        body = item["request_body"]
        lines += ["", "### Corps et résultat", ""]
        if body:
            for media, content in body.get("content", {}).items():
                lines.append(
                    f"- Corps {'requis' if body.get('required') else 'facultatif'} "
                    f"`{media}` : {schema_type(content.get('schema', {}))}."
                )
        else:
            lines.append("- Aucun corps attendu.")
        for status, response in item["responses"].items():
            if status.startswith("2"):
                contents = response.get("content", {})
                if not contents:
                    lines.append(f"- Succès HTTP {status} ; aucun schéma de corps déclaré.")
                for media, content in contents.items():
                    lines.append(
                        f"- Succès HTTP {status}, `{media}` : "
                        f"{schema_type(content.get('schema', {}))}."
                    )
        errors = [s for s in item["responses"] if not s.startswith("2")]
        lines.append(
            "- Erreurs déclarées : " + (", ".join(errors) or "voir erreurs de transport") + "."
        )
    lines += [
        "",
        "## Schémas des données",
        "",
        "Les noms techniques restent identiques dans HTTP, TypeScript et MCP. "
        "Les champs d'un objet imbriqué sont décrits par le lien vers son schéma. "
        "Le JSON machine conserve toutes les contraintes, y compris les alternatives complexes.",
        "",
    ]
    for name, schema in sorted(document["schemas"].items()):
        lines += [f'<a id="schema-{name.lower()}"></a>', f"### {name}", ""]
        if schema.get("properties"):
            if schema.get("additionalProperties") is False:
                lines += ["Champs non déclarés interdits.", ""]
            lines += ["| Champ | Requis | Type / valeurs | Contraintes |", "|---|---|---|---|"]
            for key, value in schema["properties"].items():
                lines.append(
                    f"| `{key}` | {'oui' if key in schema.get('required', []) else 'non'} | "
                    f"{schema_type(value)} | {constraints(value)} |"
                )
        else:
            lines.append(schema_type(schema) + " ; " + constraints(schema))
        lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    def read(path):
        return json.loads((ROOT / path).read_text())

    document = build(
        read("packages/contracts/openapi.json"),
        read("packages/contracts/interactions.json"),
        read("docs/fr/actions.json"),
        read("packages/contracts/mcp-tools.json"),
    )
    artifacts = {
        "packages/contracts/functional-interactions.fr.json": json.dumps(
            document, ensure_ascii=False, indent=2
        )
        + "\n",
        "docs/frontend-api.fr.md": render(document),
    }
    for name, content in artifacts.items():
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit(
                    f"French contract drift: {name}; run scripts/export_frontend_reference.py"
                )
        else:
            path.write_text(content)
    print(f"{len(document['items'])} French HTTP/MCP descriptions verified/exported")


if __name__ == "__main__":
    main()
