import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Concept } from "../../../../packages/contracts/src/QueryResult";
import type { ProposalInput } from "../../../../packages/contracts/src/ProposalInput";
import { CortexApi, ApiError } from "./client";
export function ConceptCorrection({
  api,
  domain,
  issueId,
}: {
  api: CortexApi;
  domain: string;
  issueId: string;
}) {
  const [concepts, setConcepts] = useState<Concept[]>([]),
    [version, setVersion] = useState<number>();
  const [selected, setSelected] = useState(""),
    [title, setTitle] = useState(""),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState("");
  const pending = useRef<ProposalInput>();
  const controller = useRef<AbortController>();
  const cache = useQueryClient();
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    setBusy(true);
    setError("");
    setConcepts([]);
    setVersion(undefined);
    setSelected("");
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const before = await api.call("domain.version", { domain }, undefined, {
        signal,
      });
      const items = await api.call("concepts.list", { domain }, undefined, {
        signal,
      });
      const after = await api.call("domain.version", { domain }, undefined, {
        signal,
      });
      if (
        before.domain_id !== domain ||
        after.domain_id !== domain ||
        !Number.isInteger(before.published_version) ||
        before.published_version !== after.published_version
      )
        throw new ApiError(409, "version_changed");
      if (
        !Array.isArray(items) ||
        items.some(
          (c) =>
            !c ||
            typeof c.concept_id !== "string" ||
            typeof c.title !== "string" ||
            typeof c.body !== "string" ||
            !Array.isArray(c.sources),
        )
      )
        throw new ApiError(200, "invalid_response");
      setConcepts(items);
      setVersion(after.published_version);
    } catch (e) {
      if (!signal.aborted)
        setError(e instanceof Error ? e.message : "Lecture impossible.");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    const original = concepts.find((c) => c.concept_id === selected);
    if (
      !pending.current &&
      (!original ||
        version === undefined ||
        !title.trim() ||
        !reason.trim() ||
        title.trim() === original.title)
    )
      return;
    pending.current ??= {
      base_version: version!,
      reason: `Ticket ${issueId} : ${reason.trim()}`,
      idempotency_key: crypto.randomUUID(),
      changes: [
        {
          kind: "put_concept",
          concept: { ...structuredClone(original!), title: title.trim() },
        },
      ],
    };
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const result = await api.call(
        "proposals.create",
        { domain },
        pending.current,
        { signal },
      );
      if (!result || typeof result.id !== "string" || result.status !== "ready")
        throw new ApiError(200, "invalid_response");
      pending.current = undefined;
      setReceipt(result.id);
      await cache.invalidateQueries({ queryKey: ["api", "proposals", domain] });
    } catch (e) {
      if (!signal.aborted) {
        setError(e instanceof Error ? e.message : "Résultat non confirmé.");
        if (e instanceof ApiError && [403, 404, 409, 422].includes(e.status)) {
          pending.current = undefined;
          setConcepts([]);
          setVersion(undefined);
          setSelected("");
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const current = concepts.find((c) => c.concept_id === selected);
  return (
    <details>
      <summary>Corriger le titre d’un concept existant</summary>
      <p>
        Cette correction conserve l’identifiant, le corps sourcé, la maturité et
        les relations. Elle prépare une proposition à examiner ; le titre doit
        rester fidèle aux preuves.
      </p>
      {receipt ? (
        <p role="status">
          Correction prête à examiner : {receipt}. Aucun changement publié.
        </p>
      ) : (
        <>
          <button
            disabled={busy || !!pending.current}
            onClick={() => void load()}
          >
            Charger les concepts publiés
          </button>
          {version !== undefined && (
            <>
              <p>Base de correction : version {version}</p>
              <label>
                Concept à corriger
                <select
                  value={selected}
                  disabled={busy || !!pending.current}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setTitle(
                      concepts.find((c) => c.concept_id === e.target.value)
                        ?.title ?? "",
                    );
                  }}
                >
                  <option value="">Choisir un concept</option>
                  {concepts.map((c) => (
                    <option key={c.concept_id} value={c.concept_id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              {current && (
                <>
                  <p>Titre actuel : {current.title}</p>
                  <blockquote>{current.body}</blockquote>
                  <label>
                    Nouveau titre
                    <input
                      maxLength={200}
                      value={title}
                      disabled={busy || !!pending.current}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    Motif de correction
                    <textarea
                      maxLength={1800}
                      value={reason}
                      disabled={busy || !!pending.current}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={
                      busy ||
                      !!pending.current ||
                      !title.trim() ||
                      !reason.trim() ||
                      title.trim() === current.title
                    }
                    onClick={() => void submit()}
                  >
                    Proposer la correction du titre
                  </button>
                </>
              )}
            </>
          )}
          {busy && <p role="status">Traitement de la correction…</p>}
          {error && (
            <div role="alert">
              {error}
              {pending.current ? (
                <button disabled={busy} onClick={() => void submit()}>
                  Réessayer la même correction
                </button>
              ) : (
                <p>Rechargez les concepts avant une nouvelle décision.</p>
              )}
            </div>
          )}
        </>
      )}
    </details>
  );
}
