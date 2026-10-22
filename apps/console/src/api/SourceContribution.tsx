import { SourcePicker, type SourcePickerHandle } from "./SourcePicker";
import { usePendingWork } from "./PendingWorkBoundary";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SourcePassage } from "../../../../packages/contracts/src/SourcePassage";
import type { SourceLocation } from "../../../../packages/contracts/src/SourceLocation";
import { readSourcePage, locateSourceExcerpt } from "./sourcePassage";
import type { ProposalInput } from "../../../../packages/contracts/src/ProposalInput";
import { ActivityStatus } from "../ActivityStatus";
import { CortexApi, ApiError } from "./client";
import { workId } from "./workSelection";
import {
  readProposalReceipt,
  type ProposalReceipt,
  proposalLabels,
} from "./proposal-receipt";
import {
  ContributionDraft,
  type ContributionDraftHandle,
} from "./ContributionDraft";
import type { ContributionDraftContent } from "../../../../packages/contracts/src/ContributionDraftContent";
import type { ContributionIntent } from "./contributionCommands";
export interface SourceContributionHandle {
  act: (intent: ContributionIntent) => Promise<string>;
}
const length = (s: string) => Array.from(s).length;
const valid = (s: string, max: number) =>
  !!s.trim() && length(s) <= max && !s.includes("\0");
const rejected = (e: unknown) =>
  e instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(e.status);
const denied = (e: unknown) =>
  e instanceof ApiError && [401, 403, 404].includes(e.status);
export function exactPassage(
  source: string,
  excerpt: string,
): { start: number; end: number } {
  if (!valid(excerpt, 200000))
    throw Error(
      "Choisissez un passage non vide, de 200 000 caractères au plus. Aucun texte n’est tronqué.",
    );
  const index = source.indexOf(excerpt);
  if (index < 0)
    throw Error(
      "Le passage doit reproduire exactement la source, sans reformulation.",
    );
  if (source.indexOf(excerpt, index + 1) >= 0)
    throw Error(
      "Ce passage apparaît plusieurs fois. Sélectionnez son occurrence dans le texte source puis utilisez la sélection.",
    );
  const start = length(source.slice(0, index));
  return { start, end: start + length(excerpt) };
}
type Pending = {
  source: SourceLocation;
  body: ProposalInput;
  expires: number;
  span: { start: number; end: number };
};
export const SourceContribution = forwardRef<
  SourceContributionHandle,
  {
    api: CortexApi;
    domain: string;
    canPropose: boolean;
    canDraft?: boolean;
    onNotice: (text: string) => void;
    onOpen: (id: string) => void;
  }
