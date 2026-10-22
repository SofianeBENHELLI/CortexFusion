import { useState } from "react";
import type {
  AccessibleDomain,
  Role,
} from "../../../../packages/contracts/src/IdentityView";

export const responsibility: Record<Role, { label: string; purpose: string }> =
  {
    owner: {
      label: "Responsable de domaine",
      purpose: "Superviser le domaine et décider des évolutions du savoir.",
    },
    corpus_manager: {
      label: "Responsable de corpus",
      purpose:
        "Organiser le travail documentaire et coordonner les contributions.",
    },
    contributor: {
      label: "Contributeur",
      purpose: "Améliorer les connaissances et répondre aux missions confiées.",
    },
    viewer: {
      label: "Lecteur",
      purpose:
        "Consulter les connaissances, leurs sources et donner un retour.",
    },
    agent: {
      label: "Agent technique",
      purpose:
        "Utiliser les opérations autorisées à cette identité de service.",
    },
  };

export const assignedRoles = (domain: AccessibleDomain): Role[] =>
  domain.roles ?? [domain.role];
export const responsibilityLabel = (domain: AccessibleDomain) =>
  assignedRoles(domain)
    .map((role) => responsibility[role].label)
    .join(" · ");

export function availableNextSteps(domain: AccessibleDomain) {
  const has = (capability: string) => domain.capabilities.includes(capability);
  return [
    has("work_brief") &&
      (has("coordinate_tasks")
        ? "Consulter le brief du domaine et répartir les tâches."
        : "Consulter mon brief et prendre en charge mes tâches."),
    has("import_commands") && "Préparer un import et suivre ses résultats.",
    has("propose") &&
      "Préparer une contribution sourcée à soumettre à la revue.",
    has("feedback") && "Poser une question puis donner un avis sur la réponse.",
  ].filter((step): step is string => !!step);
}

export function ResponsibilityHelp({ domain }: { domain: AccessibleDomain }) {
  const steps = availableNextSteps(domain);
  return (
    <details className="workspace-responsibility">
      <summary>{responsibilityLabel(domain)} · Mon rôle et mes actions</summary>
      <p>
        {assignedRoles(domain)
          .map((role) => responsibility[role].purpose)
          .join(" ")}
      </p>
      {steps.length > 0 ? (
        <ul>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : (
        <p>
          Les actions disponibles sont celles autorisées par le serveur dans cet
          espace.
        </p>
      )}
      <p>
        Les boutons et les commandes guidées du chat agissent dans le même
        domaine. Une préparation ne publie aucun savoir.
      </p>
      {domain.role === "viewer" && <McpEntryHelp />}
    </details>
  );
}

function McpEntryHelp() {
  return (
    <details className="workspace-mcp-help">
      <summary>Utiliser dans mon chatbot</summary>
      <p>
        Connectez un chatbot compatible MCP au serveur de votre organisation,
        avec votre identité et vos accès. Demandez à votre administrateur
        l’adresse MCP et le mode de connexion : cette page ne les configure pas.
      </p>
      <p>
        Le chatbot peut interroger le savoir, retrouver les sources et
        transmettre votre avis explicite. Ses actions restent soumises aux mêmes
        droits. Le simple défilement dans un chatbot ne transmet pas
        automatiquement un feedback.
      </p>
    </details>
  );
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
const PAGE_SIZE = 8;

/** A view over /me, never a role or permission grant. No new preference storage. */
export function WorkspaceEntry({
  domains,
  localAccess,
  onOpen,
}: {
  domains: readonly AccessibleDomain[];
  localAccess: boolean;
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(0);
  const roles = [...new Set(domains.flatMap(assignedRoles))];
  const effectiveRole = roles.some((value) => value === role) ? role : "";
  const visible = domains.filter(
    (domain) =>
      (!effectiveRole ||
        assignedRoles(domain).some((role) => role === effectiveRole)) &&
      normalize(domain.name).includes(normalize(search.trim())),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1),
  );
  const shown = visible.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  return (
    <section
      className="workspace-entry"
      aria-labelledby="workspace-entry-heading"
    >
      <p className="kicker">
        {localAccess ? "Espace personnel local" : "Vos espaces autorisés"}
      </p>
      <h1 id="workspace-entry-heading">Par où voulez-vous commencer ?</h1>
      <p>
        Choisissez le domaine dans lequel vous souhaitez travailler. Vous y
        retrouverez la conversation, les preuves et vos prochaines actions.
      </p>
      {domains.length === 0 ? (
        <p>
          Demandez à votre administrateur de vous attribuer un accès. Aucun rôle
          ne peut être ajouté depuis cet écran.
        </p>
      ) : (
        <>
          <div className="workspace-entry-filters">
            <label>
              Rechercher un domaine
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              Ma responsabilité
              <select
                value={effectiveRole}
                onChange={(event) => {
                  setRole(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">Toutes mes responsabilités</option>
                {roles.map((value) => (
                  <option value={value} key={value}>
                    {responsibility[value].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p role="status">
            {visible.length} résultat{visible.length === 1 ? "" : "s"} sur{" "}
            {domains.length} domaine{domains.length === 1 ? "" : "s"} accessible
            {domains.length === 1 ? "" : "s"}
            {visible.length > 0 &&
              ` · ${currentPage * PAGE_SIZE + 1}–${currentPage * PAGE_SIZE + shown.length} affichés`}
          </p>
          {visible.length === 0 && (
            <div>
              <p>Aucun domaine ne correspond à ces filtres.</p>
              <button
                onClick={() => {
                  setSearch("");
                  setRole("");
                  setPage(0);
                }}
              >
                Effacer les filtres
              </button>
            </div>
          )}
          <div className="workspace-entry-cards">
            {shown.map((domain) => (
              <article key={domain.id}>
                <p className="kicker">{responsibilityLabel(domain)}</p>
                <h2>{domain.name}</h2>
                {domains.filter((other) => other.name === domain.name).length >
                  1 && <p>Référence : {domain.id}</p>}
                <p>
                  {assignedRoles(domain)
                    .map((role) => responsibility[role].purpose)
                    .join(" ")}
                </p>
                <p className="workspace-entry-next">
                  {availableNextSteps(domain)[0] ??
                    "Ouvrir la conversation et consulter les actions autorisées."}
                </p>
                <button
                  aria-label={`Ouvrir mon espace : ${domain.name}`}
                  onClick={() => onOpen(domain.id)}
                >
                  Ouvrir mon espace <span aria-hidden="true">↗</span>
                </button>
                {domain.role === "viewer" && <McpEntryHelp />}
              </article>
            ))}
          </div>
          {visible.length > PAGE_SIZE && (
            <nav
              className="workspace-entry-pages"
              aria-label="Pages des espaces"
            >
              <button
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Espaces précédents
              </button>
              <span>
                Page {currentPage + 1} sur{" "}
                {Math.ceil(visible.length / PAGE_SIZE)}
              </span>
              <button
                disabled={(currentPage + 1) * PAGE_SIZE >= visible.length}
                onClick={() => setPage(currentPage + 1)}
              >
                Espaces suivants
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
