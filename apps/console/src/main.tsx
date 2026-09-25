import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { IntlProvider, useIntl } from "react-intl";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import Markdown from "react-markdown";
import {
  Brain,
  History,
  Plus,
  Network,
  Layers,
  SquareCheck,
  ThumbsUp,
  ThumbsDown,
  Files,
  ScrollText,
  Mic,
  ArrowUp,
  X,
  ChevronRight,
  ChevronLeft,
  Settings2,
  Search,
  Upload,
  RotateCcw,
  Check,
  AlertCircle,
  PanelRightOpen,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./styles.css";
import { ApiConnection } from "./api/ApiConnection";
import {
  gateway,
  roleLabels,
  MockError,
  type Role,
  type View,
  type State,
  type Proposal,
  type Signal,
  type Source,
} from "./mock";

const views: { id: View; label: string; icon: typeof Brain; intro: string }[] =
  [
    {
      id: "concepts",
      label: "Concepts & relations",
      icon: Network,
      intro:
        "Voici les concepts du savoir publié. Les corrections créent des propositions : elles attendent votre validation avant de modifier les réponses.",
    },
    {
      id: "memory",
      label: "Mémoire",
      icon: Layers,
      intro:
        "La mémoire distingue le savoir publié, les changements en attente et les décisions conservées dans le journal.",
    },
    {
      id: "validate",
      label: "À valider",
      icon: SquareCheck,
      intro:
        "Voici les propositions à examiner. Comparez les changements et leurs preuves. Une approbation et une publication sont deux décisions distinctes.",
    },
    {
      id: "signals",
      label: "Signaux utilisateurs",
      icon: ThumbsUp,
      intro:
        "Voici les retours sur les réponses du domaine. Un signal peut donner lieu à une correction traçable.",
    },
    {
      id: "sources",
      label: "Sources & imports",
      icon: Files,
      intro:
        "Retrouvez les sources du domaine et importez un document. Son contenu ne devient pas du savoir publié sans validation.",
    },
    {
      id: "journal",
      label: "Journal",
      icon: ScrollText,
      intro:
        "Voici les événements accessibles avec votre rôle. Chaque décision conserve son contexte et sa raison.",
    },
    {
      id: "admin",
      label: "Administration",
      icon: ShieldCheck,
      intro:
        "Gérez les rôles du domaine. Chaque modification est inscrite au journal administratif.",
    },
  ];
const labels: Record<string, string> = {
  ready: "À valider",
  approved: "Approuvée",
  publishing: "Publication en cours",
  published: "Publié",
  rejected: "Rejetée",
  deferred: "Différée",
  pending: "En attente",
  processing: "Import en cours",
  refused: "Refusé",
  open: "À traiter",
  corrected: "Correction créée",
  done: "Traité",
  ignored: "Ignoré",
};
interface Message {
  publication?: string;
  id: string;
  role: "user" | "assistant";
  text: string;
  version?: number;
  source?: string;
  question?: string;
  voice?: boolean;
  feedback?: boolean;
  link?: string;
  linkLabel?: string;
}
interface Conversation {
  id: string;
  title: string;
  view?: View;
  messages: Message[];
}
interface UI {
  conversations: Conversation[];
  active: string | null;
  createConversation: (view?: View) => string;
  append: (id: string, message: Message) => void;
  update: (id: string, message: string, patch: Partial<Message>) => void;
  activate: (id: string) => void;
  clear: () => void;
}
const useUI = create<UI>()(
  persist(
    (set) => ({
      conversations: [],
      active: null,
      createConversation: (view) => {
        const id = crypto.randomUUID();
        const v = views.find((v) => v.id === view);
        set((s) => ({
          active: id,
          conversations: [
            {
              id,
              title: v?.label ?? "Nouvelle conversation",
              view,
              messages: v
                ? [
                    {
                      id: crypto.randomUUID(),
                      role: "assistant" as const,
                      text: v.intro,
                    },
                  ]
                : [],
            },
            ...s.conversations,
          ].slice(0, 20),
        }));
        return id;
      },
      append: (id, m) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id
              ? {
                  ...c,
                  title:
                    c.messages.length === 0 && m.role === "user"
                      ? m.text.slice(0, 40)
                      : c.title,
                  messages: [...c.messages, m],
                }
              : c,
          ),
        })),
      update: (id, message, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === message ? { ...m, ...patch } : m,
                  ),
                }
              : c,
          ),
        })),
      activate: (active) => set({ active }),
      clear: () => set({ conversations: [], active: null }),
    }),
    { name: "cortexfusion.console.conversations.v1" },
  ),
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 } },
});
const msg = (text: string, extra: Partial<Message> = {}): Message => ({
  id: crypto.randomUUID(),
  role: "assistant",
  text,
  ...extra,
});
const route = (view: View, id?: string) =>
  "/views/" + view + (id ? "/" + encodeURIComponent(id) : "");