>(function SourceContribution(
  { api, domain, canPropose, canDraft = false, onNotice, onOpen },
  ref,
) {
  const picker = useRef<SourcePickerHandle>(null);
  const [replacement, setReplacement] = useState<string>();
  const cache = useQueryClient();
  const draft = useRef<ContributionDraftHandle>(null);
  const [sourceId, setSourceId] = useState("");
  const [source, setSource] = useState<SourcePassage>();
  const sourceMeta = useRef<SourceLocation>();
  const [readOffset, setReadOffset] = useState("0");
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [reason, setReason] = useState("");
  const [selection, setSelection] = useState<{ start: number; end: number }>();
  const [chosen, setChosen] = useState<{ start: number; end: number }>();
  const [pending, setPending] = useState<Pending>();
  const [phase, setPhase] = useState<
    "idle" | "prepared" | "uncertain" | "confirmed"
  >("idle");
  const [receipt, setReceipt] = useState<ProposalReceipt>();
  const [busy, setBusy] = useState(false);
  usePendingWork(
    "Proposition de contribution",
    busy && pending
      ? "sending"
      : phase === "uncertain"
        ? "uncertain"
        : undefined,
  );
  const [restoring, setRestoring] = useState(false);
  const [restoration, setRestoration] = useState(0);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (restoration) titleInput.current?.focus();
  }, [restoration]);
  const [accessLost, setAccessLost] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController>();
  const preview = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [api, domain],
  );
  useEffect(() => {
    if (!canPropose) {
      hideSource();
    }
  }, [canPropose]);
  useEffect(() => {
    if (phase === "prepared" && pending) preview.current?.focus();
  }, [phase, pending]);
  function notice(text: string) {
    setMessage(text);
    onNotice(text);
    return text;
  }
  async function freshSelf(signal: AbortSignal) {
    const me = await api.call("identity.read", {}, undefined, { signal });
    if (
      !canPropose ||
      !me ||
      !Array.isArray(me.domains) ||
      !me.domains.some(
        (d) => d.id === domain && d.capabilities.includes("propose"),
      )
    )
      throw new ApiError(403, "forbidden");
  }
  function begin() {
    active.current = true;
    setBusy(true);
    controller.current = new AbortController();
    return { g: generation.current, signal: controller.current.signal };
  }
  function end(g: number) {
    if (g === generation.current) {
      active.current = false;
      setBusy(false);
    }
  }
  function remember(page: SourcePassage) {
    const { excerpt: _excerpt, next_offset: _next, ...metadata } = page;
    sourceMeta.current = metadata;
    setSource(page);
    setReadOffset(String(page.start));
    setSelection(undefined);
  }
  function hideSource() {
    sourceMeta.current = undefined;
    setSource(undefined);
    setAccessLost(true);
    setTitle("");
    setExcerpt("");
    setReason("");
    setChosen(undefined);
    setSelection(undefined);
    // A failed source check also invalidates the neighbouring proposal view.
    // Reset removes its old titles and previews before any authorised reread.
    void cache.resetQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === "api" &&
        ["proposals", "proposal-review"].includes(String(queryKey[1])) &&
        queryKey[2] === domain,
    });
  }
  function position(value: string) {
    if (active.current || pending)
      return notice("Terminez le projet actuel avant de changer son passage.");
    if (value === "") {
      setChosen(undefined);
      return notice(
        "La prochaine préparation cherchera une occurrence unique.",
      );
    }
    if (
      !/^(0|[1-9][0-9]*)$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > 2147483646
    )
      return notice("Indiquez une position Unicode entière, depuis zéro.");
    setChosen({ start: Number(value), end: Number(value) + length(excerpt) });
    return notice(
      "Occurrence choisie localement ; elle sera vérifiée avant confirmation.",
    );
  }
  async function passage(value: string) {
    if (active.current || pending)
      return notice("Terminez le projet actuel avant de changer de page.");
    const selected = source ?? sourceMeta.current;
    if (!selected || accessLost)
      return notice("Choisissez d’abord une source accessible.");
    const offset =
      value === "next"
        ? source?.next_offset
        : value === "previous"
          ? Math.max(0, selected.start - 8192)
          : /^(0|[1-9][0-9]*)$/.test(value)
            ? Number(value)
            : undefined;
    if (
      offset === null ||
      offset === undefined ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 2147483646
    )
      return notice("Aucun passage disponible à cette position.");
    const { g, signal } = begin();
    setSource(undefined);
    setSelection(undefined);
    try {
      await freshSelf(signal);
      const page = await readSourcePage(
        api,
        domain,
        selected.source_id,
        signal,
        offset,
        selected.content_hash,
        8192,
        selected.total_characters,
      );
      if (g !== generation.current) return "";
      remember(page);
      return notice(
        `Passage ${page.start}–${page.end} relu. Les champs de votre ajout sont conservés.`,
      );
    } catch (e) {
      if (g !== generation.current) return "";
      if (e instanceof ApiError && e.status === 409) setSource(undefined);
      if (denied(e)) {
        hideSource();
        draft.current?.hide();
        picker.current?.clear();
      }
      return notice(e instanceof Error ? e.message : "Passage indisponible.");
    } finally {
      end(g);
    }
  }
  async function load(id: string, replace = false) {
    if (active.current) return "Une lecture ou une commande est déjà en cours.";
    if (pending)
      return notice(
        "Fermez le projet actuel ou vérifiez son résultat avant de choisir une autre source.",
      );
    if (!workId(id))
      return notice(
        "Choisissez une source valide depuis un import ou son identifiant.",
      );
    const selected = source ?? sourceMeta.current;
    if (
      !replace &&
      selected &&
      (excerpt || reason || title !== selected.title)
    ) {
      setReplacement(id);
      return notice(
        "Changer de source remplacera le titre, le passage et le motif courants. Enregistrez votre brouillon si nécessaire, puis confirmez le changement ou gardez ce travail.",
      );
    }
    setReplacement(undefined);
    const { g, signal } = begin();
    setSource(undefined);
    sourceMeta.current = undefined;
    setReceipt(undefined);
    setExcerpt("");
    setChosen(undefined);
    setSelection(undefined);
    setMessage("");
    try {
      await freshSelf(signal);
      const value = await readSourcePage(api, domain, id, signal);
      if (g !== generation.current) return "";
      remember(value);
      setSourceId(id);
      setTitle(value.title);
      setReason("");
      setAccessLost(false);
      setPhase("idle");
      return notice(
        "Source relue. Choisissez le passage exact et expliquez pourquoi le proposer.",
      );
    } catch (e) {
      if (g !== generation.current) return "";
      if (e instanceof ApiError && e.status === 409) setSource(undefined);
      if (denied(e)) {
        hideSource();
        draft.current?.hide();
        picker.current?.clear();
      }
      return notice(e instanceof Error ? e.message : "Source indisponible.");
    } finally {
      end(g);
    }
  }
  async function prepare(input?: {
    source: string;
    title: string;
    excerpt: string;
    reason: string;
    start?: number;
  }) {
    if (active.current) return "Une lecture ou une commande est déjà en cours.";
    if (pending)
      return notice(
        "Un projet existe déjà. Confirmez-le, vérifiez-le ou annulez-le avant d’en préparer un autre.",
      );
    const id = input?.source ?? sourceId;
    const name = (input?.title ?? title).trim();
    const body = input?.excerpt ?? excerpt;
    const why = (input?.reason ?? reason).trim();
    if (!workId(id) || !valid(name, 200) || !valid(why, 2000))
      return notice(
        "Source requise, titre de 1 à 200 caractères et motif de 1 à 2 000 caractères.",
      );
    const { g, signal } = begin();
    setReceipt(undefined);
    setMessage("");
    try {
      await freshSelf(signal);
      const selected = source ?? sourceMeta.current;
      const fresh = await locateSourceExcerpt(
        api,
        domain,
        id,
        body,
        signal,
        selected?.source_id === id ? selected.content_hash : undefined,
        input?.start ??
          (!input && selected?.source_id === id ? chosen?.start : undefined),
      );
      const span = { start: fresh.start, end: fresh.end };
      const page = await readSourcePage(
        api,
        domain,
        id,
        signal,
        fresh.start,
        fresh.content_hash,
        8192,
        fresh.total_characters,
      );
      const version = await api.call("domain.version", { domain }, undefined, {
        signal,
      });
      if (
        version.domain_id !== domain ||
        !Number.isSafeInteger(version.published_version) ||
        version.published_version < 0
      )
        throw new ApiError(200, "invalid_response");
      const proposal: ProposalInput = {
        base_version: version.published_version,
        reason: why,
        idempotency_key: crypto.randomUUID(),
        changes: [
          {
            kind: "put_concept",
            concept: {
              concept_id: crypto.randomUUID(),
              title: name,
              body,
              maturity: "emerging",
              sources: [{ source_id: id, ...span }],
              links: [],
            },
          },
        ],
      };
      if (
        new TextEncoder().encode(JSON.stringify(proposal)).byteLength > 2000000
      )
        throw Error(
          "La proposition dépasse le budget de 2 Mo. Réduisez explicitement le passage.",
        );
      if (g !== generation.current) return "";
      remember(page);
      setSourceId(id);
      setTitle(name);
      setExcerpt(body);
      setReason(why);
      setChosen(span);
      setAccessLost(false);
      setPending({
        source: fresh,
        body: proposal,
        expires: Date.now() + 300000,
        span,
      });
      setPhase("prepared");
      return notice(
        `Ajout « ${name} » préparé : ${length(body)} caractères exacts, maturité émergente, base publiée v${version.published_version}. À confirmer ; aucune publication.`,
      );
    } catch (e) {
      if (g !== generation.current) return "";
      if (e instanceof ApiError && e.status === 409) setSource(undefined);
      if (denied(e)) {
        draft.current?.hide();
        hideSource();
      }
      return notice(e instanceof Error ? e.message : "Préparation impossible.");
    } finally {
      end(g);
    }
  }
  async function confirm(recovery = false) {
    if (active.current) return "Une lecture ou une commande est déjà en cours.";
    if (!pending) return notice("Aucun projet d’ajout à confirmer.");
    if (recovery && phase !== "uncertain")
      return notice(
        "Vérifier n’envoie pas un projet qui n’a pas été confirmé.",
      );
    if (!recovery && phase !== "prepared")
      return notice(
        "Vérifiez d’abord le résultat inconnu avec la même demande.",
      );
    if (!recovery && Date.now() > pending.expires)
      return notice(
        "Ce projet a expiré. Annulez-le puis préparez-le à nouveau.",
      );
    const { g, signal } = begin();
    let submitted = false;
    try {
      await freshSelf(signal);
      if (!recovery) {
        const concept = pending.body.changes[0];
        if (concept.kind !== "put_concept")
          throw new ApiError(200, "invalid_response");
        await locateSourceExcerpt(
          api,
          domain,
          pending.source.source_id,
          concept.concept.body,
          signal,
          pending.source.content_hash,
          pending.span.start,
        );
      }
      submitted = true;
      const out = await api.call("proposals.create", { domain }, pending.body, {
        signal,
      });
      const result = readProposalReceipt(out, pending.body.base_version);
      const expected = pending.body.changes[0];
      const actual = out.payload[0];
      if (
        out.reason !== pending.body.reason ||
        out.payload.length !== 1 ||
        actual.kind !== "put_concept" ||
        expected.kind !== "put_concept" ||
        actual.concept.concept_id !== expected.concept.concept_id ||
        actual.concept.title !== expected.concept.title ||
        actual.concept.body !== expected.concept.body ||
        actual.concept.maturity !== "emerging" ||
        !Array.isArray(actual.concept.links) ||
        actual.concept.links.length !== 0 ||
        actual.concept.sources.length !== 1 ||
        actual.concept.sources[0].source_id !== pending.source.source_id ||
        actual.concept.sources[0].start !== pending.span.start ||
        actual.concept.sources[0].end !== pending.span.end
      )
        throw new ApiError(200, "invalid_response");
      if (g !== generation.current) return "";
      setReceipt(result);
      setPending(undefined);
      setPhase("confirmed");
      setAccessLost(false);
      void cache.invalidateQueries({ queryKey: ["api", "proposals", domain] });
      return notice(
        `Proposition enregistrée · ${proposalLabels[result.status]} · ${result.id}. Ouvrez-la pour la revue ; le savoir publié est inchangé.`,
      );
    } catch (e) {
      if (g !== generation.current) return "";
      if (e instanceof ApiError && e.status === 409) setSource(undefined);
      if (denied(e)) {
        draft.current?.hide();
        hideSource();
      }
      if (submitted && !rejected(e)) {
        setPhase("uncertain");
        return notice(
          "Résultat inconnu. Vérifiez le même ajout avec la même clé ; ne préparez pas une seconde proposition.",
        );
      }
      // A recovery rejected for current rights cannot prove whether its earlier call committed.
      if (!recovery && rejected(e)) {
        setPending(undefined);
        setPhase("idle");
      }
      return notice(
        e instanceof Error ? e.message : "Confirmation impossible.",
      );
    } finally {
      end(g);
    }
  }
  async function restoreDraft(
    content: ContributionDraftContent,
  ): Promise<boolean> {
    if (active.current || pending || !canPropose) return false;
    const { g, signal } = begin();
    setRestoring(true);
    try {
      await freshSelf(signal);
      const fresh = await readSourcePage(
        api,
        domain,
        content.source_id,
        signal,
        content.selection?.start ?? 0,
        content.source_hash,
      );
      if (g !== generation.current) return false;
      setReplacement(undefined);
      remember(fresh);
      setSourceId(fresh.source_id);
      setTitle(content.title);
      setExcerpt(content.excerpt);
      setReason(content.reason);
      setChosen(content.selection ?? undefined);
      setSelection(undefined);
      setAccessLost(false);
      setReceipt(undefined);
      setPhase("idle");
      setRestoration((v) => v + 1);
      return true;
    } catch (e) {
      if (g === generation.current) {
        if (denied(e)) {
          hideSource();
        }
        notice(e instanceof Error ? e.message : "Source indisponible.");
      }
      return false;
    } finally {
      end(g);
      if (g === generation.current) setRestoring(false);
    }
  }
  async function act(intent: ContributionIntent): Promise<string> {
    if (!canPropose)
      return notice(
        "La contribution n’est pas disponible avec vos accès actuels.",
      );
    if (intent.kind === "contribution_draft")
      return canDraft && draft.current
        ? draft.current.act(intent.action)
        : notice(
            "La sauvegarde de contribution n’est pas disponible sur ce serveur.",
          );
    if (intent.kind === "contribution_source_search")
      return picker.current?.search(intent.query) ?? "Recherche indisponible.";
    if (intent.kind === "contribution_source_next")
      return picker.current?.next() ?? "Recherche indisponible.";
    if (intent.kind === "contribution_source_select")
      return picker.current?.select(intent.value) ?? "Recherche indisponible.";
    if (intent.kind === "contribution_source_replace") {
      if (!intent.confirm) {
        setReplacement(undefined);
        return notice("Changement annulé. Votre travail est conservé.");
      }
      return replacement
        ? load(replacement, true)
        : notice("Aucun changement de source à confirmer.");
    }
    if (intent.kind === "contribution_passage") return passage(intent.value);
    if (intent.kind === "contribution_position") return position(intent.value);
    if (intent.kind === "contribution_load") return load(intent.source);
    if (intent.kind === "contribution_prepare") return prepare(intent);
    if (intent.kind === "contribution_form") return prepare();
    if (intent.kind === "contribution_confirm") return confirm();
    if (intent.kind === "contribution_recover") return confirm(true);
    if (intent.kind === "contribution_cancel") {
      if (active.current || phase === "uncertain")
        return notice(
          "Vérifiez le résultat inconnu avant d’abandonner cette demande.",
        );
      setPending(undefined);
      setReceipt(undefined);
      setPhase("idle");
      return notice("Projet d’ajout fermé. Aucun nouvel envoi.");
    }
    return notice(
      "Utilisez « prépare un ajout sourcé : source | titre | passage exact | motif », puis « confirme l’ajout ». Les champs contenant | se renseignent dans le formulaire.",
    );
  }
  useImperativeHandle(ref, () => ({ act }));
  if (!canPropose) return null;
  const blocked = busy || !!pending;
  const currentSource = source ?? sourceMeta.current;
  return (
    <section
      className="source-contribution"
      aria-label="Proposer un ajout sourcé"
    >
      <h3>Proposer un ajout sourcé</h3>
      <p>
        Choisissez un passage exact. Il deviendra une proposition à examiner,
        pas du savoir publié. Le texte libre reformulé et l’édition de concepts
        existants ne sont pas pris en charge dans ce parcours.
      </p>
      <ContributionDraft
        ref={draft}
        api={api}
        domain={domain}
        enabled={canDraft && canPropose}
        disabled={busy || !!pending}
        value={
          currentSource && !accessLost
            ? {
                source_id: currentSource.source_id,
                source_hash: currentSource.content_hash,
                title,
                excerpt,
                reason,
                selection: chosen ?? null,
              }
            : null
        }
        onNotice={onNotice}
        onSourceUnavailable={() => {
          setMessage(
            "La source du brouillon n’est plus vérifiable. Son contenu est masqué.",
          );
          setReceipt(undefined);
          hideSource();
          setSelection(undefined);
        }}
        onRestore={restoreDraft}
      />
      <SourcePicker
        ref={picker}
        api={api}
        domain={domain}
        disabled={blocked}
        onChoose={load}
        onNotice={onNotice}
      />
      {replacement && (
        <section aria-label="Changement de source à confirmer">
          <p>
            Le titre, le passage et le motif courants seront remplacés. Un
            brouillon déjà enregistré reste conservé.
          </p>
          <button
            disabled={blocked}
            onClick={() => void load(replacement, true)}
          >
            Changer de source et remplacer les champs
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void act({ kind: "contribution_source_replace", confirm: false })
            }
          >
            Garder ce travail
          </button>
        </section>
      )}
      <details>
        <summary>Ouvrir par identifiant technique</summary>
        <label>
          Identifiant de la source
          <input
            value={sourceId}
            disabled={blocked}
            onChange={(e) => {
              setSourceId(e.target.value);
            }}
          />
        </label>
        <button
          disabled={blocked || !sourceId}
          onClick={() => void load(sourceId)}
        >
          Lire la source pour proposer
        </button>
      </details>
      {currentSource && !accessLost && (
        <>
          <p>
            {currentSource.title} · {currentSource.location}
          </p>
          <p className="source-contribution-hash">
            SHA-256 : {currentSource.content_hash}
          </p>
          <section aria-label="Lecture de la source pour contribution">
            <p>
              Une page à la fois, au plus 8 192 caractères Unicode. Les champs
              de l’ajout sont conservés pendant la lecture.
            </p>
            {source ? (
              <>
                <p>
                  Caractères {source.start}–{source.end} sur{" "}
                  {source.total_characters} · début inclus, fin exclue.
                </p>
                <label>
                  Passage source pour contribution
                  <textarea
                    readOnly
                    value={source.excerpt}
                    onSelect={(e) => {
                      const el = e.currentTarget;
                      setSelection({
                        start:
                          source.start +
                          length(el.value.slice(0, el.selectionStart)),
                        end:
                          source.start +
                          length(el.value.slice(0, el.selectionEnd)),
                      });
                    }}
                  />
                </label>
                <button
                  disabled={
                    blocked || !selection || selection.end <= selection.start
                  }
                  onClick={() => {
                    if (selection) {
                      setExcerpt(
                        Array.from(source.excerpt)
                          .slice(
                            selection.start - source.start,
                            selection.end - source.start,
                          )
                          .join(""),
                      );
                      setChosen(selection);
                    }
                  }}
                >
                  Utiliser le passage sélectionné
                </button>
                <button
                  disabled={blocked || source.start === 0}
                  onClick={() => void passage("previous")}
                >
                  Passage de contribution précédent
                </button>
                <button
                  disabled={blocked || source.next_offset === null}
                  onClick={() => void passage("next")}
                >
                  Passage de contribution suivant
                </button>
                <p>
                  {source.next_offset === null
                    ? "Fin de la source."
                    : "Lecture partielle ; la suite reste accessible."}
                </p>
              </>
            ) : (
              <p>
                Page masquée. Votre saisie reste conservée ; relisez une
                position avant de poursuivre.
              </p>
            )}
            <label>
              Lire la contribution à partir du caractère
              <input
                inputMode="numeric"
                value={readOffset}
                disabled={blocked}
                onChange={(e) => setReadOffset(e.target.value)}
              />
            </label>
            <button disabled={blocked} onClick={() => void passage(readOffset)}>
              Lire ce passage de contribution
            </button>
          </section>
          <label>
            Titre de l’ajout
            <input
              ref={titleInput}
              value={title}
              maxLength={400}
              disabled={blocked}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Passage exact à proposer
            <textarea
              value={excerpt}
              disabled={blocked}
              onChange={(e) => {
                setExcerpt(e.target.value);
                setChosen(undefined);
              }}
            />
          </label>
          <p>
            {length(excerpt)} caractères · maximum 200 000, sans troncature. Un
            passage unique est retrouvé dans la source entière. Pour un passage
            répété, sélectionnez son occurrence ou précisez sa position.
          </p>
          <label>
            Début du passage à proposer (facultatif)
            <input
              inputMode="numeric"
              value={chosen?.start ?? ""}
              disabled={blocked}
              onChange={(e) => void position(e.target.value)}
            />
          </label>
          <details>
            <summary>Commandes de lecture de contribution</summary>
            <p>
              « Passage de contribution suivant », « Passage de contribution
              précédent », « Lis la source de contribution à : position », «
              Début du passage à proposer : position ». Positions Unicode depuis
              zéro. La commande d’ajout sourcé accepte aussi une cinquième
              valeur facultative : le début du passage.
            </p>
          </details>
          <label>
            Motif de l’ajout
            <textarea
              value={reason}
              maxLength={4000}
              disabled={blocked}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button disabled={blocked} onClick={() => void prepare()}>
            Préparer l’ajout
          </button>
        </>
      )}
      {busy && !restoring && (
        <ActivityStatus>Vérification de la contribution…</ActivityStatus>
      )}
      {pending && !accessLost && (
        <section
          className="chat-command-card"
          aria-label="Projet d’ajout sourcé"
        >
          <h4 tabIndex={-1} ref={preview}>
            Ajout à confirmer :{" "}
            {pending.body.changes[0].kind === "put_concept" &&
              pending.body.changes[0].concept.title}
          </h4>
          <p>
            Base publiée v{pending.body.base_version} · maturité émergente ·
            aucune relation ajoutée.
          </p>
          <blockquote>
            {pending.body.changes[0].kind === "put_concept" &&
              pending.body.changes[0].concept.body}
          </blockquote>
          <p>{pending.body.reason}</p>
          <p>
            Source {pending.source.title} · passage {pending.span.start}–
            {pending.span.end} · hash {pending.source.content_hash}
          </p>
          <p>
            Accessible aux personnes disposant du droit de lire les propositions
            et cette source. Aucun nouveau droit n’est accordé. Projet valable
            cinq minutes.
          </p>
        </section>
      )}
      {pending && (
        <div>
          <button
            disabled={busy}
            onClick={() => void confirm(phase === "uncertain")}
          >
            {phase === "uncertain"
              ? "Vérifier le même ajout"
              : "Confirmer l’ajout"}
          </button>
          <button
            disabled={busy || phase === "uncertain"}
            onClick={() => void act({ kind: "contribution_cancel" })}
          >
            Annuler le projet d’ajout
          </button>
        </div>
      )}
      {receipt && !accessLost && (
        <p>
          Proposition {proposalLabels[receipt.status]}{" "}
          <button onClick={() => onOpen(receipt.id)}>
            Ouvrir la proposition enregistrée
          </button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        {canDraft
          ? "Les champs non enregistrés et les confirmations préparées restent locaux à cet onglet. Enregistrez votre brouillon pour le retrouver après rechargement."
          : "Projet local à cet onglet, non sauvegardé au rechargement."}{" "}
        Aucun fournisseur modèle n’est appelé.
      </p>
    </section>
  );
});
