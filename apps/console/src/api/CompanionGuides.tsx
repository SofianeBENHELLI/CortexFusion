import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { CompanionWorkflowCatalog } from "../../../../packages/contracts/src/CompanionWorkflowCatalog";
import type { CompanionWorkflowGuide } from "../../../../packages/contracts/src/CompanionWorkflowGuide";
import { ApiError, type CortexApi } from "./client";
import { ActivityStatus } from "../ActivityStatus";
import type { RecoveryScope } from "./taskRecoveryStore";
import { textBound } from "./missionValidation";
import type { GuideIntent } from "./guideCommands";
export type GuideActions = { act: (intent: GuideIntent) => Promise<string> };
const ids = [
  "consult",
  "feedback",
  "follow-up",
  "task",
  "correction",
  "domain",
];
const guideKeys = [
  "id",
  "title",
  "intent",
  "required_capability",
  "steps",
  "tools",
  "decision",
  "effect",
  "recovery",
  "limits",
  "example",
]
  .sort()
  .join();
export function validateGuides(c: CompanionWorkflowCatalog) {
  const bad = () => new ApiError(200, "invalid_response");
  if (
    !c ||
    Object.keys(c).sort().join() !==
      [
        "version",
        "documentation_only",
        "client_compatibility",
        "client_requirements",
        "guides",
      ]
        .sort()
        .join() ||
    c.documentation_only !== true ||
    c.client_compatibility !== "not_qualified" ||
    !textBound(c.version, 40) ||
    !Array.isArray(c.client_requirements) ||
    c.client_requirements.length < 1 ||
    c.client_requirements.length > 8 ||
    !c.client_requirements.every((s) => textBound(s, 1500)) ||
    !Array.isArray(c.guides) ||
    c.guides.length !== 6 ||
    c.guides.map((g) => g?.id).join() !== ids.join()
  )
    throw bad();
  for (const g of c.guides) {
    if (
      !g ||
      Object.keys(g).sort().join() !== guideKeys ||
      !textBound(g.title, 100) ||
      !textBound(g.intent, 500) ||
      !/^[a-z_]{1,100}$/.test(g.required_capability) ||
      !Array.isArray(g.steps) ||
      g.steps.length < 1 ||
      g.steps.length > 8 ||
      !g.steps.every((s) => textBound(s, 1500)) ||
      !textBound(g.decision, 1000) ||
      !textBound(g.effect, 1000) ||
      !Array.isArray(g.tools) ||
      g.tools.length < 1 ||
      g.tools.length > 12 ||
      !g.tools.every((s) => /^api_[a-z_]{1,116}$/.test(s)) ||
      ![g.recovery, g.limits, g.example].every((s) => textBound(s, 1500))
    )
      throw bad();
  }
  return c;
}
export const CompanionGuides = forwardRef<
  GuideActions,
  {
    api: CortexApi;
    domain: string;
    scope?: RecoveryScope;
    onNotice: (s: string) => void;
  }