function App() {
  const intl = useIntl(),
    nav = useNavigate(),
    location = useLocation(),
    cache = useQueryClient();
  const parts = location.pathname.split("/");
  const view =
    parts[1] === "views" && views.some((v) => v.id === parts[2])
      ? (parts[2] as View)
      : undefined;
  let detail: string | undefined;
  try {
    detail = parts[3] ? decodeURIComponent(parts[3]) : undefined;
  } catch {}
  const ui = useUI();
  const conversation = ui.conversations.find((c) => c.id === ui.active);
  const [role, setRole] = useState<Role>(() => {
      const saved = sessionStorage.getItem("cortexfusion.mock.role");
      const r: Role =
        saved === "viewer" || saved === "corpus_manager" ? saved : "owner";
      gateway.role = r;
      return r;
    }),
    [panel, setPanel] = useState(true),
    [settings, setSettings] = useState(false),
    [offline, setOffline] = useState(false),
    [fail, setFail] = useState(false),
    [resetConfirm, setResetConfirm] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [streaming, setStreaming] = useState(false),
    [draft, setDraft] = useState(""),
    [search, setSearch] = useState(""),
    [decision, setDecision] = useState<
      "approve" | "reject" | "defer" | "publish" | null
    >(null),
    [reason, setReason] = useState(""),
    [correction, setCorrection] = useState(false),
    [target, setTarget] = useState(""),
    [previousTarget, setPreviousTarget] = useState<string | undefined>(),
    [signalAction, setSignalAction] = useState<
      "corrected" | "done" | "ignored" | null
    >(null);
  const historyDialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    chatDecision = useRef<"approve" | "reject" | "defer" | "publish" | null>(
      null,
    );
  const {
    data: s,
    isPending,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["mock-state", role],
    queryFn: () => gateway.get(),
    refetchInterval: 1000,
  });
  useEffect(() => {
    setSearch("");
    setDecision(chatDecision.current);
    chatDecision.current = null;
    setReason("");
    setCorrection(false);
    setSignalAction(null);
    setError("");
    setPanel(true);
  }, [location.pathname]);
  useEffect(() => {
    if (view && !useUI.getState().active) ui.createConversation(view);
  }, [view, conversation]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conversation?.messages]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!settings) return;
    const prior = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".settings-popover");
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSettings(false);
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      prior?.focus();
    };
  }, [settings]);
  function open(v: View, id?: string, fresh = false) {
    if (fresh || !useUI.getState().active) ui.createConversation(v);
    nav(route(v, id));
    setPanel(true);
  }
  function announce(text: string, extra: Partial<Message> = {}) {
    const id = useUI.getState().active ?? ui.createConversation(view);
    ui.append(id, msg(text, extra));
  }
  async function action(fn: () => Promise<unknown>, text: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["mock-state"] });
      if (text) announce(text);
      setDecision(null);
      setReason("");
      setCorrection(false);
      setSignalAction(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function changeRole(value: Role) {
    generation.current++;
    setStreaming(false);
    gateway.role = value;
    sessionStorage.setItem("cortexfusion.mock.role", value);
    setRole(value);
    setDecision(null);
    setError("");
    setReason("");
    setSettings(false);
    ui.clear();
    nav("/");
    cache.removeQueries({ queryKey: ["mock-state"] });
  }
  async function send(text = draft, voice = false) {
    if (!text.trim() || streaming) return;
    const id = ui.active ?? ui.createConversation(view);
    ui.append(id, {
      id: crypto.randomUUID(),
      role: "user",
      text: text.trim(),
      voice,
    });
    setDraft("");
    setStreaming(true);
    setError("");
    const run = generation.current;
    try {
      const state = await gateway.get();
      if (run !== generation.current) return;
      const q = text.toLowerCase();
      let answer: Message;
      if (/approuv|rejett|rejeter|différ|publie|publier/.test(q)) {
        const ident =
          q.match(/pr-\d+/)?.[0].toUpperCase() ??
          (view === "validate" ? detail : undefined);
        const p = state.proposals.find((p) => p.id === ident);
        if (!p)
          answer = msg(
            "Je ne trouve pas cette proposition. Ouvrez « À valider » pour choisir un élément.",
          );
        else {
          chatDecision.current = /publi/.test(q)
            ? "publish"
            : /rejet/.test(q)
              ? "reject"
              : /différ/.test(q)
                ? "defer"
                : "approve";
          if (location.pathname === route("validate", p.id)) {
            setDecision(chatDecision.current);
            chatDecision.current = null;
          }
          open("validate", p.id);
          answer = msg(
            `Décision demandée pour ${p.id} — ${p.title}. Vérifiez la cible et les preuves avant confirmation. Aucune modification n’a encore été effectuée.`,
          );
        }
      } else if (/attend|décision|valider|proposition/.test(q)) {
        open("validate");
        answer = msg(
          `${state.proposals.filter((p) => p.status === "ready").length} propositions attendent une décision. Les preuves et les changements sont disponibles dans la vue.`,
        );
      } else if (/signal|négatif|insatisf/.test(q)) {
        open("signals");
        answer = msg(
          `${state.signals.filter((s) => s.rating === "unhelpful" && s.status === "open").length} retours négatifs restent à traiter.`,
        );
      } else if (/mémoire/.test(q)) {
        open("memory");
        answer = msg(
          `Le savoir publié est en version ${state.version}. Les propositions en attente n’affectent pas les réponses.`,
        );
      } else if (/source|import/.test(q)) {
        open("sources");
        answer = msg(
          "Choisissez un fichier dans la vue Sources & imports. Le mock traite localement les fichiers texte et Markdown.",
        );
      } else {
        const c = state.concepts.find((c) => q.includes(c.name.toLowerCase()));
        if (c) {
          open("concepts", c.id);
          const hasWave = c.relations.includes("wave6");
          answer = msg(
            q.includes("wave6")
              ? hasWave
                ? "wave6 figure dans le périmètre publié de SIMULIA."
                : "Je ne peux pas confirmer wave6 à partir de la version publiée. Une proposition reste à examiner."
              : `${c.description}\n\nRelations publiées : **${c.relations.join(", ")}**.`,
            {
              version: state.version,
              source: q.includes("wave6") && hasWave ? "SRC-002" : c.source,
              question: text,
            },
          );
        } else
          answer = msg(
            "Je ne dispose pas de preuve suffisante dans ce corpus de démonstration pour répondre à cette question. Essayez « Quel est le périmètre de SIMULIA ? » ou ouvrez une vue.",
            { version: state.version, question: text },
          );
      }
      const whole = answer.text;
      ui.append(id, { ...answer, text: "" });
      for (let i = 0; i < whole.length; i += 18) {
        await new Promise((r) => setTimeout(r, 18));
        if (run !== generation.current) return;
        ui.update(id, answer.id, { text: whole.slice(0, i + 18) });
      }
    } catch (e) {
      ui.append(
        id,
        msg(e instanceof Error ? e.message : "Réponse indisponible."),
      );
    } finally {
      if (run === generation.current) setStreaming(false);
    }
  }
  useEffect(() => {
    for (const conversation of useUI.getState().conversations)
      for (const receipt of conversation.messages) {
        if (!receipt.publication) continue;
        const proposal = s?.proposals.find((p) => p.id === receipt.publication);
        if (proposal && (proposal.status === "published" || proposal.error)) {
          ui.update(conversation.id, receipt.id, {
            publication: undefined,
            text:
              proposal.status === "published"
                ? `${proposal.id} : publication réussie. Le savoir v${proposal.base + 1} est disponible.`
                : `${proposal.id} : ${proposal.error}`,
            link: route("validate", proposal.id),
            linkLabel: "Voir le résultat",
          });
        }
      }
  }, [s]);
  async function publishTracked(proposal: Proposal, version: number) {
    await gateway.publish(proposal.id, version);
    setFail(false);
    const conversation = useUI.getState().active ?? ui.createConversation(view);
    const receipt = msg(`${proposal.id} : publication en cours…`, {
      publication: proposal.id,
    });
    ui.append(conversation, receipt);
  }
  const pending = s?.proposals.filter((p) => p.status === "ready").length ?? 0;
  const negatives =
    s?.signals.filter((x) => x.rating === "unhelpful" && x.status === "open")
      .length ?? 0;
  const activeView = views.find((v) => v.id === view);
  const canEdit = role !== "viewer";
  const p = s?.proposals.find((p) => p.id === detail),
    c = s?.concepts.find((c) => c.id === detail),
    sig = s?.signals.find((x) => x.id === detail),
    src = s?.sources.find((x) => x.id === detail);
  const disabled = busy || offline;
  const filtered = (text: string) =>
    text.toLowerCase().includes(search.toLowerCase());
  const chips =
    view === "validate"
      ? [
          "Qu’est-ce qui attend ma décision ?",
          ...(p?.status === "ready"
            ? [`Approuve ${p.id}`]
            : p?.status === "approved"
              ? [`Publier ${p.id}`]
              : []),
        ]
      : view === "concepts"
        ? [
            "Quel est le périmètre de SIMULIA ?",
            "SIMULIA comprend-elle wave6 ?",
          ]
        : [
            "Qu’est-ce qui attend ma décision ?",
            "Quels signaux négatifs cette semaine ?",
            "Où en est la mémoire du domaine ?",
          ];
  function Stats({ items }: { items: [string, number | string, string][] }) {
    return (
      <div className="stats">
        {items.map(([label, value, sub]) => (
          <div className="stat" key={label}>
            <span className="kicker">{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
    );
  }
  function Row({
    title,
    sub,
    status,
    onClick,
  }: {
    title: string;
    sub: string;
    status?: string;
    onClick: () => void;
  }) {
    return (
      <button className="row" onClick={onClick}>
        <span>
          <strong>{title}</strong>
          <small>{sub}</small>
        </span>
        <span className="row-end">
          {status && <Tag value={status} />}
          <ChevronRight size={15} />
        </span>
      </button>
    );
  }
  function Evidence({ id }: { id: string }) {
    const source = s?.sources.find((x) => x.id === id);
    return (
      <div className="evidence">
        <span className="kicker">Preuve · contenu de démonstration</span>
        <blockquote>
          {source?.text || "Preuve à compléter avant validation."}
        </blockquote>
        <button className="text-button" onClick={() => open("sources", id)}>
          {source?.name ?? id} <ChevronRight size={13} />
        </button>
      </div>
    );
  }
  const notFound =
    detail &&
    !(
      (view === "validate" && p) ||
      (view === "concepts" && c) ||
      (view === "signals" && sig) ||
      (view === "sources" && src) ||
      (view === "journal" && s?.events.some((e) => e.id === detail))
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          aria-label="Cortex Fusion — accueil"
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
        >
          <Brain size={23} />
          <span>Cortex Fusion</span>
        </a>
        <button
          aria-label="Nouvelle conversation"
          className="new-conversation"
          onClick={() => {
            ui.createConversation();
            nav("/");
          }}
        >
          <Plus size={15} />
          Nouvelle conversation
        </button>
        <div className="kicker nav-label">Vues</div>
        <nav>
          {views
            .filter((v) => v.id !== "admin")
            .map((v) => (
              <button
                key={v.id}
                aria-label={v.label}
                aria-current={view === v.id ? "page" : undefined}
                onClick={() => open(v.id, undefined, true)}
              >
                <v.icon size={16} />
                <span>{v.label}</span>
                {v.id === "validate" && pending > 0 && (
                  <small className="nav-count">{pending}</small>
                )}
              </button>
            ))}
        </nav>
        <button
          className="mobile-history"
          aria-label="Historique des conversations"
          onClick={() => historyDialog.current?.showModal()}
        >
          <History size={19} />
        </button>
        <dialog
          ref={historyDialog}
          className="history-dialog"
          aria-labelledby="history-title"
        >
          <div className="history-heading">
            <h2 id="history-title">Conversations</h2>
            <button
              autoFocus
              aria-label="Fermer l’historique"
              onClick={() => historyDialog.current?.close()}
            >
              <X size={20} />
            </button>
          </div>
          <div className="history-list">
            {ui.conversations.map((x) => (
              <button
                key={x.id}
                aria-current={ui.active === x.id ? "true" : undefined}
                onClick={() => {
                  ui.activate(x.id);
                  nav(x.view ? route(x.view) : "/");
                  historyDialog.current?.close();
                }}
              >
                {x.title}
              </button>
            ))}
            {!ui.conversations.length && <p>Vos échanges apparaîtront ici.</p>}
          </div>
        </dialog>
        <div className="kicker nav-label history-label">Conversations</div>
        <div className="history">
          {ui.conversations.slice(0, 8).map((x) => (
            <button
              key={x.id}
              title={x.title}
              aria-current={ui.active === x.id ? "true" : undefined}
              onClick={() => {
                ui.activate(x.id);
                nav(x.view ? route(x.view) : "/");
              }}
            >
              {x.title}
            </button>
          ))}
          {!ui.conversations.length && (
            <small>Vos échanges apparaîtront ici.</small>
          )}
        </div>
        <div className="sidebar-bottom">
          {role === "owner" && (
            <button
              aria-label="Administration"
              className="admin-link"
              onClick={() => open("admin", undefined, true)}
            >
              <ShieldCheck size={15} />
              Administration
            </button>
          )}
          <button
            className="mock-toggle"
            onClick={() => setSettings(!settings)}
            aria-expanded={settings}
          >
            <span className="mock-dot" />
            Démo locale
            <Settings2 size={14} />
          </button>
          <div className="user">
            <div className="avatar">
              {role === "owner" ? "CL" : role === "viewer" ? "MP" : "NM"}
            </div>
            <div>
              <strong>
                {role === "owner"
                  ? "Claire Lemoine"
                  : role === "viewer"
                    ? "Marc Petit"
                    : "Nadia Martin"}
              </strong>
              <small>
                {roleLabels[role]} · v{s?.version ?? "…"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <section
          className={
            "conversation " +
            (!view && !conversation?.messages.length ? "home" : "")
          }
        >
          {!view && !conversation?.messages.length ? (
            <div className="welcome">
              <div className="kicker">
                {intl.formatDate(new Date(), {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}{" "}
                · Marques & portefeuille
              </div>
              <h1>
                Bonjour{" "}
                {role === "owner"
                  ? "Claire"
                  : role === "viewer"
                    ? "Marc"
                    : "Nadia"}
                . {s ? pending : "…"} propositions attendent{" "}
                {canEdit ? "votre décision" : "une décision"} et{" "}
                {s ? negatives : "…"} réponses ont été jugées insatisfaisantes.
              </h1>
              <Composer
                draft={draft}
                setDraft={setDraft}
                send={send}
                busy={streaming}
              />
              <div className="chips">
                {chips.map((t) => (
                  <button key={t} onClick={() => send(t)} disabled={streaming}>
                    {t}
                  </button>
                ))}
              </div>
              <p className="demo-note">
                Données fictives · Aucun appel au backend ou à un modèle
              </p>
              {queryError && (
                <p role="alert" className="error">
                  {queryError.message}
                </p>
              )}
            </div>
          ) : (
            <>
              <header className="conversation-header">
                <div>
                  <strong>
                    {activeView?.label ?? conversation?.title ?? "Conversation"}
                  </strong>
                  <small>savoir publié v{s?.version ?? "…"}</small>
                </div>
                {view && !panel && (
                  <button
                    className="text-button"
                    onClick={() => setPanel(true)}
                  >
                    <PanelRightOpen size={16} />
                    Afficher la vue
                  </button>
                )}
              </header>
              <div className="messages" ref={scroll}>
                {conversation?.messages.map((m) => (
                  <div key={m.id} className={"message " + m.role}>
                    {m.role === "assistant" && (
                      <span className="assistant-avatar">
                        <Brain size={15} />
                      </span>
                    )}
                    <div className="message-body">
                      {m.voice && <Mic size={14} />}
                      <Markdown>{m.text}</Markdown>
                      {!m.text && (
                        <span className="typing">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                      {m.source && (
                        <button
                          className="citation"
                          onClick={() => open("sources", m.source)}
                        >
                          Source ·{" "}
                          {s?.sources.find((x) => x.id === m.source)?.name ??
                            m.source}{" "}
                          · v{m.version}
                          <ChevronRight size={12} />
                        </button>
                      )}
                      {m.link && (
                        <button
                          className="text-button"
                          onClick={() => nav(m.link!)}
                        >
                          {m.linkLabel ?? "Ouvrir"}
                          <ChevronRight size={13} />
                        </button>
                      )}
                      {m.question && (
                        <Feedback
                          message={m}
                          disabled={streaming || busy}
                          submit={(rating, comment) =>
                            action(async () => {
                              await gateway.feedback(
                                m.question!,
                                m.text,
                                rating,
                                comment,
                                m.version!,
                              );
                              ui.update(conversation!.id, m.id, {
                                feedback: true,
                              });
                            }, "Merci, votre retour est enregistré dans les signaux utilisateurs.")
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="conversation-footer">
                <div className="chips">
                  {chips.slice(0, 2).map((t) => (
                    <button
                      key={t}
                      onClick={() => send(t)}
                      disabled={streaming}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <Composer
                  draft={draft}
                  setDraft={setDraft}
                  send={send}
                  busy={streaming}
                />
                <small className="composer-note">
                  Réponses de démonstration, fondées sur le savoir publié.
                </small>
              </div>
            </>
          )}
        </section>
        {view && panel && (
          <section className="panel" aria-label={activeView?.label}>
            <header className="panel-header">
              {detail ? (
                <button
                  className="text-button"
                  onClick={() => nav(route(view))}
                >
                  <ChevronLeft size={16} />
                  {activeView?.label}
                </button>
              ) : (
                <h2>{activeView?.label}</h2>
              )}
              <button
                className="icon-button"
                aria-label="Fermer la vue"
                onClick={() => setPanel(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="panel-content" key={location.pathname}>
              {(error || queryError) && (
                <div role="alert" className="error">
                  <AlertCircle size={16} />
                  <span>{error || queryError?.message}</span>
                  <button
                    onClick={() => {
                      setError("");
                      refetch();
                    }}
                  >
                    Réessayer
                  </button>
                </div>
              )}
              {isPending ? (
                <div className="empty">
                  <Loader2 className="spin" />
                  Chargement de la vue…
                </div>
              ) : !s ? (
                <div className="empty">La vue est indisponible.</div>
              ) : notFound ? (
                <div className="empty">
                  <AlertCircle />
                  Cet élément est introuvable ou inaccessible.
                  <button onClick={() => nav(route(view))}>
                    Retour à la liste
                  </button>
                </div>
              ) : (
                <>
                  {!detail && view !== "admin" && (
                    <>
                      <Stats
                        items={
                          view === "concepts"
                            ? [
                                [
                                  "Concepts",
                                  s.concepts.length,
                                  "dans le savoir publié",
                                ],
                                [
                                  "Relations",
                                  s.concepts.reduce(
                                    (n, c) => n + c.relations.length,
                                    0,
                                  ),
                                  "liens publiés",
                                ],
                                [
                                  "Version",
                                  "v" + s.version,
                                  "savoir de référence",
                                ],
                              ]
                            : view === "validate"
                              ? [
                                  ["En attente", pending, "à examiner"],
                                  [
                                    "Approuvées",
                                    s.proposals.filter(
                                      (p) => p.status === "approved",
                                    ).length,
                                    "avant publication",
                                  ],
                                  [
                                    "Publiées",
                                    s.proposals.filter(
                                      (p) => p.status === "published",
                                    ).length,
                                    "décisions appliquées",
                                  ],
                                ]
                              : view === "signals"
                                ? [
                                    [
                                      "Positifs",
                                      s.signals.filter(
                                        (s) => s.rating === "helpful",
                                      ).length,
                                      "réponses utiles",
                                    ],
                                    [
                                      "Négatifs",
                                      s.signals.filter(
                                        (s) => s.rating === "unhelpful",
                                      ).length,
                                      "retours explicites",
                                    ],
                                    [
                                      "À traiter",
                                      negatives,
                                      "retours négatifs ouverts",
                                    ],
                                  ]
                                : view === "sources"
                                  ? [
                                      [
                                        "Publiées",
                                        s.sources.filter(
                                          (s) => s.status === "published",
                                        ).length,
                                        "sources actives",
                                      ],
                                      [
                                        "En attente",
                                        s.sources.filter((s) =>
                                          [
                                            "pending",
                                            "processing",
                                            "ready",
                                          ].includes(s.status),
                                        ).length,
                                        "imports et validation",
                                      ],
                                      [
                                        "En erreur",
                                        s.sources.filter(
                                          (s) => s.status === "refused",
                                        ).length,
                                        "sources inexploitables",
                                      ],
                                    ]
                                  : view === "memory"
                                    ? [
                                        [
                                          "Court terme",
                                          s.proposals.filter((p) =>
                                            [
                                              "ready",
                                              "approved",
                                              "publishing",
                                            ].includes(p.status),
                                          ).length,
                                          "changements en attente",
                                        ],
                                        [
                                          "Long terme",
                                          s.concepts.length,
                                          "concepts publiés",
                                        ],
                                        [
                                          "Archive",
                                          s.proposals.filter((p) =>
                                            [
                                              "rejected",
                                              "deferred",
                                              "published",
                                            ].includes(p.status),
                                          ).length,
                                          "décisions conservées",
                                        ],
                                      ]
                                    : [
                                        [
                                          "Événements",
                                          s.events.length,
                                          "accessibles à votre rôle",
                                        ],
                                        [
                                          "Administratifs",
                                          s.events.filter((e) => e.admin)
                                            .length,
                                          "accès et rôles",
                                        ],
                                        [
                                          "Publications",
                                          s.events.filter((e) =>
                                            e.title.startsWith("Publication v"),
                                          ).length,
                                          "versions publiées",
                                        ],
                                      ]
                        }
                      />
                      {view !== "memory" && (
                        <div className="search">
                          <Search size={15} />
                          <input
                            aria-label="Filtrer la vue"
                            placeholder="Rechercher dans cette vue"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                      )}
                    </>
                  )}
                  {!detail && view === "concepts" && (
                    <div className="list">
                      <SectionTitle>Concepts du domaine</SectionTitle>
                      {s.concepts
                        .filter((c) => filtered(c.name))
                        .map((c) => (
                          <Row
                            key={c.id}
                            title={c.name}
                            sub={c.description}
                            status="published"
                            onClick={() => open(view, c.id)}
                          />
                        ))}
                    </div>
                  )}
                  {!detail && view === "validate" && (
                    <div className="list">
                      <SectionTitle>Propositions & décisions</SectionTitle>
                      {s.proposals
                        .filter((p) => filtered(p.title + " " + p.id))
                        .map((p) => (
                          <Row
                            key={p.id}
                            title={p.title}
                            sub={`${p.id} · base v${p.base}`}
                            status={p.status}
                            onClick={() => open(view, p.id)}
                          />
                        ))}
                    </div>
                  )}
                  {view === "validate" && p && (
                    <>
                      <Tag value={p.status} />
                      <h1 className="detail-title">{p.title}</h1>
                      <p className="meta">
                        {p.id} · base v{p.base} · {p.reason}
                      </p>
                      <div className="diff">
                        <div>
                          <SectionTitle>Avant</SectionTitle>
                          <p>{p.before}</p>
                        </div>
                        <div>
                          <SectionTitle>Après</SectionTitle>
                          <p>
                            {p.after.split(p.target).map((part, i) => (
                              <React.Fragment key={i}>
                                {i > 0 && <mark>{p.target}</mark>}
                                {part}
                              </React.Fragment>
                            ))}
                          </p>
                        </div>
                      </div>
                      <Evidence id={p.source} />
                      {!canEdit && (
                        <p className="notice">
                          Votre rôle Lecteur permet de consulter les preuves. Un
                          gestionnaire ou administrateur doit prendre la
                          décision.
                        </p>
                      )}
                      {p.status === "ready" && p.base !== s.accepted && (
                        <div className="notice">
                          La base de cette proposition est antérieure au savoir
                          accepté (v{s.accepted}).
                          <button
                            disabled={disabled || !canEdit}
                            onClick={() =>
                              action(
                                () => gateway.revise(p.id),
                                "La proposition a été révisée. Vérifiez à nouveau les changements.",
                              )
                            }
                          >
                            Réviser sur v{s.accepted}
                          </button>
                        </div>
                      )}
                      {p.status === "ready" && !decision && (
                        <div className="actions">
                          <button
                            className="primary"
                            disabled={disabled || !canEdit}
                            onClick={() => setDecision("approve")}
                          >
                            Approuver
                          </button>
                          <button
                            disabled={disabled || !canEdit}
                            onClick={() => setDecision("reject")}
                          >
                            Rejeter
                          </button>
                          <button
                            className="ghost"
                            disabled={disabled || !canEdit}
                            onClick={() => setDecision("defer")}
                          >
                            Différer
                          </button>
                        </div>
                      )}
                      {decision &&
                        ((p.status === "ready" && decision !== "publish") ||
                          (p.status === "approved" &&
                            decision === "publish")) && (
                          <div className="confirm">
                            <h3>
                              {decision === "publish"
                                ? `Publier la version v${p.base + 1} ?`
                                : decision === "approve"
                                  ? "Confirmer l’approbation ?"
                                  : decision === "reject"
                                    ? "Rejeter cette proposition ?"
                                    : "Différer cette proposition ?"}
                            </h3>
                            <p>
                              {decision === "publish"
                                ? "Cette version sera utilisée pour les prochaines réponses."
                                : "Le savoir publié reste inchangé jusqu’à une publication distincte."}
                            </p>
                            {decision !== "publish" && (
                              <label>
                                Raison de la décision
                                <textarea
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                  placeholder="Précisez ce qui motive votre décision"
                                  maxLength={2000}
                                />
                              </label>
                            )}
                            <div className="actions">
                              <button onClick={() => setDecision(null)}>
                                Annuler
                              </button>
                              <button
                                className="primary"
                                disabled={
                                  disabled ||
                                  !canEdit ||
                                  (decision !== "publish" && !reason.trim())
                                }
                                onClick={() =>
                                  action(
                                    () =>
                                      decision === "publish"
                                        ? publishTracked(p, s.version)
                                        : gateway.decide(
                                            p.id,
                                            decision,
                                            reason,
                                            p.base,
                                          ),
                                    decision === "publish"
                                      ? ""
                                      : "Votre décision est enregistrée. Le savoir publié reste en version v" +
                                          s.version +
                                          ".",
                                  )
                                }
                              >
                                {busy ? "Enregistrement…" : "Confirmer"}
                              </button>
                            </div>
                          </div>
                        )}
                      {p.status === "approved" && (
                        <>
                          <p className="notice">
                            Approuvée · reçu {p.receipt}. Les réponses utilisent
                            encore v{s.version} jusqu’à publication.
                          </p>
                          {p.error && (
                            <p className="error" role="alert">
                              {p.error}
                            </p>
                          )}
                          {decision !== "publish" && (
                            <button
                              className="primary"
                              disabled={disabled || !canEdit}
                              onClick={() => setDecision("publish")}
                            >
                              {p.error
                                ? "Réessayer la publication"
                                : `Publier v${p.base + 1}`}
                            </button>
                          )}
                        </>
                      )}
                      {p.status === "publishing" && (
                        <div className="progress" role="status">
                          <span className="complete">
                            <Check size={15} />
                            Approbation terminée
                          </span>
                          <span className="active">
                            <Loader2 className="spin" size={15} />
                            Projection en cours
                          </span>
                          <span>Index en attente</span>
                        </div>
                      )}
                      {p.status === "published" && (
                        <div className="notice success">
                          <Check size={16} />
                          Publiée dans v{p.base + 1}.
                          <button
                            className="text-button"
                            onClick={() => open("concepts", p.concept)}
                          >
                            Voir le concept
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      )}
                      {["rejected", "deferred"].includes(p.status) && (
                        <p className="notice">
                          {labels[p.status]} · {p.reason}. Aucune modification
                          du savoir publié.
                        </p>
                      )}
                    </>
                  )}
                  {view === "concepts" && c && (
                    <>
                      <Tag value="published" />
                      <h1 className="detail-title">{c.name}</h1>
                      <p>{c.description}</p>
                      <SectionTitle>
                        Relations · savoir publié v{s.version}
                      </SectionTitle>
                      <div className="relations">
                        {c.relations.map((r) => (
                          <div key={r}>
                            <small>comprend</small>
                            <strong>{r}</strong>
                            <Tag value="published" />
                            <button
                              className="text-button"
                              disabled={!canEdit}
                              onClick={() => {
                                setCorrection(true);
                                setPreviousTarget(r);
                                setTarget(r);
                                setReason("");
                              }}
                            >
                              Corriger
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        className="text-button"
                        disabled={!canEdit}
                        onClick={() => {
                          setCorrection(true);
                          setPreviousTarget(undefined);
                          setTarget("");
                          setReason("");
                        }}
                      >
                        <Plus size={14} />
                        Proposer une relation
                      </button>
                      {correction && (
                        <div className="confirm">
                          <h3>Proposer une correction</h3>
                          <p>
                            Le changement sera soumis à validation avant
                            publication.
                          </p>
                          <label>
                            Type de relation
                            <select disabled>
                              <option>comprend</option>
                            </select>
                          </label>
                          <label>
                            Cible
                            <input
                              value={target}
                              onChange={(e) => setTarget(e.target.value)}
                              placeholder="Ex. wave6"
                              maxLength={300}
                            />
                          </label>
                          <label>
                            Raison
                            <textarea
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={2000}
                            />
                          </label>
                          <div className="actions">
                            <button onClick={() => setCorrection(false)}>
                              Annuler
                            </button>
                            <button
                              className="primary"
                              disabled={
                                disabled || !target.trim() || !reason.trim()
                              }
                              onClick={() =>
                                action(async () => {
                                  const id = await gateway.correction(
                                    c.id,
                                    target,
                                    reason,
                                    c.source,
                                    previousTarget,
                                  );
                                  announce(
                                    "La correction " +
                                      id +
                                      " attend une validation. Le concept publié reste inchangé.",
                                    {
                                      link: route("validate", id),
                                      linkLabel: "Ouvrir " + id,
                                    },
                                  );
                                  open("validate", id);
                                }, "")
                              }
                            >
                              Proposer la correction
                            </button>
                          </div>
                        </div>
                      )}
                      <Evidence id={c.source} />
                    </>
                  )}
                  {!detail && view === "signals" && (
                    <div className="list">
                      <SectionTitle>Retours sur les réponses</SectionTitle>
                      {s.signals
                        .filter((s) => filtered(s.title))
                        .map((sig) => (
                          <Row
                            key={sig.id}
                            title={sig.title}
                            sub={`${sig.rating === "helpful" ? "Positif" : "Négatif"} · réponse v${sig.version}`}
                            status={sig.status}
                            onClick={() => open(view, sig.id)}
                          />
                        ))}
                    </div>
                  )}
                  {view === "signals" && sig && (
                    <>
                      <Tag value={sig.status} />
                      <h1 className="detail-title">{sig.title}</h1>
                      <p className="meta">
                        {sig.id} · réponse v{sig.version}
                      </p>
                      <SectionTitle>Question posée</SectionTitle>
                      <p>{sig.question}</p>
                      <SectionTitle>Réponse donnée</SectionTitle>
                      <Markdown>{sig.answer}</Markdown>
                      <SectionTitle>Commentaire utilisateur</SectionTitle>
                      <div className="evidence">{sig.comment}</div>
                      {sig.status === "open" && !signalAction && (
                        <div className="actions">
                          <button
                            className="primary"
                            disabled={!canEdit}
                            onClick={() => setSignalAction("corrected")}
                          >
                            Créer une correction
                          </button>
                          <button
                            disabled={!canEdit}
                            onClick={() => setSignalAction("done")}
                          >
                            Marquer traité
                          </button>
                          <button
                            className="ghost"
                            disabled={!canEdit}
                            onClick={() => setSignalAction("ignored")}
                          >
                            Ignorer
                          </button>
                        </div>
                      )}
                      {signalAction === "corrected" && (
                        <StructuredDraft
                          state={s}
                          signal={sig}
                          disabled={disabled || !canEdit}
                          cancel={() => setSignalAction(null)}
                          submit={(draft) =>
                            action(async () => {
                              const id = await gateway.handleSignal(
                                sig.id,
                                "corrected",
                                draft.reason,
                                {
                                  concept: draft.concept,
                                  target: draft.target,
                                  source: draft.source,
                                },
                              );
                              if (id) {
                                announce(
                                  `La proposition ${id} est liée au signal.`,
                                  {
                                    link: route("validate", id),
                                    linkLabel: `Examiner ${id}`,
                                  },
                                );
                                open("validate", id);
                              }
                            }, "")
                          }
                        />
                      )}
                      {signalAction && signalAction !== "corrected" && (
                        <div className="confirm">
                          <h3>Motiver le traitement</h3>
                          <label>
                            Raison
                            <textarea
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={2000}
                            />
                          </label>
                          <div className="actions">
                            <button onClick={() => setSignalAction(null)}>
                              Annuler
                            </button>
                            <button
                              className="primary"
                              disabled={disabled || !reason.trim() || !canEdit}
                              onClick={() =>
                                action(async () => {
                                  const id = await gateway.handleSignal(
                                    sig.id,
                                    signalAction,
                                    reason,
                                  );
                                  if (id)
                                    announce(
                                      "La proposition " +
                                        id +
                                        " est liée à ce signal.",
                                      {
                                        link: route("validate", id),
                                        linkLabel: "Examiner " + id,
                                      },
                                    );
                                }, "Le signal est mis à jour et le traitement figure au journal.")
                              }
                            >
                              Confirmer
                            </button>
                          </div>
                        </div>
                      )}
                      {sig.proposal && (
                        <button
                          className="text-button"
                          onClick={() => open("validate", sig.proposal)}
                        >
                          Ouvrir {sig.proposal}
                          <ChevronRight size={15} />
                        </button>
                      )}
                    </>
                  )}
                  {!detail && view === "sources" && (
                    <>
                      <input
                        ref={fileRef}
                        hidden
                        type="file"
                        accept=".txt,.md,.pdf,.docx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            action(async () => {
                              const id = await gateway.importFile(file);
                              open("sources", id);
                            }, "Le fichier a été pris en compte. Consultez son état dans la vue.");
                          e.target.value = "";
                        }}
                      />
                      <button
                        className="upload"
                        disabled={!canEdit || disabled}
                        onClick={() => fileRef.current?.click()}
                      >
                        <Upload size={22} />
                        <strong>Importer un fichier</strong>
                        <small>
                          TXT, Markdown · 500 Ko maximum · traitement local
                        </small>
                      </button>
                      <SectionTitle>Sources du domaine</SectionTitle>
                      {s.sources
                        .filter((s) => filtered(s.name))
                        .map((src) => (
                          <Row
                            key={src.id}
                            title={src.name}
                            sub={src.error ?? "Source de démonstration"}
                            status={src.status}
                            onClick={() => open(view, src.id)}
                          />
                        ))}
                    </>
                  )}
                  {view === "sources" && src && (
                    <>
                      <Tag
                        value={
                          src.status === "ready" ? "Texte extrait" : src.status
                        }
                      />
                      <h1 className="detail-title">{src.name}</h1>
                      <p className="meta">
                        {src.id} · contenu local de démonstration
                      </p>
                      {src.error ? (
                        <p className="error">{src.error}</p>
                      ) : src.status === "processing" ? (
                        <div className="notice">
                          <Loader2 className="spin" />
                          Extraction en cours…
                        </div>
                      ) : (
                        <>
                          <SectionTitle>Texte extrait</SectionTitle>
                          <div className="source-text">{src.text}</div>
                        </>
                      )}
                      {src.status === "ready" && (
                        <StructuredDraft
                          state={s}
                          source={src}
                          disabled={disabled || !canEdit}
                          submit={(draft) =>
                            action(async () => {
                              const id = await gateway.sourceProposal(
                                src.id,
                                draft,
                              );
                              open("validate", id);
                            }, "Le brouillon structuré est soumis à validation.")
                          }
                        />
                      )}
                      {src.error && (
                        <button onClick={() => open("sources")}>
                          Importer une version texte
                        </button>
                      )}
                      {src.proposal && (
                        <button
                          className="text-button"
                          onClick={() => open("validate", src.proposal)}
                        >
                          Ouvrir {src.proposal}
                          <ChevronRight size={15} />
                        </button>
                      )}
                    </>
                  )}
                  {!detail && view === "memory" && (
                    <>
                      <SectionTitle>Mémoire du domaine</SectionTitle>
                      <Row
                        title={"Publication v" + s.version}
                        sub="Savoir disponible pour les réponses sourcées"
                        status="published"
                        onClick={() => open("concepts")}
                      />
                      <Row
                        title={"Savoir accepté v" + s.accepted}
                        sub="Les changements approuvés attendent une publication distincte"
                        onClick={() => open("validate")}
                      />
                      <Row
                        title="Propositions & décisions"
                        sub="Court terme et décisions conservées"
                        onClick={() => open("validate")}
                      />
                      <Row
                        title="Historique des événements"
                        sub="Retrouver les publications, imports et traitements"
                        onClick={() => open("journal")}
                      />
                    </>
                  )}
                  {!detail && view === "journal" && (
                    <>
                      <SectionTitle>Événements accessibles</SectionTitle>
                      {s.events
                        .filter((e) => filtered(e.title + " " + e.detail))
                        .map((e) => (
                          <Row
                            key={e.id}
                            title={e.title}
                            sub={
                              intl.formatDate(new Date(e.time), {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }) +
                              " · " +
                              e.detail
                            }
                            onClick={() => open(view, e.id)}
                          />
                        ))}
                    </>
                  )}
                  {view === "journal" &&
                    detail &&
                    (() => {
                      const e = s.events.find((e) => e.id === detail)!;
                      return (
                        <>
                          <span className="tag">
                            {e.admin ? "Administratif" : "Événement du domaine"}
                          </span>
                          <h1 className="detail-title">{e.title}</h1>
                          <p>{e.detail}</p>
                          <p className="meta">
                            {intl.formatDate(new Date(e.time), {
                              dateStyle: "full",
                              timeStyle: "short",
                            })}
                          </p>
                          <small>{e.id}</small>
                        </>
                      );
                    })()}
                  {view === "admin" &&
                    (role !== "owner" ? (
                      <div className="empty">
                        <ShieldCheck />
                        Cette vue est réservée à l’administrateur.
                      </div>
                    ) : (
                      <>
                        <h1 className="detail-title">Accès au domaine</h1>
                        <p className="meta">
                          Marques & portefeuille · Les changements sont tracés
                          au journal.
                        </p>
                        {s.members.map((m) => (
                          <Member
                            key={m.name}
                            member={m}
                            busy={disabled}
                            save={(r, reason) =>
                              action(
                                () => gateway.member(m.name, r, reason),
                                "Le rôle a été modifié et consigné au journal.",
                              )
                            }
                          />
                        ))}
                      </>
                    ))}
                  {search &&
                    !(
                      view === "concepts"
                        ? s.concepts.map((c) => c.name)
                        : view === "validate"
                          ? s.proposals.map((p) => p.title + " " + p.id)
                          : view === "signals"
                            ? s.signals.map((s) => s.title)
                            : view === "sources"
                              ? s.sources.map((s) => s.name)
                              : s.events.map((e) => e.title + " " + e.detail)
                    ).some(filtered) && (
                      <div className="empty">
                        Aucun résultat pour « {search} ».
                      </div>
                    )}
                </>
              )}
            </div>
          </section>
        )}
      </main>
      {settings && (
        <div
          className="settings-popover"
          role="dialog"
          aria-label="Scénarios de démonstration"
        >
          <div className="dialog-heading">
            <h3>Scénarios de démonstration</h3>
            <button
              className="icon-button"
              aria-label="Fermer les scénarios"
              onClick={() => setSettings(false)}
            >
              <X size={17} />
            </button>
          </div>
          <p>Données conservées dans ce navigateur. Aucun service distant.</p>
          <label>
            Tester avec le rôle
            <select
              value={role}
              onChange={(e) => changeRole(e.target.value as Role)}
            >
              {Object.entries(roleLabels).map(([r, label]) => (
                <option key={r} value={r}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={offline}
              onChange={(e) => {
                setOffline(e.target.checked);
                gateway.offline = e.target.checked;
                refetch();
              }}
            />
            Hors ligne
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={fail}
              onChange={(e) => {
                setFail(e.target.checked);
                gateway.failPublication = e.target.checked;
              }}
            />
            Échec de la prochaine publication
          </label>
          <p className="meta">
            Après l’échec, la tentative suivante pourra réussir.
          </p>
          {resetConfirm ? (
            <div className="confirm">
              <p>
                Effacer les données et conversations de cette démonstration ?
              </p>
              <div className="actions">
                <button onClick={() => setResetConfirm(false)}>Annuler</button>
                <button
                  className="primary"
                  onClick={() => {
                    generation.current++;
                    setStreaming(false);
                    gateway.reset();
                    ui.clear();
                    setOffline(false);
                    setFail(false);
                    setResetConfirm(false);
                    setSettings(false);
                    cache.removeQueries({ queryKey: ["mock-state"] });
                    nav("/");
                  }}
                >
                  Réinitialiser
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setResetConfirm(true)}>
              <RotateCcw size={14} />
              Réinitialiser la démo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function Tag({ value }: { value: string }) {
  return (
    <span
      className={
        "tag " +
        (["published", "approved"].includes(value)
          ? "accent"
          : value === "ready" || value === "open"
            ? "outline"
            : "")
      }
    >
      {labels[value] ?? value}
    </span>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="section-title">{children}</h3>;
}
function Member({
  member,
  busy,
  save,
}: {
  member: { name: string; role: Role };
  busy: boolean;
  save: (role: Role, reason: string) => void;
}) {
  const [edit, setEdit] = useState(false),
    [role, setRole] = useState(member.role),
    [reason, setReason] = useState("");
  return (
    <div className="member">
      <strong>{member.name}</strong>
      <Tag value={roleLabels[member.role]} />
      {member.name !== "Claire Lemoine" && (
        <button className="text-button" onClick={() => setEdit(!edit)}>
          Modifier
        </button>
      )}
      {edit && (
        <div className="confirm">
          <label>
            Nouveau rôle
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {Object.entries(roleLabels).map(([r, l]) => (
                <option key={r} value={r}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Raison du changement
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !reason.trim() || role === member.role}
            onClick={() => {
              save(role, reason);
              setEdit(false);
            }}
          >
            Confirmer le rôle
          </button>
          <button
            onClick={() => {
              setEdit(false);
              setRole(member.role);
              setReason("");
            }}
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}
function Feedback({
  message,
  disabled,
  submit,
}: {
  message: Message;
  disabled: boolean;
  submit: (rating: "helpful" | "unhelpful", comment: string) => void;
}) {
  const [negative, setNegative] = useState(false),
    [comment, setComment] = useState("");
  return message.feedback ? (
    <small className="feedback-received">
      <Check size={12} />
      Retour enregistré
    </small>
  ) : (
    <div className="feedback">
      <button
        className="icon-button"
        disabled={disabled}
        aria-label="Réponse utile"
        onClick={() => submit("helpful", "")}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        className="icon-button"
        disabled={disabled}
        aria-label="Réponse insatisfaisante"
        onClick={() => setNegative(!negative)}
      >
        <ThumbsDown size={14} />
      </button>
      {negative && (
        <div className="feedback-form">
          <label>
            Que faut-il améliorer ?
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Commentaire facultatif"
              maxLength={2000}
            />
          </label>
          <button
            disabled={disabled}
            onClick={() => submit("unhelpful", comment)}
          >
            Envoyer le retour
          </button>
        </div>
      )}
    </div>
  );
}
// No fabricated transcription: use the browser capability only after explicit user activation.
function Composer({
  draft,
  setDraft,
  send,
  busy,
}: {
  draft: string;
  setDraft: (s: string) => void;
  send: (s?: string, voice?: boolean) => void;
  busy: boolean;
}) {
  const [listening, setListening] = useState(false),
    [voiceError, setVoiceError] = useState(""),
    [spoken, setSpoken] = useState(false);
  const recognition = useRef<any>(null);
  useEffect(() => () => recognition.current?.abort(), []);
  function mic() {
    if (listening) {
      recognition.current?.stop();
      setListening(false);
      return;
    }
    const C =
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition;
    if (!C) {
      setVoiceError(
        "La dictée n’est pas disponible dans ce navigateur. Vous pouvez saisir votre question.",
      );
      return;
    }
    const r = new C();
    r.lang = "fr-FR";
    r.interimResults = true;
    r.onresult = (e: any) => {
      setDraft(
        Array.from(e.results as any[])
          .map((x: any) => x[0].transcript)
          .join(" "),
      );
      setSpoken(true);
    };
    r.onerror = () => {
      setVoiceError("Microphone indisponible ou autorisation refusée.");
      setListening(false);
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    setVoiceError("");
    try {
      r.start();
      setListening(true);
    } catch {
      setVoiceError("Impossible de démarrer la dictée.");
    }
  }
  return (
    <>
      <form
        className={"composer " + (listening ? "listening" : "")}
        onSubmit={(e) => {
          e.preventDefault();
          recognition.current?.stop();
          send(draft, spoken);
          setSpoken(false);
        }}
      >
        <input
          aria-label="Votre message"
          placeholder={
            listening
              ? "Je vous écoute…"
              : "Posez une question ou demandez une action"
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
        />
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label={listening ? "Arrêter la dictée" : "Parler"}
          onClick={mic}
        >
          {listening ? (
            <span className="wave">
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ animationDelay: i * 0.08 + "s" }} />
              ))}
            </span>
          ) : (
            <Mic size={17} />
          )}
        </button>
        <button
          className="send"
          disabled={busy || !draft.trim()}
          aria-label="Envoyer"
        >
          {busy ? (
            <Loader2 className="spin" size={17} />
          ) : (
            <ArrowUp size={18} />
          )}
        </button>
      </form>
      {voiceError && (
        <small role="status" className="voice-error">
          {voiceError}
        </small>
      )}
      {listening && (
        <small className="voice-error">
          Dictée du navigateur active · son traitement dépend de votre
          navigateur.
        </small>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IntlProvider locale="fr" defaultLocale="fr">
      <QueryClientProvider client={client}>
        <BrowserRouter>
          {import.meta.env.VITE_DATA_MODE === "api" ? (
            <ApiConnection />
          ) : import.meta.env.VITE_DATA_MODE &&
            import.meta.env.VITE_DATA_MODE !== "mock" ? (
            <p role="alert">
              Configuration invalide : VITE_DATA_MODE doit être mock ou api.
            </p>
          ) : (
            <App />
          )}
        </BrowserRouter>
      </QueryClientProvider>
    </IntlProvider>
  </React.StrictMode>,
);

function StructuredDraft({
  state,
  signal,
  source,
  disabled,
  cancel,
  submit,
}: {
  state: State;
  signal?: Signal;
  source?: Source;
  disabled: boolean;
  cancel?: () => void;
  submit: (d: {
    concept: string;
    name: string;
    description: string;
    target: string;
    source: string;
    reason: string;
  }) => void;
}) {
  const [draft, setDraft] = useState({
    concept:
      state.concepts.find((c) =>
        signal?.question.toLowerCase().includes(c.name.toLowerCase()),
      )?.id ?? "",
    name: "",
    description: "",
    target: "",
    source: source?.id ?? "",
    reason: "",
  });
  const [checked, setChecked] = useState(false);
  const set = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setChecked(false);
  };
  const evidence = state.sources.find((s) => s.id === draft.source);
  return (
    <div className="confirm">
      <h3>
        {source ? "Examiner le brouillon extrait" : "Décrire la correction"}
      </h3>
      <p>
        {source
          ? "Extraction simulée : renseignez le concept et la relation à partir du texte ci-dessus. Aucun fait n’est créé automatiquement."
          : "Choisissez le changement et une source qui le justifie."}
      </p>
      {source ? (
        <>
          <label>
            Nom du concept
            <input
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label>
            Description du concept
            <textarea
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
        </>
      ) : (
        <label>
          Concept concerné
          <select
            value={draft.concept}
            onChange={(e) => set("concept", e.target.value)}
          >
            <option value="">Choisir un concept</option>
            {state.concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Relation
        <input readOnly value="comprend" />
      </label>
      <label>
        Cible de la relation
        <input
          value={draft.target}
          onChange={(e) => set("target", e.target.value)}
          placeholder="Ex. wave6"
        />
      </label>
      {!source && (
        <label>
          Source justificative
          <select
            value={draft.source}
            onChange={(e) => set("source", e.target.value)}
          >
            <option value="">Choisir une preuve</option>
            {state.sources
              .filter((s) => s.text && s.status !== "refused")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {evidence && <blockquote>{evidence.text}</blockquote>}
      <label>
        Justification
        <textarea
          value={draft.reason}
          onChange={(e) => set("reason", e.target.value)}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        J’ai vérifié que cette source étaye le changement.
      </label>
      <div className="actions">
        {cancel && <button onClick={cancel}>Annuler</button>}
        <button
          className="primary"
          disabled={
            disabled ||
            !checked ||
            !draft.target.trim() ||
            !draft.reason.trim() ||
            !draft.source ||
            (source
              ? !draft.name.trim() || !draft.description.trim()
              : !draft.concept)
          }
          onClick={() => submit(draft)}
        >
          Créer une proposition
        </button>
      </div>
    </div>
  );
}
