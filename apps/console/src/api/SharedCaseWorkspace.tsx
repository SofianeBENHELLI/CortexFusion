import { usePendingWork } from "./PendingWorkBoundary";
import {
  CaseTasks,
  type CaseTaskActions,
  type CaseTaskIntent,
} from "./CaseTasks";
import { useWorkSelection, workName, resolveWorkName } from "./workSelection";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SharedCase } from "../../../../packages/contracts/src/SharedCase";
import type { SharedCaseContent } from "../../../../packages/contracts/src/SharedCaseContent";
import type { SharedCaseShare } from "../../../../packages/contracts/src/SharedCaseShare";
import type { SharedCaseCommand } from "../../../../packages/contracts/src/SharedCaseCommand";
import type { SharedCasePreparation } from "../../../../packages/contracts/src/SharedCasePreparation";
import { ApiError, type CortexApi } from "./client";
import { ActivityStatus } from "../ActivityStatus";
import {
  caseActions,
  caseStatuses,
  caseTargets,
  qualifications,
  type CaseChatIntent,
} from "./caseCommands";
export interface SharedCaseActions {
  act: (intent: CaseChatIntent) => Promise<string>;
}
type Pending =
  | {
      kind: "share";
      body: SharedCaseShare;
      preparation: SharedCasePreparation;
      expires: number;
    }
  | {
      kind: "command";
      id: string;
      title: string;
      body: SharedCaseCommand;
      expires: number;
    };
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const valid = (s: string, n: number) => !!s.trim() && Array.from(s).length <= n;
const rejected = (e: unknown) =>
  e instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(e.status);
function failure(e: unknown) {
  return e instanceof ApiError && e.status === 409
    ? "Le dossier, les destinataires ou les droits ont changé. Actualisez puis préparez à nouveau."
    : e instanceof ApiError && [401, 403, 404].includes(e.status)
      ? "Dossier inaccessible avec vos droits actuels. Actualisez vos accès."
      : "La lecture a échoué. Recommencez depuis la première page.";
}
export function validateCase(v: SharedCase): SharedCase {
  if (
    !v ||
    !uuid.test(v.id) ||
    !Object.hasOwn(caseStatuses, v.status) ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1 ||
    !Array.isArray(v.allowed_actions) ||
    v.allowed_actions.some((a) => !Object.hasOwn(caseActions, a)) ||
    !Number.isFinite(Date.parse(v.created_at)) ||
    !Number.isFinite(Date.parse(v.updated_at))
  )
    throw new ApiError(200, "invalid_response");
  if (v.audience === "withdrawn") {
    if (
      v.status !== "withdrawn" ||
      v.allowed_actions.length ||
      Object.keys(v).some(
        (k) =>
          ![
            "audience",
            "id",
            "status",
            "revision",
            "created_at",
            "updated_at",
            "allowed_actions",
          ].includes(k),
      )
    )
      throw new ApiError(200, "invalid_response");
  } else if (
    !["declarant", "team"].includes(v.audience) ||
    ![v.title, v.excerpt, v.public_conclusion, v.qualification].every(
      (x) => typeof x === "string",
    ) ||
    !Object.hasOwn(caseTargets, v.target) ||
    !["explicit", "observed", "inferred"].includes(v.origin) ||
    v.policy_version !== "named-excerpt-v1" ||
    (v.audience === "team" &&
      (v.status === "withdrawn" ||
        "personal_signal_id" in v ||
        "recipients" in v)) ||
    (v.audience === "declarant" && !Array.isArray(v.recipients))
  )
    throw new ApiError(200, "invalid_response");
  return v;
}
export const SharedCaseWorkspace = forwardRef<
  SharedCaseActions,
  {
    api: CortexApi;
    domain: string;
    coordinate: boolean;
    canCaseTasks?: boolean;
    onOpenTask?: (id: string) => void;
    onNotice: (text: string) => void;
    routeSelection?: string;
    onSelection?: (id: string, replace?: boolean) => void;
  }
