import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Upload, X } from "lucide-react";
import { BrandName } from "../BrandName";
import { BrainWorkspace } from "./BrainWorkspace";
import type { BrainProjection } from "./model";
import { catalogProjection, validateCatalog, type Catalog } from "./catalog";
import { readCatalog, storeCatalog } from "./catalog-store";

export function BrainHub({
  projection,
  onSource,
  onConcept,
}: {
  projection: BrainProjection;
  onSource: (id: string) => void;
  onConcept: (id: string) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [params, setParams] = useSearchParams(),
    file = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const selected = params.get("corpus") === "local";
  const local = useMemo(
    () => (catalog ? catalogProjection(catalog) : null),
    [catalog],
  );
  useEffect(() => {
    let alive = true;
    void readCatalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch(() => {
        if (alive)
          setMessage(
            "Le stockage local est indisponible. Vous pouvez charger un catalogue pour cette session.",
          );
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (source) {
      dialog.current?.showModal();
    } else {
      if (sourceTrigger.current?.isConnected) sourceTrigger.current.focus();
      sourceTrigger.current = null;
    }
  }, [source]);
  function openSource(id: string) {
    sourceTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSource(id);
  }
  function choose(local: boolean) {
    setSource(null);
    setParams(
      local
        ? new URLSearchParams({ corpus: "local", mode: "overview" })
        : new URLSearchParams(),
    );
  }
  async function load(input: HTMLInputElement) {
    const chosen = input.files?.[0];
    if (!chosen) return;
    setBusy(true);
    setMessage("");
    try {
      if (chosen.size > 30 * 1024 * 1024)
        throw new Error("Le catalogue doit peser moins de 30 Mo.");
      const value = validateCatalog(JSON.parse(await chosen.text()));
      setCatalog(value);
      choose(true);
      try {
        await storeCatalog(value);
        setMessage("Catalogue chargé et conservé sur cet appareil.");
      } catch {
        setMessage(
          "Catalogue chargé pour cette session. La conservation locale est indisponible.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof SyntaxError
          ? "Le fichier JSON est illisible. Utilisez le catalogue préparé depuis le bundle OKF."
          : error instanceof Error
            ? error.message
            : "Le catalogue n’a pas pu être chargé.",
      );
    } finally {
      setBusy(false);
      input.value = "";
    }
  }
  async function forget() {
    try {
      await storeCatalog(null);
      setCatalog(null);
      choose(false);
      setMessage(
        "Le catalogue local a été retiré. Le fichier d’origine reste disponible.",
      );
    } catch {
      setMessage("Impossible de retirer le catalogue du stockage local.");
    }
  }
  const evidence = local?.sources.find((s) => s.id === source);
  return (
    <>
      <div className="brain-hub">
        <div className="brain-hub-switch">
          <button aria-pressed={!selected} onClick={() => choose(false)}>
            Cerveau de démonstration
          </button>
          <button
            aria-pressed={selected}
            disabled={!catalog}
            onClick={() => choose(true)}
          >
            Corpus local
            {catalog
              ? ` · ${catalog.concepts.length.toLocaleString("fr-FR")} fiches`
              : ""}
          </button>
        </div>
        <button onClick={() => file.current?.click()} disabled={busy || !ready}>
          <Upload size={15} />
          {busy ? "Lecture du catalogue…" : "Charger un catalogue OKF"}
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          aria-label="Catalogue OKF préparé"
          className="sr-only"
          onChange={(e) => void load(e.currentTarget)}
        />
      </div>
      {message && (
        <p className="brain-hub-status" role="status">
          {message}
        </p>
      )}
      {selected && !ready ? (
        <p className="brain-hub-status" role="status">
          Ouverture du corpus local…
        </p>
      ) : selected && !local ? (
        <div className="brain-hub-status">
          <p>
            Ce corpus n’est pas présent sur cet appareil. Chargez son catalogue
            pour retrouver cette vue.
          </p>
          <button onClick={() => file.current?.click()}>
            Choisir le catalogue
          </button>
        </div>
      ) : (
        <BrainWorkspace
          key={selected ? "catalog" : "mock"}
          projection={selected ? local! : projection}
          onSource={selected ? openSource : onSource}
          onConcept={selected ? undefined : onConcept}
        />
      )}
      {selected && local && (
        <footer className="brain-catalog-footer">
          <p>
            Corpus conservé uniquement dans ce navigateur. Son aperçu ne publie
            aucune connaissance dans <BrandName />.
          </p>
          <button onClick={() => void forget()}>Retirer le corpus local</button>
        </footer>
      )}
      {evidence && (
        <dialog
          ref={dialog}
          className="brain-source-dialog"
          aria-labelledby="brain-corpus-source-title"
          onCancel={() => setSource(null)}
          onClose={() => setSource(null)}
        >
          <header>
            <div>
              <span>Source du corpus</span>
              <h2 id="brain-corpus-source-title">{evidence.title}</h2>
            </div>
            <button
              aria-label="Fermer la source du corpus"
              onClick={() => {
                dialog.current?.close();
                setSource(null);
              }}
            >
              <X size={18} />
            </button>
          </header>
          <p>Empreinte déclarée dans le catalogue : {evidence.hash}</p>
          <pre>{evidence.fullText}</pre>
        </dialog>
      )}
    </>
  );
}
