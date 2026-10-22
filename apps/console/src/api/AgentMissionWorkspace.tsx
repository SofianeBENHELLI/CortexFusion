import type { AgentMissionEvidence } from "../../../../packages/contracts/src/AgentMissionEvidence";
import type { AgentMissionControl } from "../../../../packages/contracts/src/AgentMissionControl";
import type { AgentMissionControlPage } from "../../../../packages/contracts/src/AgentMissionControlPage";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { AgentMissionDetail } from "../../../../packages/contracts/src/AgentMissionDetail";
import type { AgentMissionMandate } from "../../../../packages/contracts/src/AgentMissionMandate";
import type { AgentMissionPreparation } from "../../../../packages/contracts/src/AgentMissionPreparation";
import type { AgentMissionPage } from "../../../../packages/contracts/src/AgentMissionPage";
import type { AgentMissionCandidatePage } from "../../../../packages/contracts/src/AgentMissionCandidatePage";
import type { AgentMissionEventPage } from "../../../../packages/contracts/src/AgentMissionEventPage";
import type { AgentMissionCreate } from "../../../../packages/contracts/src/AgentMissionCreate";
import type { AgentMissionCommand } from "../../../../packages/contracts/src/AgentMissionCommand";
import type { AgentMissionReceipt } from "../../../../packages/contracts/src/AgentMissionReceipt";
import { ApiError, type CortexApi } from "./client";
import { readSourcePage } from "./sourcePassage";
import { ActivityStatus } from "../ActivityStatus";
import { SourcePicker, type SourcePickerHandle } from "./SourcePicker";
import { usePendingWork } from "./PendingWorkBoundary";
import { workId } from "./workSelection";
import type { MissionIntent, MissionField } from "./missionCommands";
import {
  readMissionRecovery,
  rememberMissionRecovery,
  forgetMissionRecovery,
  type RecoveryScope,
  type MissionRecoveryEntry,
} from "./missionRecoveryStore";
import {
  missionLabels,
  invalidMission,
  whole,
  textBound,
  dateValid,
  validMandate,
  sameMandate,
  validateMissionEvidence,
  validateMissionControl,
  validateMission,
  validateMissionReceipt,
} from "./missionValidation";
export type MissionActions = {
  act: (intent: MissionIntent) => Promise<string>;
};
type Pending =
  | {
      kind: "create";
      body: AgentMissionCreate;
      preview: AgentMissionPreparation;
    }
  | {
      kind: "command";
      mission: AgentMissionDetail | AgentMissionControl;
      body: AgentMissionCommand;
    };
const defaults = () => ({
  title: "",
  objective: "",
  criteria: "",
  max_reads: "10",
  max_chars: "20000",
  minutes: "60",
  reason: "",
});
export const AgentMissionWorkspace = forwardRef<
  MissionActions,
  {
    api: CortexApi;
    domain: string;
    onNotice: (s: string) => void;
    onChanged?: () => void;
    recoveryScope?: RecoveryScope;
    canCoordinate: boolean;
  }