>(function SharedCaseWorkspace(
  {
    api,
    domain,
    coordinate,
    canCaseTasks = false,
    onOpenTask,
    onNotice,
    routeSelection,
    onSelection,
  },
  ref,
) {
  const cache = useQueryClient();
  const caseTasks = useRef<CaseTaskActions>(null);
  const [taskHeld, setTaskHeld] = useState(false);
  const [scope, setScope] = useState<"mine" | "team">(
    coordinate ? "team" : "mine",
  );
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [target, setTarget] =
    useState<SharedCaseContent["target"]>("delivered_answer");
  const [people, setPeople] = useState<string[]>([]);
  const [qualification, setQualification] =
    useState<NonNullable<SharedCaseCommand["qualification"]>>("unclear");
  const [conclusion, setConclusion] = useState("");
  const [pending, setPending] = useState<Pending>();
  const [phase, setPhase] = useState<
    "prepared" | "sending" | "uncertain" | "rejected"
  >("prepared");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const [message, setMessage] = useState("");
  const [denied, setDenied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focus = useRef(routeSelection ?? "");
  const held = phase === "sending" || phase === "uncertain" || taskHeld;
  usePendingWork(
    "Dossier partagé",
    phase === "sending"
      ? "sending"
      : phase === "uncertain"
        ? "uncertain"
        : undefined,
  );
  const [selected, setSelected] = useWorkSelection({
    requested: routeSelection,
    onNavigate: onSelection,
    locked: held || busy,
    onReset: () => {
      setPending(undefined);
      setConclusion("");
      setDenied(false);
      setMessage("");
      focus.current = routeSelection ?? "";
    },
    onBlocked: () =>
      notice(
        "La commande en attente conserve son dossier. Vérifiez son résultat avant de naviguer.",
      ),
  });
  const generation = useRef(0);
  const abort = useRef<AbortController>();
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [api, domain],
  );
  const notice = useCallback(
    (text: string) => {
      setMessage(text);
      onNotice(text);
      return text;
    },
    [onNotice],
  );
  const listKey = ["api", domain, "shared-cases", scope];
  const list = useInfiniteQuery({
    queryKey: listKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const v = await api.call("cases.list", { domain }, undefined, {
        query: { scope, limit: 20, ...(pageParam ? { after: pageParam } : {}) },
        signal,
      });
      if (
        !v ||
        !Array.isArray(v.items) ||
        v.items.length > 50 ||
        !Number.isSafeInteger(v.total) ||
        v.total < v.items.length ||
        v.scope !== scope ||
        !Number.isFinite(Date.parse(v.as_of)) ||
        !Number.isSafeInteger(v.permissions_version) ||
        !Number.isSafeInteger(v.work_version) ||
        v.has_more !== !!v.next_after
      )
        throw new ApiError(200, "invalid_response");
      v.items.forEach(validateCase);
      return v;
    },
    getNextPageParam: (v) => v.next_after ?? undefined,
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const candidates = useInfiniteQuery({
    queryKey: ["api", domain, "case-recipients"],
    enabled: formOpen,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const v = await api.call("cases.recipients", { domain }, undefined, {
        query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
        signal,
      });
      if (
        !v ||
        !Array.isArray(v.items) ||
        v.items.length > 50 ||
        !Number.isSafeInteger(v.total) ||
        v.total < v.items.length ||
        v.items.some(
          (x) =>
            typeof x.subject !== "string" ||
            !["owner", "corpus_manager"].includes(x.role),
        )
      )
        throw new ApiError(200, "invalid_response");
      return v;
    },
    getNextPageParam: (v) => v.next_after ?? undefined,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["api", domain, "shared-case", selected],
    enabled: !!selected,
    queryFn: async ({ signal }) => {
      const value = validateCase(
        await api.call("cases.read", { domain, case_id: selected }, undefined, {
          signal,
        }),
      );
      if (value.id !== selected) throw new ApiError(200, "invalid_response");
      return value;
    },
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const history = useInfiniteQuery({
    queryKey: ["api", domain, "case-events", selected],
    enabled: !!selected,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const v = await api.call(
        "cases.events",
        { domain, case_id: selected },
        undefined,
        {
          query: { limit: 20, ...(pageParam ? { after: pageParam } : {}) },
          signal,
        },
      );
      if (
        !v ||
        v.case_id !== selected ||
        !Array.isArray(v.items) ||
        v.items.length > 50 ||
        v.items.some(
          (x) =>
            !Number.isSafeInteger(x.revision) || typeof x.action !== "string",
        )
      )
        throw new ApiError(200, "invalid_response");
      return v;
    },
    getNextPageParam: (v) => v.next_after ?? undefined,
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const readError =
    denied ||
    list.isError ||
    (!!selected && (detail.isError || history.isError));
  const readable = !readError;
  const current = readable ? detail.data : undefined;
  const items = readable
    ? (list.data?.pages.flatMap((v) => v.items) ?? [])
    : [];
  const namedItems = items.filter(
    (v): v is Exclude<SharedCase, { audience: "withdrawn" }> =>
      v.audience !== "withdrawn",
  );
  const visibleItems = items.filter(
    (v) =>
      !search ||
      (v.audience !== "withdrawn" &&
        workName(v.title).includes(workName(search))),
  );
  useEffect(() => {
    if (focus.current === selected && current) {
      heading.current?.focus();
      focus.current = "";
    }
  }, [current, selected]);
  function select(id: string) {
    if (held || busy)
      return notice(
        "Terminez la reprise de la commande avant de changer de dossier.",
      );
    if (!uuid.test(id)) return notice("Choisissez un dossier partagé valide.");
    setSelected(id);
    setPending(undefined);
    setConclusion("");
    focus.current = id;
    setDenied(false);
    return notice("Lecture du dossier partagé avec vos droits actuels.");
  }
  async function refresh() {
    if (busy) return notice("Une commande est en cours.");
    if (!held) setPending(undefined);
    setDenied(false);
    await Promise.all([
      cache.resetQueries({ queryKey: listKey }),
      selected
        ? cache.resetQueries({
            queryKey: ["api", domain, "shared-case", selected],
          })
        : Promise.resolve(),
      selected
        ? cache.resetQueries({
            queryKey: ["api", domain, "case-events", selected],
          })
        : Promise.resolve(),
    ]);
    return notice(
      "Relecture demandée. Les contenus restent masqués si les droits ne le permettent plus.",
    );
  }
  async function guarded(work: (signal: AbortSignal) => Promise<string>) {
    if (active.current) return "Une commande est déjà en cours.";
    active.current = true;
    setBusy(true);
    const seq = generation.current;
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const result = await work(ctrl.signal);
      return seq === generation.current ? notice(result) : "Contexte fermé.";
    } catch (e) {
      if (seq !== generation.current) return "Contexte fermé.";
      if (e instanceof ApiError && [401, 403, 404].includes(e.status))
        setDenied(true);
      return notice(failure(e));
    } finally {
      active.current = false;
      if (seq === generation.current) setBusy(false);
    }
  }
  async function prepare(content: SharedCaseContent) {
    if (held)
      return notice(
        "La commande précédente attend son résultat. Réessayez exactement le même envoi.",
      );
    if (
      !valid(content.title, 200) ||
      !valid(content.excerpt, 2000) ||
      !content.recipients.length ||
      content.recipients.length > 20
    )
      return notice(
        "Renseignez un titre, un extrait de 2 000 caractères au plus et 1 à 20 destinataires.",
      );
    return guarded(async (signal) => {
      const p = await api.call("cases.prepare", { domain }, content, {
        signal,
      });
      if (
        !p ||
        !uuid.test(p.preparation_id) ||
        !Number.isFinite(Date.parse(p.expires_at)) ||
        p.policy_version !== "named-excerpt-v1"
      )
        throw new ApiError(200, "invalid_response");
      setPending({
        kind: "share",
        body: {
          content,
          preparation_id: p.preparation_id,
          idempotency_key: crypto.randomUUID(),
        },
        preparation: p,
        expires: Date.parse(p.expires_at),
      });
      setPhase("prepared");
      setDenied(false);
      return "Partage préparé. Vérifiez l’extrait et les destinataires avant de confirmer le partage.";
    });
  }
  async function prepareCommand(
    intent: Extract<CaseChatIntent, { kind: "case_action" }>,
  ) {
    if (held)
      return notice(
        "Réessayez la même commande avant d’en préparer une autre.",
      );
    if (!selected) return notice("Choisissez d’abord un dossier partagé.");
    return guarded(async (signal) => {
      const fresh = validateCase(
        await api.call("cases.read", { domain, case_id: selected }, undefined, {
          signal,
        }),
      );
      cache.setQueryData(["api", domain, "shared-case", selected], fresh);
      if (!(fresh.allowed_actions as readonly string[]).includes(intent.action))
        return "Cette action n’est pas disponible pour ce dossier et vos droits actuels.";
      if (intent.action === "qualify" && !intent.qualification)
        return "Choisissez une qualification : incorrect, manquant, périmé, ambigu, comportement ou autre.";
      if (
        ["close_without_change", "reopen"].includes(intent.action) &&
        !valid(intent.public_conclusion ?? "", 2000)
      )
        return "Rédigez la conclusion qui sera visible par le déclarant (2 000 caractères au plus).";
      const body: SharedCaseCommand = {
        action: intent.action,
        expected_revision: fresh.revision,
        idempotency_key: crypto.randomUUID(),
        ...(intent.qualification
          ? { qualification: intent.qualification }
          : {}),
        ...(intent.public_conclusion
          ? { public_conclusion: intent.public_conclusion }
          : {}),
      };
      setPending({
        kind: "command",
        id: selected,
        title: fresh.audience === "withdrawn" ? "Partage retiré" : fresh.title,
        body,
        expires: Date.now() + 300000,
      });
      setPhase("prepared");
      return `${caseActions[intent.action]} : décision préparée sur la révision ${fresh.revision}. Confirmez le dossier.`;
    });
  }
  async function confirm(sharing: boolean) {
    if (!pending || sharing !== (pending.kind === "share"))
      return notice(
        sharing
          ? "Aucun partage à confirmer. Préparez l’extrait et ses destinataires."
          : "Aucune décision de dossier à confirmer.",
      );
    if (phase === "rejected")
      return notice("Préparez à nouveau après le refus du serveur.");
    if (phase !== "uncertain" && pending.expires <= Date.now()) {
      setPending(undefined);
      return notice("La préparation a expiré. Relisez et préparez à nouveau.");
    }
    if (readError)
      return notice("Actualisez vos accès avant de confirmer ce dossier.");
    const p = pending;
    return guarded(async (signal) => {
      setPhase("sending");
      let receipt;
      try {
        receipt =
          p.kind === "share"
            ? await api.call("cases.share", { domain }, p.body, { signal })
            : await api.call(
                "cases.command",
                { domain, case_id: p.id },
                p.body,
                { signal },
              );
        if (
          !receipt ||
          !uuid.test(receipt.case_id) ||
          !uuid.test(receipt.event_id) ||
          !Number.isSafeInteger(receipt.revision) ||
          receipt.revision < 1 ||
          !Object.hasOwn(caseStatuses, receipt.status)
        )
          throw new ApiError(200, "invalid_response");
      } catch (e) {
        if (!signal.aborted) setPhase(rejected(e) ? "rejected" : "uncertain");
        if (rejected(e)) throw e;
        return "Résultat inconnu. Aucun autre envoi : réessayez la même commande avec sa clé conservée.";
      }
      setPending(undefined);
      setPhase("prepared");
      setSelected(receipt.case_id);
      focus.current = receipt.case_id;
      if (p.kind === "share") {
        setScope("mine");
        setFormOpen(false);
        setTitle("");
        setExcerpt("");
        setPeople([]);
      }
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["api", "work-overview", domain] }),
        cache.resetQueries({ queryKey: ["api", domain, "shared-cases"] }),
        cache.invalidateQueries({ queryKey: ["api", domain, "shared-case"] }),
        cache.resetQueries({ queryKey: ["api", domain, "case-events"] }),
      ]);
      return `Dossier enregistré · ${caseStatuses[receipt.status]} · révision ${receipt.revision} · reçu ${receipt.event_id}. Aucun savoir publié.`;
    });
  }
  function cancel() {
    if (held)
      return notice(
        "Résultat inconnu : conservez la commande pour une reprise exacte.",
      );
    setPending(undefined);
    return notice("Projet fermé. Aucun nouvel envoi.");
  }
  useImperativeHandle(ref, () => ({
    act: async (intent) => {
      if (intent.kind.startsWith("case_tasks_"))
        return (
          caseTasks.current?.act(intent as CaseTaskIntent) ??
          notice("Ouvrez un dossier pour lire ou associer son travail.")
        );
      switch (intent.kind) {
        case "case_list":
          if (intent.scope === "team" && !coordinate)
            return notice(
              "La file d’équipe est réservée aux coordinateurs destinataires.",
            );
          if (held) return notice("Reprenez d’abord la commande en attente.");
          setScope(intent.scope);
          setSelected("");
          setPending(undefined);
          return notice(
            intent.scope === "mine"
              ? "Vos partages et leur suivi sont ouverts."
              : "Les dossiers explicitement partagés avec vous sont ouverts.",
          );
        case "case_select": {
          if (held || busy)
            return notice("Reprenez d’abord la commande en attente.");
          const match = resolveWorkName(intent.id, namedItems);
          if (match.id) return select(match.id);
          setSelected("");
          setPending(undefined);
          setSearch(intent.id);
          return notice(
            match.ambiguous
              ? "Plusieurs dossiers portent ce nom. Choisissez la bonne ligne."
              : "Recherche dans les dossiers chargés. Affinez le nom ou chargez la suite ; les autres pages ne sont pas recherchées.",
          );
        }
        case "case_prepare":
          setFormOpen(true);
          setTitle(intent.title);
          setExcerpt(intent.excerpt);
          setPeople(intent.recipients);
          setTarget(intent.target);
          return prepare({
            title: intent.title,
            excerpt: intent.excerpt,
            target: intent.target,
            recipients: intent.recipients as SharedCaseContent["recipients"],
            policy_version: "named-excerpt-v1",
          });
        case "case_action":
          return prepareCommand(intent);
        case "case_confirm":
          return confirm(intent.sharing);
        case "case_cancel":
          return cancel();
        default:
          return notice("Commande de dossier indisponible.");
      }
    },
  }));
  return (
    <section className="shared-cases" aria-label="Dossiers partagés">
      <p>
        Partagez uniquement un extrait choisi. Votre conversation et vos
        signalements personnels restent privés.
      </p>
      <label>
        File de dossiers
        <select
          value={scope}
          disabled={busy || held}
          onChange={(e) => {
            setScope(e.target.value as "mine" | "team");
            setSelected("");
            setPending(undefined);
          }}
        >
          <option value="mine">Mes partages</option>
          {coordinate && <option value="team">Partagés avec moi</option>}
        </select>
      </label>
      <button disabled={busy} onClick={() => void refresh()}>
        Actualiser les dossiers
      </button>
      {(list.isPending ||
        (!!selected && (detail.isPending || history.isPending))) && (
        <ActivityStatus>Lecture des dossiers autorisés…</ActivityStatus>
      )}
      {readError ? (
        <p role="alert">
          {failure(list.error ?? detail.error ?? history.error)}
        </p>
      ) : (
        <>
          {list.data && (
            <p>
              {items.length} dossiers chargés sur {list.data.pages[0].total}{" "}
              dans cette file. Lecture du{" "}
              {new Date(list.data.pages[0].as_of).toLocaleString()}.
            </p>
          )}
          <label>
            Rechercher dans les dossiers chargés
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={busy || held}
            />
          </label>
          {search && (
            <p>
              {visibleItems.length} correspondances parmi {items.length}{" "}
              dossiers chargés. Les autres pages ne sont pas recherchées.
            </p>
          )}
          <ul
            className="task-list work-list-bounded"
            tabIndex={0}
            aria-label="Dossiers chargés"
          >
            {visibleItems.map((v) => (
              <li key={v.id}>
                <button disabled={busy || held} onClick={() => select(v.id)}>
                  {v.audience === "withdrawn"
                    ? "Extrait retiré par son auteur"
                    : v.title}
                  <small>
                    {caseStatuses[v.status]} · {v.id.slice(0, 8)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <button
              disabled={list.isFetchingNextPage || busy || held}
              onClick={() => void list.fetchNextPage()}
            >
              Dossiers suivants
            </button>
          )}
        </>
      )}
      <details
        open={formOpen}
        onToggle={(e) => setFormOpen(e.currentTarget.open)}
      >
        <summary>Créer un dossier partagé</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void prepare({
              title,
              excerpt,
              target,
              recipients: people as SharedCaseContent["recipients"],
              policy_version: "named-excerpt-v1",
            });
          }}
        >
          <label>
            Titre du dossier
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy || held}
            />
          </label>
          <label>
            Extrait à partager
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              disabled={busy || held}
            />
          </label>
          <p>
            Rédigez le minimum utile. Aucun texte de votre conversation n’est
            ajouté automatiquement. 2 000 caractères au plus.
          </p>
          <label>
            Ce retour concerne
            <select
              value={target}
              onChange={(e) =>
                setTarget(e.target.value as SharedCaseContent["target"])
              }
              disabled={busy || held}
            >
              {Object.entries(caseTargets).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={busy || held}>
            <legend>Destinataires nommés</legend>
            {candidates.isPending && formOpen && (
              <ActivityStatus>
                Lecture des coordinateurs actuels…
              </ActivityStatus>
            )}
            {candidates.isError ? (
              <>
                <p role="alert">Impossible de vérifier les destinataires.</p>
                <button
                  type="button"
                  onClick={() =>
                    void cache.resetQueries({
                      queryKey: ["api", domain, "case-recipients"],
                    })
                  }
                >
                  Relire les destinataires
                </button>
              </>
            ) : (
              candidates.data?.pages
                .flatMap((p) => p.items)
                .map((v) => (
                  <label className="case-recipient" key={v.subject}>
                    <input
                      type="checkbox"
                      checked={people.includes(v.subject)}
                      onChange={(e) =>
                        setPeople((old) =>
                          e.target.checked
                            ? [...old, v.subject]
                            : old.filter((x) => x !== v.subject),
                        )
                      }
                    />
                    {v.subject} ·{" "}
                    {v.role === "owner"
                      ? "Responsable de domaine"
                      : "Responsable de corpus"}
                  </label>
                ))
            )}
            {candidates.hasNextPage && (
              <button
                type="button"
                onClick={() => void candidates.fetchNextPage()}
              >
                Destinataires suivants
              </button>
            )}
            {candidates.data?.pages[0].total === 0 && (
              <p>Aucun autre coordinateur n’est disponible dans ce domaine.</p>
            )}
          </fieldset>
          <button disabled={busy || held || candidates.isError}>
            Préparer le partage
          </button>
        </form>
      </details>
      {canCaseTasks && selected && detail.data && (
        <CaseTasks
          key={selected}
          ref={caseTasks}
          api={api}
          domain={domain}
          caseId={selected}
          caseTitle={
            current && current.audience !== "withdrawn"
              ? current.title
              : undefined
          }
          blocked={busy || phase === "uncertain"}
          accessDenied={!!readError || current?.audience === "withdrawn"}
          onHold={setTaskHeld}
          onNotice={notice}
          onDenied={() => setDenied(true)}
          onOpenTask={onOpenTask}
        />
      )}
      {current && (
        <article className="case-detail">
          <h3 ref={heading} tabIndex={-1}>
            {current.audience === "withdrawn"
              ? "Partage retiré"
              : current.title}
          </h3>
          <p>
            {caseStatuses[current.status]} · révision {current.revision} · créé
            le {new Date(current.created_at).toLocaleString()}
          </p>
          {current.audience === "withdrawn" ? (
            <p>
              Le contenu a été retiré par son auteur. Seule la trace de suivi
              reste visible.
            </p>
          ) : (
            <>
              <p>
                {caseTargets[current.target]} · origine{" "}
                {current.origin === "explicit"
                  ? "explicite"
                  : current.origin === "observed"
                    ? "observée"
                    : "inférée"}
              </p>
              <p className="case-excerpt">{current.excerpt}</p>
              {current.audience === "declarant" ? (
                <p>
                  Destinataires consentis : {current.recipients.join(", ")}.{" "}
                  {current.status === "withdrawn" &&
                    "Votre texte reste personnel ; il n’est plus lisible par l’équipe."}
                </p>
              ) : (
                <p>
                  Déclarant : {current.declarant}. Ce dossier n’accorde aucun
                  accès à sa conversation.
                </p>
              )}
              {current.qualification !== "unclassified" && (
                <p>
                  Qualification :{" "}
                  {qualifications[
                    current.qualification as keyof typeof qualifications
                  ] ?? current.qualification}
                </p>
              )}
              {current.public_conclusion && (
                <div>
                  <h4>Conclusion visible par le déclarant</h4>
                  <p>{current.public_conclusion}</p>
                </div>
              )}
            </>
          )}
          {(current.allowed_actions as readonly string[]).includes(
            "qualify",
          ) && (
            <label>
              Qualification
              <select
                value={qualification}
                onChange={(e) =>
                  setQualification(e.target.value as typeof qualification)
                }
              >
                {Object.entries(qualifications).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {((current.allowed_actions as readonly string[]).includes(
            "close_without_change",
          ) ||
            (current.allowed_actions as readonly string[]).includes(
              "reopen",
            )) && (
            <label>
              Conclusion destinée au déclarant
              <textarea
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value)}
              />
            </label>
          )}
          <div className="action-row">
            {current.allowed_actions.map((action) => (
              <button
                key={action}
                disabled={busy || held}
                onClick={() =>
                  void prepareCommand({
                    kind: "case_action",
                    action,
                    ...(action === "qualify" ? { qualification } : {}),
                    ...(["close_without_change", "reopen"].includes(action)
                      ? { public_conclusion: conclusion }
                      : {}),
                  })
                }
              >
                {caseActions[action]}
              </button>
            ))}
          </div>
          <details>
            <summary>Historique minimal du dossier</summary>
            <ol>
              {history.data?.pages
                .flatMap((p) => p.items)
                .map((e) => (
                  <li key={e.id}>
                    Révision {e.revision} · {caseStatuses[e.status]} ·{" "}
                    {e.action === "link_task"
                      ? "Tâche associée"
                      : e.action === "unlink_task"
                        ? "Association retirée"
                        : "Mise à jour du dossier"}{" "}
                    · {new Date(e.created_at).toLocaleString()}
                  </li>
                ))}
            </ol>
            {history.hasNextPage && (
              <button onClick={() => void history.fetchNextPage()}>
                Événements suivants
              </button>
            )}
          </details>
        </article>
      )}
      {pending && readable && (
        <section
          className="prepared-command"
          aria-label="Confirmation du dossier"
        >
          <h3>
            {pending.kind === "share"
              ? "Vérifier le partage"
              : caseActions[pending.body.action]}
          </h3>
          {pending.kind === "share" ? (
            <>
              <strong>{pending.body.content.title}</strong>
              <p className="case-excerpt">{pending.body.content.excerpt}</p>
              <p>
                {caseTargets[pending.body.content.target]} ·{" "}
                {pending.preparation.origin}
              </p>
              <p>Uniquement : {pending.body.content.recipients.join(", ")}.</p>
              <p>
                Votre identité est visible des destinataires. Ils doivent
                toujours être coordinateurs pour relire l’extrait. Aucun accès à
                votre conversation.
              </p>
              <p>
                Vous pouvez retirer le partage. Le texte reste dans votre suivi
                personnel ; aucune purge automatique n’est promise et les
                lectures déjà effectuées ne peuvent être effacées.
              </p>
            </>
          ) : (
            <>
              <p>
                {pending.title} · révision {pending.body.expected_revision}
              </p>
              {pending.body.qualification && (
                <p>{qualifications[pending.body.qualification]}</p>
              )}
              {pending.body.public_conclusion && (
                <p>{pending.body.public_conclusion}</p>
              )}
              {pending.body.action === "withdraw" && (
                <p>
                  Le titre, l’extrait et la conclusion deviennent invisibles
                  pour l’équipe. Votre suivi personnel et les traces minimales
                  sont conservés.
                </p>
              )}
            </>
          )}
          <p>
            Préparation valable jusqu’à{" "}
            {new Date(pending.expires).toLocaleTimeString()}. Une clôture ne
            corrige et ne publie aucun savoir.
          </p>
          <button
            disabled={busy || phase === "rejected"}
            onClick={() => void confirm(pending.kind === "share")}
          >
            {phase === "uncertain"
              ? "Réessayer la même commande de dossier"
              : pending.kind === "share"
                ? "Confirmer le partage"
                : "Confirmer le dossier"}
          </button>
          <button disabled={held || busy} onClick={cancel}>
            Annuler le projet de dossier
          </button>
        </section>
      )}
      {busy && <ActivityStatus>Vérification de votre action…</ActivityStatus>}
      {message && (
        <p role="status">
          {readable
            ? message
            : "Dossier inaccessible : actualisez vos accès avant de poursuivre."}
        </p>
      )}
    </section>
  );
});