>(function CompanionGuides({ api, domain, scope, onNotice }, ref) {
  const [catalog, setCatalog] = useState<CompanionWorkflowCatalog>(),
    [selected, setSelected] = useState<CompanionWorkflowGuide>(),
    [capabilities, setCapabilities] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController>(),
    epoch = useRef(0),
    active = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setCatalog(undefined);
    setSelected(undefined);
    setCapabilities([]);
    setMessage("");
    active.current = false;
    setBusy(false);
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [api, domain, scope?.tenant, scope?.subject]);
  useEffect(() => {
    if (selected) heading.current?.focus();
  }, [selected]);
  async function read(value?: string) {
    if (active.current) return "Une lecture des guides est déjà en cours.";
    active.current = true;
    setBusy(true);
    setMessage("");
    setSelected(undefined);
    setCatalog(undefined);
    setCapabilities([]);
    const stamp = epoch.current,
      a = new AbortController();
    controller.current = a;
    const notice = (s: string) => {
      setMessage(s);
      onNotice(s);
      return s;
    };
    try {
      const me = await api.call("identity.read", {}, undefined, {
        signal: a.signal,
      });
      const d = me.domains.find((x) => x.id === domain);
      if (
        (scope &&
          (scope.tenant !== me.tenant_id || scope.subject !== me.subject)) ||
        !d
      )
        throw new ApiError(403, "denied");
      const c = validateGuides(
        await api.call("companion_guides.list", {}, undefined, {
          signal: a.signal,
        }),
      );
      if (a.signal.aborted || stamp !== epoch.current) return "";
      setCatalog(c);
      setCapabilities(d.capabilities);
      if (value) {
        const normalized = value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        const g =
          c.guides.find(
            (x) =>
              x.id === value ||
              x.title
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase() === normalized,
          ) ??
          (/^[1-6]$/.test(value) ? c.guides[Number(value) - 1] : undefined);
        if (!g)
          return notice(
            "Choisissez un guide par son numéro, son identifiant ou son titre exact.",
          );
        setSelected(g);
        return notice(`${g.title} : guide ouvert, aucune action exécutée.`);
      }
      return notice(
        "Six guides de parcours relus. Leur lecture ne lance aucun outil métier.",
      );
    } catch {
      if (stamp !== epoch.current || a.signal.aborted) return "";
      return notice(
        "Guides indisponibles ou contexte changé. Relisez votre connexion ; aucun outil métier n’a été lancé.",
      );
    } finally {
      if (stamp === epoch.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  useImperativeHandle(ref, () => ({
    act: (i) => read(i.kind === "guide_open" ? i.value : undefined),
  }));
  return (
    <section aria-label="Guides pour votre chatbot">
      <p>
        Choisissez ce que vous voulez faire. Votre chatbot peut lire ces mêmes
        guides via MCP ; aucune commande métier n’est exécutée ici.
      </p>
      <button disabled={busy} onClick={() => void read()}>
        Lire les six guides MCP
      </button>
      {busy && (
        <ActivityStatus>Lecture des guides et de vos capacités…</ActivityStatus>
      )}
      {catalog && (
        <>
          <p>
            Documentation {catalog.version} · six parcours. Compatibilité avec
            un client tiers : à qualifier.
          </p>
          <details open={!selected}>
            <summary>
              {selected ? "Choisir un autre parcours" : "Les six parcours"}
            </summary>
            <ul className="companion-guide-choices">
              {catalog.guides.map((g, i) => (
                <li key={g.id}>
                  <button
                    disabled={busy}
                    aria-pressed={selected?.id === g.id}
                    onClick={() => void read(g.id)}
                  >
                    {i + 1}. {g.title}
                  </button>
                  <p>{g.intent}</p>
                </li>
              ))}
            </ul>
          </details>
          {selected && (
            <article aria-label="Guide MCP sélectionné">
              <h3 ref={heading} tabIndex={-1}>
                {selected.title}
              </h3>
              <p>
                {capabilities.includes(selected.required_capability)
                  ? "Capacité annoncée dans votre domaine ; les droits sur chaque objet restent à vérifier."
                  : "Capacité non annoncée dans votre domaine. Vous pouvez lire la procédure, mais ce guide ne vous accorde pas ce droit."}
              </p>
              <h4>Votre décision</h4>
              <p>{selected.decision}</p>
              <h4>Le parcours</h4>
              <ol>
                {selected.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <h4>Effet concret</h4>
              <p>{selected.effect}</p>
              <h4>Suivre et reprendre</h4>
              <p>{selected.recovery}</p>
              <h4>Limites actuelles</h4>
              <p>{selected.limits}</p>
              <h4>Exemple synthétique</h4>
              <p>{selected.example}</p>
              <details>
                <summary>Références pour le client MCP</summary>
                <p>
                  Ressource : <code>cortex://guides/{selected.id}</code>
                </p>
                <p>
                  Prompt : <code>openbrain_workflow</code> avec le domaine
                  retourné par l’identité et <code>guide_id={selected.id}</code>
                  . Il prépare le parcours sous vos capacités actuelles, sans
                  exécuter d’action.
                </p>
                <ul>
                  {selected.tools.map((t) => (
                    <li key={t}>
                      <code>{t}</code>
                    </li>
                  ))}
                </ul>
                <p>
                  Vérifier les schémas avec tools/list ; la présence du guide ne
                  garantit pas qu’un outil est disponible dans cette
                  configuration.
                </p>
              </details>
            </article>
          )}
          <details>
            <summary>Connecter et qualifier son chatbot</summary>
            <ol>
              {catalog.client_requirements.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p>
              Catalogue : <code>cortex://guides</code> ou outil{" "}
              <code>api_companion_guides_list</code>. L’adresse du serveur, son
              exposition réseau et l’authentification dépendent de votre
              installation ; aucune exposition externe n’est créée ici.
            </p>
          </details>
        </>
      )}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Commandes dans notre chat</summary>
        <p>
          Montre les guides MCP · Ouvre le guide MCP : numéro, identifiant ou
          titre exact.
        </p>
      </details>
    </section>
  );
});