>(function AgentMissionWorkspace(
  { api, domain, onNotice, recoveryScope, canCoordinate, onChanged },
  ref,
) {
  const [controlPage, setControlPage] = useState<AgentMissionControlPage>(),
    [control, setControl] = useState<AgentMissionControl>();
  const [evidence, setEvidence] = useState<AgentMissionEvidence>();
  const evidenceFocus = useRef<HTMLElement>(null);
  useEffect(() => {
    if (evidence) evidenceFocus.current?.focus();
  }, [evidence]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(defaults),
    [source, setSource] = useState<{
      id: string;
      title: string;
      hash: string;
    }>(),
    [agent, setAgent] = useState("");
  const [candidates, setCandidates] = useState<AgentMissionCandidatePage>(),
    [page, setPage] = useState<AgentMissionPage>(),
    [current, setCurrent] = useState<AgentMissionDetail>(),
    [events, setEvents] = useState<AgentMissionEventPage>();
  const [pending, setPending] = useState<Pending>(),
    [unknown, setUnknown] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [phase, setPhase] = useState("Lecture des accès et du mandat");
  const picker = useRef<SourcePickerHandle>(null),
    focus = useRef<HTMLElement>(null),
    previewFocus = useRef<HTMLElement>(null),
    historyFocus = useRef<HTMLElement>(null),
    active = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController>(),
    target = useRef<MissionRecoveryEntry>();
  const recovery = recoveryScope
    ? readMissionRecovery(recoveryScope)
    : undefined;
  const recovered = recovery?.entries.filter((e) => e.domain === domain) ?? [];
  const unresolved = unknown || recovered.length > 0;
  const dirty = !!(
    form.title ||
    form.objective ||
    form.criteria ||
    form.reason ||
    source ||
    agent ||
    form.max_reads !== "10" ||
    form.max_chars !== "20000" ||
    form.minutes !== "60"
  );
  usePendingWork(
    "Mission d’agent",
    busy && pending
      ? "sending"
      : unresolved
        ? "uncertain"
        : dirty || pending
          ? "draft"
          : undefined,
  );
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
    },
    [api, domain],
  );
  useEffect(() => {
    setEvidence(undefined);
    if (current) focus.current?.focus();
  }, [current]);
  useEffect(() => {
    if (pending) previewFocus.current?.focus();
  }, [pending]);
  useEffect(() => {
    if (events) historyFocus.current?.focus();
  }, [events]);
  function notice(s: string) {
    setMessage(s);
    onNotice(s);
    return s;
  }
  function resetForm() {
    setShowNew(false);
    setForm(defaults());
    setSource(undefined);
    setAgent("");
    setCandidates(undefined);
    picker.current?.clear();
  }
  function clearContent() {
    setEvidence(undefined);
    setControlPage(undefined);
    setControl(undefined);
    resetForm();
    setPage(undefined);
    setCurrent(undefined);
    setEvents(undefined);
    setPending(undefined);
  }
  function guard(replace = false) {
    if (unresolved)
      throw Error(
        "Résultat inconnu : vérifiez le reçu avant une autre action.",
      );
    if (pending) throw Error("Confirmez ou annulez la préparation visible.");
    if (replace && dirty)
      throw Error(
        "Votre projet ou motif non envoyé est conservé. Effacez-le explicitement avant de changer de mission.",
      );
  }
  async function identity(signal: AbortSignal, coordinate = false) {
    const me = await api.call("identity.read", {}, undefined, { signal });
    if (
      (recoveryScope &&
        (me.tenant_id !== recoveryScope.tenant ||
          me.subject !== recoveryScope.subject)) ||
      !me.domains.some(
        (d) =>
          d.id === domain &&
          d.capabilities.includes(
            coordinate ? "coordinate_missions" : "agent_missions",
          ),
      )
    )
      throw new ApiError(403, "denied");
  }
  async function run(
    fn: (s: AbortSignal) => Promise<string>,
    label = "Lecture des accès et du mandat",
    failureMessage = "Lecture refusée ou indisponible. Un reçu absent ne prouve pas un échec.",
  ) {
    if (active.current) return "Une opération de mission est déjà en cours.";
    active.current = true;
    setBusy(true);
    setMessage("");
    setPhase(label);
    const e = epoch.current,
      a = new AbortController();
    controller.current = a;
    try {
      const s = await fn(a.signal);
      return e === epoch.current ? notice(s) : "";
    } catch (error) {
      if (e !== epoch.current) return "";
      if (error instanceof ApiError && [401, 403, 404].includes(error.status))
        clearContent();
      return notice(
        error instanceof ApiError
          ? error.status === 409
            ? "La mission, la source ou les droits ont changé. Relisez avant de préparer une nouvelle action."
            : failureMessage
          : error instanceof Error
            ? error.message
            : "Opération indisponible.",
      );
    } finally {
      if (e === epoch.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  function field(key: MissionField, value: string) {
    if (active.current || pending || unresolved)
      return notice(
        "Terminez la commande en cours avant de modifier le projet.",
      );
    if (!canCoordinate)
      return notice(
        "La coordination de missions n’est pas disponible avec vos accès.",
      );
    if (key !== "reason") setShowNew(true);
    setForm((f) => ({ ...f, [key]: value }));
    return notice("Saisie locale mise à jour. Rien n’a été envoyé.");
  }
  async function chooseSource(id: string) {
    return run(
      async (signal) => {
        guard();
        await identity(signal, true);
        if (!workId(id)) throw Error("Choisissez une source de la liste.");
        setSource(undefined);
        // Selecting a source needs fresh identity/hash, not its whole body.
        // Reuse the strict bounded passage contract; agent reads are separate.
        const s = await readSourcePage(
          api,
          domain,
          id,
          signal,
          0,
          undefined,
          1,
        );
        if (signal.aborted) return "";
        setSource({ id: s.source_id, title: s.title, hash: s.content_hash });
        return "Source choisie. Les droits du service seront vérifiés à la préparation.";
      },
      "Vérification de la source de mission",
      "Impossible de vérifier cette source. Recherchez une source accessible puis réessayez.",
    );
  }
  async function agents(next = false) {
    return run(async (signal) => {
      guard();
      const after = next ? candidates?.next_after : undefined;
      if (next && !after) throw Error("Aucune page suivante de services.");
      setCandidates(undefined);
      await identity(signal, true);
      const p = await api.call(
        "agent_missions.candidates",
        { domain },
        undefined,
        { signal, query: { limit: 20, ...(after ? { after } : {}) } },
      );
      if (
        !p ||
        !Array.isArray(p.items) ||
        p.items.length > 20 ||
        p.items.some((x) => !x || !textBound(x.subject, 200)) ||
        new Set(p.items.map((x) => x.subject)).size !== p.items.length ||
        !(
          p.next_after === null ||
          (p.items.length > 0 &&
            p.next_after === p.items[p.items.length - 1].subject)
        )
      )
        throw invalidMission();
      if (signal.aborted) return "";
      setShowNew(true);
      setCandidates(p);
      return `${p.items.length} services nommés affichés. Aucun droit supplémentaire ne leur sera donné.`;
    });
  }
  async function list(next = false) {
    return run(async (signal) => {
      guard(true);
      const after = next ? page?.next_after : undefined;
      if (next && !after) throw Error("Aucune page suivante de missions.");
      setPage(undefined);
      setControl(undefined);
      setCurrent(undefined);
      setEvents(undefined);
      await identity(signal);
      const p = await api.call("agent_missions.list", { domain }, undefined, {
        signal,
        query: { limit: 20, ...(after ? { after } : {}) },
      });
      if (
        !p ||
        !Array.isArray(p.items) ||
        p.items.length > 20 ||
        !(
          p.next_after === null ||
          (p.items.length > 0 &&
            p.next_after === p.items[p.items.length - 1].id)
        )
      )
        throw invalidMission();
      if (
        p.items.some(
          (v) =>
            !v ||
            !workId(v.id) ||
            !textBound(v.title, 200) ||
            !textBound(v.author, 200) ||
            !textBound(v.agent, 200) ||
            !Object.hasOwn(missionLabels, v.status) ||
            !whole(v.revision, 1) ||
            !whole(v.max_reads, 1, 100) ||
            !whole(v.max_chars, 1, 100000) ||
            !whole(v.reads_used, 0, v.max_reads) ||
            !whole(v.chars_used, 0, v.max_chars) ||
            !dateValid(v.expires_at) ||
            typeof v.expired !== "boolean" ||
            typeof v.lease_expired !== "boolean",
        )
      )
        throw invalidMission();
      if (new Set(p.items.map((x) => x.id)).size !== p.items.length)
        throw invalidMission();
      if (signal.aborted) return "";
      setPage(p);
      return `${p.items.length} missions accessibles affichées${p.next_after ? " ; une autre page est disponible" : ""}.`;
    });
  }
  async function open(value: string) {
    return run(async (signal) => {
      guard(true);
      const id = workId(value) ? value : page?.items[Number(value) - 1]?.id;
      if (!id)
        throw Error("Choisissez une mission par son numéro ou identifiant.");
      setControl(undefined);
      setCurrent(undefined);
      setEvents(undefined);
      await identity(signal);
      const v = validateMission(
        await api.call(
          "agent_missions.read",
          { domain, mission: id },
          undefined,
          { signal },
        ),
      );
      if (v.id !== id) throw invalidMission();
      if (signal.aborted) return "";
      setCurrent(v);
      return "Mandat et consommation relus. Aucun service n’a été lancé par cette lecture.";
    });
  }
  async function readControls(next = false) {
    return run(async (signal) => {
      guard(true);
      const after = next ? controlPage?.next_after : undefined;
      if (next && !after) throw Error("Aucune page suivante de contrôles.");
      setControlPage(undefined);
      setControl(undefined);
      setCurrent(undefined);
      setPage(undefined);
      setEvents(undefined);
      await identity(signal, true);
      const p = await api.call(
        "agent_missions.controls",
        { domain },
        undefined,
        { signal, query: { limit: 20, ...(after ? { after } : {}) } },
      );
      if (
        !p ||
        !Array.isArray(p.items) ||
        p.items.length > 20 ||
        !(
          p.next_after === null ||
          (p.items.length > 0 && p.next_after === p.items.at(-1)?.id)
        )
      )
        throw invalidMission();
      p.items.forEach(validateMissionControl);
      if (new Set(p.items.map((x) => x.id)).size !== p.items.length)
        throw invalidMission();
      if (signal.aborted) return "";
      setControlPage(p);
      return `${p.items.length} contrôles personnels affichés, sans contenu. Seul l’arrêt peut être préparé ici.`;
    });
  }
  async function openControl(value: string) {
    return run(async (signal) => {
      guard(true);
      const id = workId(value)
        ? value
        : controlPage?.items[Number(value) - 1]?.id;
      if (!id)
        throw Error("Choisissez un contrôle par son numéro ou identifiant.");
      setControl(undefined);
      setCurrent(undefined);
      setPage(undefined);
      setEvents(undefined);
      await identity(signal, true);
      const c = validateMissionControl(
        await api.call(
          "agent_missions.control",
          { domain, mission: id },
          undefined,
          { signal },
        ),
      );
      if (c.id !== id) throw invalidMission();
      if (signal.aborted) return "";
      setControl(c);
      return "État de contrôle relu. Aucun contenu du mandat ou de la source n’est exposé.";
    });
  }
  async function history(next = false) {
    return run(async (signal) => {
      guard();
      if (!current) throw Error("Ouvrez d’abord une mission.");
      const after = next ? events?.next_after : undefined,
        previous = next ? events?.items.at(-1)?.revision : 0;
      if (next && !after) throw Error("Aucune page suivante du journal.");
      setEvents(undefined);
      await identity(signal);
      const h = await api.call(
        "agent_missions.events",
        { domain, mission: current.id },
        undefined,
        { signal, query: { limit: 20, ...(after ? { after } : {}) } },
      );
      if (
        !h ||
        h.mission_id !== current.id ||
        !whole(h.current_revision, 1) ||
        h.current_revision < current.revision ||
        !Array.isArray(h.items) ||
        h.items.length > 20 ||
        h.items.some(
          (e, i) =>
            !e ||
            !workId(e.id) ||
            !textBound(e.actor, 200) ||
            ![
              "create",
              "claim",
              "renew",
              "stop",
              "resume",
              "read",
              "complete",
            ].includes(e.action) ||
            !Object.hasOwn(missionLabels, e.status) ||
            e.revision !== (previous ?? 0) + i + 1 ||
            e.revision > h.current_revision ||
            !whole(e.reads_used, 0, 100) ||
            !whole(e.chars_used, 0, 100000) ||
            !dateValid(e.created_at) ||
            !textBound(e.reason, 2000, 0) ||
            !(e.start === null || whole(e.start)) ||
            !(e.end === null || whole(e.end, (e.start ?? 0) + 1)),
        ) ||
        !(
          h.next_after === null ||
          (h.items.length > 0 && h.next_after === h.items.at(-1)?.id)
        )
      )
        throw invalidMission();
      if (signal.aborted) return "";
      setEvents(h);
      return "Événements relus. Ils attestent les commandes, pas la qualité des conclusions.";
    });
  }
  async function prepare() {
    return run(async (signal) => {
      guard();
      await identity(signal, true);
      const minutes = Number(form.minutes);
      if (!whole(minutes, 1, 1440) || !source || !agent)
        throw Error(
          "Choisissez la source, le service et une durée de 1 à 1440 minutes.",
        );
      const m: AgentMissionMandate = {
        title: form.title,
        objective: form.objective,
        criteria: form.criteria,
        agent,
        source_id: source.id,
        source_hash: source.hash,
        max_reads: Number(form.max_reads),
        max_chars: Number(form.max_chars),
        expires_at: new Date(Date.now() + minutes * 60000).toISOString(),
      };
      if (!validMandate(m))
        throw Error(
          "Renseignez titre, objectif, critères, 1–100 lectures et 1–100000 caractères.",
        );
      const p = await api.call("agent_missions.prepare", { domain }, m, {
        signal,
      });
      if (
        !p ||
        !workId(p.preparation_id) ||
        !validMandate(p.mandate) ||
        !sameMandate(m, p.mandate) ||
        !dateValid(p.expires_at) ||
        Date.parse(p.expires_at) <= Date.now() ||
        p.provider !== "none" ||
        p.execution !== "client_managed" ||
        !p.source ||
        p.source.id !== source.id ||
        p.source.content_hash !== source.hash ||
        typeof p.source.title !== "string" ||
        !whole(p.source.characters)
      )
        throw invalidMission();
      if (signal.aborted) return "";
      setPending({
        kind: "create",
        body: {
          mandate: p.mandate,
          preparation_id: p.preparation_id,
          idempotency_key: crypto.randomUUID(),
        },
        preview: p,
      });
      return "Mandat prêt à confirmer. Aucun service ni modèle n’est démarré.";
    }, "Vérification de la source et du service");
  }
  async function readEvidence(value: string) {
    return run(
      async (signal) => {
        guard();
        setEvidence(undefined);
        if (
          !canCoordinate ||
          !current ||
          current.status !== "completed" ||
          !/^(?:[1-9]|10)$/.test(value) ||
          !current.evidence[Number(value) - 1]
        )
          throw Error(
            "Ouvrez votre rapport terminé et choisissez un passage cité par son numéro.",
          );
        await identity(signal, true);
        const v = validateMissionEvidence(
          await api.call(
            "agent_missions.evidence",
            { domain, mission: current.id, index: value },
            undefined,
            { signal, query: { expected_revision: current.revision } },
          ),
          current,
          Number(value),
        );
        if (signal.aborted) return "";
        setEvidence(v);
        return `Passage ${v.index} relu sous vos accès actuels. Le budget du service reste inchangé ; le rapport reste candidat.`;
      },
      "Vérification des droits et lecture du passage cité",
      "Passage indisponible : vos accès, ceux du service ou la source ont changé. Relisez la mission avant de continuer.",
    );
  }
  async function action(action: "stop" | "resume") {
    return run(async (signal) => {
      guard();
      const selected = current ?? control;
      if (!selected || !textBound(form.reason, 2000))
        throw Error(
          "Ouvrez une mission ou un contrôle et renseignez le motif de coordination.",
        );
      if (control && action !== "stop")
        throw Error(
          "Le contrôle sans contenu permet seulement l’arrêt. Relisez le mandat pour envisager une reprise.",
        );
      await identity(signal, true);
      const v = control
        ? validateMissionControl(
            await api.call(
              "agent_missions.control",
              { domain, mission: selected.id },
              undefined,
              { signal },
            ),
          )
        : validateMission(
            await api.call(
              "agent_missions.read",
              { domain, mission: selected.id },
              undefined,
              { signal },
            ),
          );
      if (v.id !== selected.id) throw invalidMission();
      if (v.revision !== selected.revision) {
        if ("content_withheld" in v) setControl(v);
        else setCurrent(v);
        throw new ApiError(409, "mission_changed");
      }
      if (
        "content_withheld" in v
          ? !v.can_stop
          : !v.allowed_actions.some((a) => a === action)
      )
        throw Error("Cette action n’est pas disponible dans l’état actuel.");
      if (signal.aborted) return "";
      setPending({
        kind: "command",
        mission: v,
        body: {
          action,
          expected_revision: v.revision,
          idempotency_key: crypto.randomUUID(),
          reason: form.reason,
        },
      });
      return action === "stop"
        ? "Arrêt prêt à confirmer : le bail sera invalidé."
        : "Reprise prête à confirmer : budget consommé et échéance seront conservés.";
    });
  }
  function finish(r: AgentMissionReceipt, t: MissionRecoveryEntry) {
    validateMissionReceipt(r, t);
    onChanged?.();
    if (recoveryScope) forgetMissionRecovery(recoveryScope, t.command);
    setControl(undefined);
    setControlPage(undefined);
    setUnknown(false);
    target.current = undefined;
    setPending(undefined);
    resetForm();
    setPage(undefined);
    setCurrent(undefined);
    setEvents(undefined);
    return `Commande confirmée — ${missionLabels[r.status]}, révision ${r.revision}. Mission ${r.mission_id}. Relisez la mission pour son état actuel.`;
  }
  async function confirm(retry = false) {
    return run(async (signal) => {
      if (!pending) throw Error("Préparez une action avant de confirmer.");
      if (unresolved && !retry)
        throw Error("Vérifiez le reçu avant de reprendre le même envoi.");
      if (retry && !unknown) throw Error("Aucun envoi incertain à reprendre.");
      if (
        !unknown &&
        pending.kind === "create" &&
        (Date.parse(pending.preview.expires_at) <= Date.now() ||
          Date.parse(pending.body.mandate.expires_at) <= Date.now())
      ) {
        setPending(undefined);
        throw Error("La préparation a expiré. Préparez de nouveau.");
      }
      if (!recoveryScope)
        throw Error("Identité de récupération absente : aucun envoi.");
      await identity(signal, true);
      const t = target.current ?? {
        command: pending.body.idempotency_key,
        domain,
        mission: pending.kind === "create" ? null : pending.mission.id,
        status:
          pending.kind === "create" || pending.body.action === "resume"
            ? ("queued" as const)
            : ("stopped" as const),
        revision:
          pending.kind === "create" ? 1 : pending.body.expected_revision + 1,
        started: Date.now(),
      };
      rememberMissionRecovery(recoveryScope, t);
      target.current = t;
      try {
        const r =
          pending.kind === "create"
            ? await api.call(
                "agent_missions.create",
                { domain },
                pending.body,
                { signal },
              )
            : await api.call(
                "agent_missions.command",
                { domain, mission: pending.mission.id },
                pending.body,
                { signal },
              );
        if (signal.aborted) return "";
        return finish(r, t);
      } catch (e) {
        if (signal.aborted) return "";
        if (
          !unknown &&
          e instanceof ApiError &&
          [400, 401, 403, 404, 409, 422].includes(e.status)
        ) {
          forgetMissionRecovery(recoveryScope, t.command);
          target.current = undefined;
          setPending(undefined);
          throw e;
        }
        setUnknown(true);
        if (e instanceof ApiError && [401, 403, 404].includes(e.status))
          clearContent();
        return "Résultat inconnu. La commande peut avoir été appliquée. Vérifiez son reçu ; aucun renvoi automatique.";
      }
    }, "Envoi de la commande confirmée");
  }
  async function verify(value?: string) {
    return run(async (signal) => {
      const t = value
        ? recovered.find((e) => e.command === value)
        : (target.current ??
          (recovered.length === 1 ? recovered[0] : undefined));
      if (!t) throw Error("Choisissez le reçu à vérifier.");
      const v = await api
        .call(
          "agent_missions.receipt",
          { domain, command: t.command },
          undefined,
          { signal },
        )
        .catch((error) => {
          if (error instanceof ApiError && error.status === 404)
            throw Error(
              "Reçu indisponible pour le moment. Le résultat reste inconnu et sa référence est conservée.",
            );
          throw error;
        });
      if (!v || v.command_id !== t.command) throw invalidMission();
      if (signal.aborted) return "";
      return finish(v.receipt, t);
    }, "Vérification du reçu, sans renvoi");
  }
  function discard() {
    if (active.current || unresolved)
      return notice("Un envoi est en cours ou incertain. Vérifiez son reçu.");
    setPending(undefined);
    resetForm();
    return notice("Projet local effacé. Aucune commande serveur annulée.");
  }
  async function act(i: MissionIntent): Promise<string> {
    if (i.kind === "mission_evidence") return readEvidence(i.value);
    if (i.kind === "mission_controls") return readControls(i.next);
    if (i.kind === "mission_control") return openControl(i.value);
    if (i.kind === "mission_list") return list(i.next);
    if (i.kind === "mission_candidates") return agents(i.next);
    if (i.kind === "mission_open") return open(i.value);
    if (i.kind === "mission_history") return history(i.next);
    if (i.kind === "mission_field") return field(i.field, i.value);
    if (i.kind === "mission_agent") {
      if (active.current || pending || unresolved)
        return notice("Terminez la commande actuelle.");
      const c =
        candidates?.items.find((x) => x.subject === i.value) ??
        candidates?.items[Number(i.value) - 1];
      if (!canCoordinate || !c)
        return notice("Choisissez un service de la page courante.");
      setAgent(c.subject);
      return notice("Service choisi ; aucun accès ajouté.");
    }
    if (i.kind === "mission_source_search") {
      setShowNew(true);
      return picker.current?.search(i.value) ?? "Recherche non disponible.";
    }
    if (i.kind === "mission_source_next")
      return picker.current?.next() ?? "Recherche non disponible.";
    if (i.kind === "mission_source")
      return picker.current?.select(i.value) ?? "Recherche non disponible.";
    if (i.kind === "mission_prepare") return prepare();
    if (i.kind === "mission_action") return action(i.action);
    if (i.kind === "mission_confirm") return confirm();
    if (i.kind === "mission_retry") return confirm(true);
    if (i.kind === "mission_verify") return verify(i.value);
    if (i.kind === "mission_cancel") {
      if (active.current || unresolved)
        return notice(
          "Impossible d’annuler une commande en cours ou incertaine. Vérifiez le reçu.",
        );
      setPending(undefined);
      return notice("Préparation locale annulée ; saisie conservée.");
    }
    if (i.kind === "mission_discard") return discard();
    if (active.current) return notice("Une opération est en cours.");
    if (!recoveryScope) return notice("Récupération indisponible.");
    if (i.kind !== "mission_forget")
      return notice("Commande de mission indisponible.");
    const t = recovered.find((x) => x.command === i.value);
    if (!t) return notice("Référence introuvable.");
    forgetMissionRecovery(recoveryScope, t.command);
    if (target.current?.command === t.command) {
      target.current = undefined;
      setUnknown(false);
      setPending(undefined);
    }
    return notice(
      "Référence locale retirée. Cela n’annule pas la commande serveur ; relisez vos missions.",
    );
  }
  useImperativeHandle(ref, () => ({ act }));
  const locked = busy || !!pending || unresolved;
  const controlTitle = (c: AgentMissionControl) =>
    `Mission créée le ${new Date(c.created_at).toLocaleString("fr-FR")}`;
  const showControl = (c: AgentMissionControl) => (
    <>
      <p>
        {controlTitle(c)} · {missionLabels[c.status]} · révision {c.revision}
        {c.expired ? " · Échéance dépassée" : ""}
      </p>
      <p>
        Consommation : {c.reads_used}/{c.max_reads} lectures, {c.chars_used}/
        {c.max_chars} caractères. Échéance :{" "}
        {new Date(c.expires_at).toLocaleString("fr-FR")}.
      </p>
      <p>
        Contenu masqué dans ce contrôle : aucun objectif, source, rapport ou
        identité du service.
      </p>
      <details>
        <summary>Référence du contrôle</summary>
        <p>{c.id}</p>
      </details>
    </>
  );
  useEffect(() => {
    if (control) focus.current?.focus();
  }, [control]);
  const showMandate = (m: AgentMissionMandate) => (
    <dl className="reference-mandate">
      <dt>Service nommé</dt>
      <dd>{m.agent}</dd>
      <dt>Objectif</dt>
      <dd>{m.objective}</dd>
      <dt>Critères</dt>
      <dd>{m.criteria}</dd>
      <dt>Source figée</dt>
      <dd className="mono">
        {m.source_id}
        <br />
        {m.source_hash}
      </dd>
      <dt>Plafonds</dt>
      <dd>
        {m.max_reads} lectures · {m.max_chars} caractères
      </dd>
      <dt>Fin du mandat</dt>
      <dd>{new Date(m.expires_at).toLocaleString("fr-FR")}</dd>
    </dl>
  );
  return (
    <section
      className="source-contribution agent-mission-workspace"
      aria-label="Missions bornées d’agents"
    >
      <p>
        Confiez une lecture précise à un service déjà autorisé, puis examinez
        son rapport candidat. Aucun modèle ni worker n’est lancé ici.
      </p>
      <p className="muted">
        Ces plafonds concernent les lectures de cette mission, pas les jetons,
        coûts ni les autres accès du service. Une mission ne publie et
        n’approuve aucune connaissance.
      </p>
      <button
        type="button"
        disabled={busy || !!pending || unresolved}
        onClick={() => void list()}
      >
        Lire mes missions
      </button>
      {canCoordinate && (
        <>
          <button disabled={locked} onClick={() => void readControls()}>
            Contrôler mes arrêts de mission
          </button>
          <p className="muted">
            Source inaccessible ? Ce contrôle personnel permet de préparer un
            arrêt, sans relire le contenu.
          </p>
        </>
      )}
      {controlPage && (
        <>
          <ol>
            {controlPage.items.map((c, i) => (
              <li key={c.id}>
                <button
                  disabled={locked}
                  onClick={() => void openControl(c.id)}
                >
                  Contrôle {i + 1} · {controlTitle(c)} —{" "}
                  {missionLabels[c.status]}
                </button>
              </li>
            ))}
          </ol>
          {controlPage.items.length === 0 && (
            <p>Aucun contrôle de mission dont vous êtes l’auteur.</p>
          )}
          <button
            disabled={locked || !controlPage.next_after}
            onClick={() => void readControls(true)}
          >
            Contrôles de mission suivants
          </button>
        </>
      )}
      {control && (
        <section
          tabIndex={-1}
          ref={focus}
          aria-label="Contrôle de mission sans contenu"
        >
          <h3>Arrêter sans ouvrir le contenu</h3>
          {showControl(control)}
          {control.can_stop ? (
            <>
              <label>
                Motif de coordination
                <textarea
                  disabled={locked}
                  value={form.reason}
                  onChange={(e) => field("reason", e.target.value)}
                />
              </label>
              <button disabled={locked} onClick={() => void action("stop")}>
                Préparer l’arrêt
              </button>
            </>
          ) : (
            <p>Aucun arrêt supplémentaire nécessaire dans cet état.</p>
          )}
          <button disabled={locked} onClick={() => void open(control.id)}>
            Relire le mandat sous mes accès actuels
          </button>
        </section>
      )}
      {page && (
        <>
          <ol>
            {page.items.map((m) => (
              <li key={m.id}>
                <button disabled={locked} onClick={() => void open(m.id)}>
                  {m.title} — {missionLabels[m.status]}
                </button>
                <p>
                  {m.reads_used}/{m.max_reads} lectures · {m.chars_used}/
                  {m.max_chars} caractères
                  {m.expired ? " · Échéance dépassée" : ""}
                </p>
              </li>
            ))}
          </ol>
          {page.items.length === 0 && (
            <p>Aucune mission accessible dans cette page.</p>
          )}
          <button
            disabled={locked || !page.next_after}
            onClick={() => void list(true)}
          >
            Missions suivantes
          </button>
        </>
      )}
      {current && (
        <section ref={focus} tabIndex={-1} aria-label="Mandat courant">
          <h3>{current.title}</h3>
          <p>
            {missionLabels[current.status]} · révision {current.revision}
            {current.expired ? " · Échéance dépassée" : ""}
            {current.lease_expired ? " · Bail expiré" : ""}
          </p>
          {showMandate(current)}
          <p>
            Consommation : {current.reads_used}/{current.max_reads} lectures,{" "}
            {current.chars_used}/{current.max_chars} caractères. Restant :{" "}
            {current.max_reads - current.reads_used} lectures,{" "}
            {current.max_chars - current.chars_used} caractères.
          </p>
          <p>
            Fournisseur : aucun. Exécution : client externe ; présence d’un
            worker non vérifiée.
          </p>
          {current.status === "completed" && (
            <>
              <h4>Rapport candidat, à examiner</h4>
              <p>{current.report}</p>
              <h4>Hypothèses et limites déclarées par le service</h4>
              <p>{current.hypotheses}</p>
              <p>
                Passages lus référencés (positions Unicode) :{" "}
                {current.evidence
                  .map((e) => `[${e.start}, ${e.end})`)
                  .join(", ")}
                . La couverture des passages est vérifiée ; les conclusions ne
                sont pas approuvées.
              </p>
              {canCoordinate && (
                <ol>
                  {current.evidence.map((e, i) => (
                    <li key={i}>
                      <button
                        disabled={locked}
                        onClick={() => void readEvidence(String(i + 1))}
                      >
                        Lire le passage de mission {i + 1}
                      </button>{" "}
                      · positions [{e.start}, {e.end})
                    </li>
                  ))}
                </ol>
              )}
              {evidence && (
                <section
                  ref={evidenceFocus}
                  tabIndex={-1}
                  aria-label="Preuve du rapport de mission"
                >
                  <h4>
                    Passage {evidence.index} — {evidence.title}
                  </h4>
                  <blockquote>{evidence.excerpt}</blockquote>
                  <p>
                    Source : {evidence.location}. Positions Unicode [
                    {evidence.start}, {evidence.end}) sur{" "}
                    {evidence.total_characters} caractères.
                  </p>
                  <details>
                    <summary>Provenance du passage</summary>
                    <p>
                      Source {evidence.source_id} · empreinte{" "}
                      {evidence.source_hash} · mission {evidence.mission_id},
                      révision {evidence.mission_revision}.
                    </p>
                  </details>
                  <p>
                    Lecture humaine sous les droits actuels, sans consommation
                    du budget agent. Cette preuve n’approuve pas les conclusions
                    du rapport.
                  </p>
                </section>
              )}
            </>
          )}
          <button disabled={locked} onClick={() => void history()}>
            Lire le journal de mission
          </button>
          {canCoordinate &&
            current.allowed_actions.some(
              (a) => a === "stop" || a === "resume",
            ) && (
              <>
                <label>
                  Motif de coordination
                  <textarea
                    value={form.reason}
                    disabled={locked}
                    onChange={(e) => field("reason", e.target.value)}
                  />
                </label>
                {(["stop", "resume"] as const)
                  .filter((a) => current.allowed_actions.some((x) => x === a))
                  .map((a) => (
                    <button
                      key={a}
                      disabled={locked}
                      onClick={() => void action(a)}
                    >
                      {a === "stop"
                        ? "Préparer l’arrêt"
                        : "Préparer la reprise"}
                    </button>
                  ))}
              </>
            )}
        </section>
      )}
      {events && (
        <section
          tabIndex={-1}
          ref={historyFocus}
          aria-label="Journal de mission"
        >
          <h3>Journal de mission</h3>
          <ol>
            {events.items.map((e) => (
              <li key={e.id}>
                Révision {e.revision} ·{" "}
                {
                  {
                    create: "Création du mandat",
                    claim: "Prise du bail",
                    renew: "Renouvellement du bail",
                    stop: "Arrêt",
                    resume: "Reprise",
                    read: "Lecture de passage",
                    complete: "Remise du rapport candidat",
                  }[e.action]
                }{" "}
                · {e.actor} · {new Date(e.created_at).toLocaleString("fr-FR")}
                <p>{e.reason}</p>
                <p>
                  {e.reads_used} lectures / {e.chars_used} caractères consommés
                  {e.start !== null ? ` · plage [${e.start}, ${e.end})` : ""}
                </p>
              </li>
            ))}
          </ol>
          <button
            disabled={locked || !events.next_after}
            onClick={() => void history(true)}
          >
            Événements suivants
          </button>
        </section>
      )}
      {canCoordinate && (
        <>
          <button
            disabled={locked}
            aria-expanded={showNew}
            onClick={() => setShowNew((v) => !v)}
          >
            {showNew
              ? "Replier le nouveau mandat"
              : "Préparer un nouveau mandat"}
          </button>
          <fieldset hidden={!showNew} disabled={locked}>
            <legend>Nouveau mandat de lecture</legend>
            <SourcePicker
              ref={picker}
              api={api}
              domain={domain}
              disabled={locked}
              onChoose={chooseSource}
              onNotice={notice}
            />
            {source && <p>Source : {source.title}</p>}
            <button onClick={() => void agents()}>
              Lire les services disponibles
            </button>
            {candidates && (
              <>
                <ol>
                  {candidates.items.map((c) => (
                    <li key={c.subject}>
                      <button
                        onClick={() =>
                          void act({ kind: "mission_agent", value: c.subject })
                        }
                      >
                        {c.subject}
                      </button>
                    </li>
                  ))}
                </ol>
                <button
                  disabled={!candidates.next_after}
                  onClick={() => void agents(true)}
                >
                  Services suivants
                </button>
              </>
            )}
            {agent && <p>Service choisi : {agent}</p>}
            <label>
              Titre de mission
              <input
                value={form.title}
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <label>
              Objectif de mission
              <textarea
                value={form.objective}
                onChange={(e) => field("objective", e.target.value)}
              />
            </label>
            <label>
              Critères de mission
              <textarea
                value={form.criteria}
                onChange={(e) => field("criteria", e.target.value)}
              />
            </label>
            <label>
              Lectures maximum
              <input
                type="number"
                min={1}
                max={100}
                value={form.max_reads}
                onChange={(e) => field("max_reads", e.target.value)}
              />
            </label>
            <label>
              Caractères maximum
              <input
                type="number"
                min={1}
                max={100000}
                value={form.max_chars}
                onChange={(e) => field("max_chars", e.target.value)}
              />
            </label>
            <label>
              Durée du mandat en minutes
              <input
                type="number"
                min={1}
                max={1440}
                value={form.minutes}
                onChange={(e) => field("minutes", e.target.value)}
              />
            </label>
            <button onClick={() => void prepare()}>Préparer la mission</button>
          </fieldset>
        </>
      )}
      {pending && (
        <section
          ref={previewFocus}
          tabIndex={-1}
          aria-label="Confirmation de mission"
        >
          <h3>
            {pending.kind === "create"
              ? "Créer ce mandat ?"
              : pending.body.action === "stop"
                ? "Arrêter cette mission ?"
                : "Réactiver cette mission ?"}
          </h3>
          <h4>
            {pending.kind === "create"
              ? pending.body.mandate.title
              : "title" in pending.mission
                ? pending.mission.title
                : controlTitle(pending.mission)}
          </h4>
          {pending.kind === "create"
            ? showMandate(pending.body.mandate)
            : "content_withheld" in pending.mission
              ? showControl(pending.mission)
              : showMandate(pending.mission)}
          {pending.kind === "create" ? (
            <p>
              Source : {pending.preview.source.title},{" "}
              {pending.preview.source.characters} caractères. Préparation
              valable jusqu’à{" "}
              {new Date(pending.preview.expires_at).toLocaleTimeString("fr-FR")}
              . Aucun fournisseur ou worker ne sera lancé.
            </p>
          ) : (
            <p>
              Version {pending.body.expected_revision} · motif :{" "}
              {pending.body.reason}.{" "}
              {pending.body.action === "stop"
                ? "Le bail sera invalidé."
                : "Les compteurs consommés et l’échéance sont conservés."}
            </p>
          )}
          <button disabled={busy || unresolved} onClick={() => void confirm()}>
            Confirmer la mission
          </button>
          <button
            disabled={busy || unresolved}
            onClick={() => void act({ kind: "mission_cancel" })}
          >
            Annuler la préparation de mission
          </button>
        </section>
      )}
      {recovered.map((t) => (
        <section key={t.command} aria-label="Reçu de mission à vérifier">
          <p>
            Résultat à vérifier · commande {t.command}. Aucun contenu de mandat
            stocké dans cette référence.
          </p>
          <button disabled={busy} onClick={() => void verify(t.command)}>
            Vérifier le reçu de mission
          </button>
          {unknown && pending && target.current?.command === t.command && (
            <button disabled={busy} onClick={() => void confirm(true)}>
              Reprendre le même envoi
            </button>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void act({ kind: "mission_forget", value: t.command })
            }
          >
            Retirer la référence locale de mission
          </button>
        </section>
      ))}
      {(dirty || pending) && (
        <button disabled={busy || unresolved} onClick={discard}>
          Effacer le projet de mission
        </button>
      )}
      {busy && <ActivityStatus>{phase}</ActivityStatus>}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <details>
        <summary>Commandes de mission dans le chat</summary>
        <p>
          Mes contrôles de mission · Ouvre le contrôle de mission : numéro · Mes
          missions d’agents · Ouvre la mission : numéro ou identifiant · Cherche
          une source de mission : titre · Source de mission : numéro · Services
          pour la mission · Service de mission : numéro · Titre de mission :
          texte · Objectif de mission : texte · Critères de mission : texte ·
          Lectures de mission : nombre · Caractères de mission : nombre · Durée
          de mission : minutes · Prépare la mission · Confirme la mission · Lis
          le passage de mission : numéro · Motif de mission : texte · Arrête la
          mission · Réactive la mission · Historique de la mission · Vérifie le
          reçu de mission.
        </p>
        <p>
          Commandes explicites, pas un agent conversationnel général. Reprise
          d’envoi possible seulement tant que sa charge reste en mémoire. Les
          repères sans contenu expirent après 24 h, au plus 20, dans cet onglet.
        </p>
      </details>
    </section>
  );
});
