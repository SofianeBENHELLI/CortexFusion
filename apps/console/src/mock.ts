/** Presentation adapter. Local simulation, not an HTTP server or an authorization boundary. */
export type Role = "owner" | "corpus_manager" | "viewer";
export type View =
  | "concepts"
  | "memory"
  | "validate"
  | "signals"
  | "sources"
  | "journal"
  | "admin";
export type Status =
  | "ready"
  | "approved"
  | "publishing"
  | "published"
  | "rejected"
  | "deferred";
export interface Concept {
  id: string;
  name: string;
  description: string;
  relations: string[];
  source: string;
}
export interface Proposal {
  id: string;
  title: string;
  concept: string;
  before: string;
  after: string;
  target: string;
  source: string;
  status: Status;
  base: number;
  reason: string;
  newConcept?: { name: string; description: string };
  receipt?: string;
  error?: string;
  readyAt?: number;
  fail?: boolean;
}
export interface Signal {
  id: string;
  title: string;
  question: string;
  answer: string;
  comment: string;
  status: "open" | "corrected" | "done" | "ignored";
  proposal?: string;
  rating: "helpful" | "unhelpful";
  version: number;
}
export interface Source {
  id: string;
  name: string;
  text: string;
  status: "published" | "pending" | "processing" | "ready" | "refused";
  error?: string;
  readyAt?: number;
  proposal?: string;
}
export interface Event {
  id: string;
  title: string;
  detail: string;
  time: string;
  admin?: boolean;
}
export interface State {
  schema: 1;
  version: number;
  accepted: number;
  revision: number;
  concepts: Concept[];
  proposals: Proposal[];
  signals: Signal[];
  sources: Source[];
  events: Event[];
  members: { name: string; role: Role }[];
}
export class MockError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const key = "cortexfusion.console.mock.v1";
const names = [
  "SIMULIA",
  "3DEXCITE",
  "CENTRIC PLM",
  "OUTSCALE",
  "CATIA Magic",
  "NETVIBES",
];
export const roleLabels: Record<Role, string> = {
  owner: "Administrateur",
  corpus_manager: "Gestionnaire de corpus",
  viewer: "Lecteur",
};
export function seed(): State {
  const descriptions = [
    "SIMULIA réunit les solutions de simulation multiphysique et d’ingénierie virtuelle.",
    "3DEXCITE accompagne la création de contenus et d’expériences de commercialisation en 3D.",
    "CENTRIC PLM accompagne la gestion du cycle de vie des produits.",
    "OUTSCALE fournit des services cloud.",
    "CATIA Magic accompagne l’ingénierie des systèmes.",
    "NETVIBES propose des outils de veille et d’analyse.",
  ];
  return {
    schema: 1,
    version: 41,
    accepted: 41,
    revision: 0,
    concepts: names.map((name, i) => ({
      id: name.toLowerCase().replaceAll(" ", "-"),
      name,
      description: descriptions[i],
      relations:
        i === 0 ? ["Abaqus", "Isight", "fe-safe"] : ["Marques & portefeuille"],
      source: "SRC-001",
    })),
    proposals: [
      [
        "PR-3081",
        "3DEXCITE — clarifier le périmètre",
        "3dexcite",
        "Expériences de commercialisation 3D",
      ],
      ["PR-3082", "SIMULIA — ajouter wave6 au périmètre", "simulia", "wave6"],
      [
        "PR-3083",
        "CENTRIC PLM — préciser la date",
        "centric-plm",
        "Date à confirmer",
      ],
      [
        "PR-3084",
        "OUTSCALE — préciser le rattachement",
        "outscale",
        "Services cloud",
      ],
      [
        "PR-3085",
        "CATIA Magic — clarifier la relation",
        "catia-magic",
        "Ingénierie des systèmes",
      ],
    ].map(([id, title, concept, target]) => ({
      id,
      title,
      concept,
      target,
      before:
        concept === "simulia"
          ? "Abaqus, Isight, fe-safe"
          : "Marques & portefeuille",
      after: concept === "simulia" ? "Abaqus, Isight, fe-safe, wave6" : target,
      source: concept === "simulia" ? "SRC-002" : "SRC-001",
      status: "ready",
      base: 41,
      reason: "Mise à jour proposée à partir des sources de démonstration.",
    })),
    signals: [
      {
        id: "SIG-01",
        title: "3DEXCITE — réponse jugée obsolète",
        question: "Quel est le périmètre de 3DEXCITE ?",
        answer: "3DEXCITE est présenté dans le portefeuille des marques.",
        comment: "La réponse ne distingue pas clairement 3DEXCITE et 3DVIA.",
        status: "open",
        rating: "unhelpful",
        version: 41,
      },
      {
        id: "SIG-02",
        title: "SIMULIA — périmètre incomplet",
        question: "SIMULIA comprend-elle wave6 ?",
        answer: "La version publiée ne mentionne pas wave6.",
        comment: "La documentation récente semble plus complète.",
        status: "open",
        rating: "unhelpful",
        version: 41,
      },
    ],
    sources: [
      {
        id: "SRC-001",
        name: "Brand Portfolio Guide 2026.pdf",
        text: "Extrait fictif de démonstration : SIMULIA réunit Abaqus, Isight et fe-safe. Les marques sont décrites dans leur contexte de portefeuille.",
        status: "published",
      },
      {
        id: "SRC-002",
        name: "Communiqué_SIMULIA_wave6.docx",
        text: "Extrait fictif de démonstration : wave6 complète le périmètre de simulation de SIMULIA. Cet extrait attend une validation et une publication.",
        status: "pending",
      },
      {
        id: "SRC-003",
        name: "NETVIBES_onepager.pdf",
        text: "",
        status: "refused",
        error: "Aucun texte exploitable : document numérisé sans couche texte.",
      },
    ],
    events: [
      {
        id: "EV-1",
        title: "Publication v41",
        detail: "Version publiée disponible pour les réponses.",
        time: "2026-09-09T08:30:00Z",
      },
      {
        id: "EV-2",
        title: "Source reçue",
        detail: "Communiqué_SIMULIA_wave6.docx attend une validation.",
        time: "2026-09-09T08:40:00Z",
      },
      {
        id: "EV-3",
        title: "Rôle Lecteur ajouté",
        detail: "Marc Petit · accès au domaine.",
        admin: true,
        time: "2026-09-09T08:45:00Z",
      },
    ],
    members: [
      { name: "Claire Lemoine", role: "owner" },
      { name: "Nadia Martin", role: "corpus_manager" },
      { name: "Marc Petit", role: "viewer" },
    ],
  };
}
function read(): State {
  try {
    const x = JSON.parse(localStorage.getItem(key) || "null");
    if (
      x?.schema === 1 &&
      Array.isArray(x.proposals) &&
      Array.isArray(x.sources) &&
      Array.isArray(x.events) &&
      Array.isArray(x.concepts) &&
      Array.isArray(x.members) &&
      Array.isArray(x.signals)
    )
      return x;
  } catch {}
  return seed();
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class MockGateway {
  private state: State;
  private delay: number;
  private storage: boolean;
  role: Role = "owner";
  offline = false;
  failPublication = false;
  constructor(
    options: { state?: State; delay?: number; storage?: boolean } = {},
  ) {
    this.storage = options.storage ?? true;
    this.state = options.state ?? read();
    this.delay = options.delay ?? 220;
  }
  private save() {
    this.state.revision++;
    if (this.storage) localStorage.setItem(key, JSON.stringify(this.state));
  }
  private log(title: string, detail: string, admin = false) {
    this.state.events.unshift({
      id: crypto.randomUUID(),
      title,
      detail,
      admin,
      time: new Date().toISOString(),
    });
  }
  private allow(kind: "govern" | "contribute" | "admin") {
    if (this.role === "viewer" || (kind === "admin" && this.role !== "owner"))
      throw new MockError(403, "Votre rôle ne permet pas cette action.");
  }
  private async ready() {
    await pause(this.delay);
    if (this.offline)
      throw new MockError(
        503,
        "Service simulé indisponible. Désactivez le scénario « Hors ligne » pour réessayer.",
      );
    this.tick();
  }
  private tick() {
    let dirty = false;
    for (const p of this.state.proposals) {
      if (p.status === "publishing" && (p.readyAt ?? Infinity) <= Date.now()) {
        dirty = true;
        if (p.fail) {
          p.status = "approved";
          p.error =
            "Publication en échec à l’étape index (DG-7f3a). Le savoir publié reste inchangé.";
          this.log("Échec de publication", p.id + " · DG-7f3a");
        } else {
          p.status = "published";
          this.state.version = p.base + 1;
          const c = this.state.concepts.find((c) => c.id === p.concept);
          if (c) {
            c.relations = p.after.split(",").map((x) => x.trim());
            c.source = p.source;
          } else {
            this.state.concepts.push({
              id: p.concept,
              name: p.newConcept?.name ?? p.title,
              description: p.newConcept?.description ?? p.after,
              relations: p.newConcept ? [p.target] : [],
              source: p.source,
            });
          }
          const source = this.state.sources.find((s) => s.id === p.source);
          if (source) source.status = "published";
          this.log(
            "Publication v" + this.state.version,
            p.title + " · " + p.receipt,
          );
        }
      }
    }
    for (const s of this.state.sources) {
      if (s.status === "processing" && (s.readyAt ?? Infinity) <= Date.now()) {
        s.status = "ready";
        dirty = true;
        this.log(
          "Import terminé",
          s.name + " · texte disponible, proposition à créer",
        );
      }
    }
    if (dirty) this.save();
  }
  async get(): Promise<State> {
    await this.ready();
    const x = structuredClone(this.state);
    if (this.role !== "owner") x.events = x.events.filter((e) => !e.admin);
    if (this.role !== "owner") x.members = [];
    return x;
  }
  async decide(
    id: string,
    action: "approve" | "reject" | "defer",
    reason: string,
    base: number,
  ) {
    await this.ready();
    this.allow("govern");
    const p = this.state.proposals.find((x) => x.id === id);
    if (!p) throw new MockError(404, "Proposition introuvable.");
    if (p.status !== "ready")
      throw new MockError(409, "Cette proposition a déjà été examinée.");
    if (!reason.trim()) throw new MockError(422, "Une raison est requise.");
    if (base !== p.base || base !== this.state.accepted)
      throw new MockError(
        409,
        "Le savoir a changé depuis cette proposition. Révisez-la avant de décider.",
      );
    p.reason = reason.trim();
    p.status =
      action === "approve"
        ? "approved"
        : action === "reject"
          ? "rejected"
          : "deferred";
    if (action === "approve") this.state.accepted++;
    p.receipt = "RC-" + crypto.randomUUID().slice(0, 8);
    this.log(
      action === "approve"
        ? "Proposition approuvée"
        : action === "reject"
          ? "Proposition rejetée"
          : "Proposition différée",
      p.title + " · " + reason,
    );
    this.save();
    return structuredClone(p);
  }
  async revise(id: string) {
    await this.ready();
    this.allow("govern");
    const p = this.state.proposals.find((x) => x.id === id);
    if (!p || p.status !== "ready")
      throw new MockError(409, "Révision indisponible.");
    p.base = this.state.accepted;
    const c = this.state.concepts.find((c) => c.id === p.concept);
    if (c) p.before = c.relations.join(", ");
    this.log("Proposition révisée", p.title + " · base v" + p.base);
    this.save();
  }
  async publish(id: string, expected: number) {
    await this.ready();
    this.allow("govern");
    const p = this.state.proposals.find((x) => x.id === id);
    if (!p || p.status !== "approved")
      throw new MockError(409, "Approuvez la proposition avant de publier.");
    if (expected !== this.state.version || p.base !== this.state.version)
      throw new MockError(
        409,
        "Une autre version doit être publiée avant celle-ci.",
      );
    p.status = "publishing";
    p.readyAt = Date.now() + 2200;
    p.fail = this.failPublication;
    this.failPublication = false;
    p.error = undefined;
    this.log("Publication demandée", p.title);
    this.save();
  }
  async correction(
    concept: string,
    target: string,
    reason: string,
    source = "SRC-001",
    previous?: string,
  ) {
    await this.ready();
    this.allow("contribute");
    if (!target.trim() || !reason.trim())
      throw new MockError(422, "La cible et la raison sont requises.");
    return this.makeProposal(
      concept,
      target.trim(),
      reason.trim(),
      source,
      previous,
    );
  }
  private makeProposal(
    concept: string,
    target: string,
    reason: string,
    source: string,
    previous?: string,
  ) {
    const c = this.state.concepts.find((x) => x.id === concept);
    const id =
      "PR-" +
      (3090 +
        this.state.proposals.filter((x) => Number(x.id.slice(3)) >= 3090)
          .length);
    const before = c?.relations.join(", ") ?? "Aucun concept publié";
    this.state.proposals.push({
      id,
      concept,
      title: (c?.name ?? concept) + " — correction proposée",
      before,
      after: c
        ? [
            ...c.relations.filter((x) => x !== target && x !== previous),
            target,
          ].join(", ")
        : target,
      target,
      source,
      status: "ready",
      base: this.state.accepted,
      reason,
    });
    this.log("Correction proposée", id + " · " + reason);
    this.save();
    return id;
  }
  async handleSignal(
    id: string,
    action: "corrected" | "done" | "ignored",
    reason: string,
    draft?: { concept: string; target: string; source: string },
  ) {
    await this.ready();
    this.allow("contribute");
    const s = this.state.signals.find((x) => x.id === id);
    if (!s || s.status !== "open")
      throw new MockError(409, "Ce signal a déjà été traité.");
    if (!reason.trim())
      throw new MockError(422, "Précisez la raison du traitement.");
    if (action === "corrected") {
      if (
        !draft?.target.trim() ||
        !this.state.concepts.some((c) => c.id === draft.concept) ||
        !this.state.sources.some(
          (x) =>
            x.id === draft.source && x.text.trim() && x.status !== "refused",
        )
      )
        throw new MockError(
          422,
          "Choisissez un concept, une cible et une preuve exploitable.",
        );
      s.proposal = this.makeProposal(
        draft.concept,
        draft.target.trim(),
        reason,
        draft.source,
      );
    }
    s.status = action;
    this.log(
      "Signal " +
        (action === "corrected"
          ? "lié à une correction"
          : action === "done"
            ? "traité"
            : "ignoré"),
      s.title + " · " + reason,
    );
    this.save();
    return s.proposal;
  }
  async feedback(
    question: string,
    answer: string,
    rating: "helpful" | "unhelpful",
    comment: string,
    version: number,
  ) {
    await this.ready();
    this.state.signals.unshift({
      id: "SIG-" + crypto.randomUUID().slice(0, 8),
      title: question.slice(0, 65),
      question,
      answer,
      comment: comment.trim() || "Retour explicite depuis la conversation.",
      rating,
      status: "open",
      version,
    });
    this.log(
      "Retour utilisateur",
      rating === "helpful" ? "Réponse utile" : "Réponse à améliorer",
    );
    this.save();
  }
  async importFile(file: File) {
    await this.ready();
    this.allow("contribute");
    const id = "SRC-" + crypto.randomUUID().slice(0, 8);
    const supported = /\.(txt|md)$/i.test(file.name);
    let text = "";
    let error =
      file.size > 500000
        ? "Fichier trop volumineux (maximum 500 Ko)."
        : !supported
          ? "Le mock accepte TXT et Markdown. Le parsing PDF/DOCX sera assuré par le backend."
          : undefined;
    if (!error) {
      text = await file.text();
      if (!text.trim() || text.includes("\u0000"))
        error = "Aucun texte exploitable.";
    }
    this.state.sources.unshift({
      id,
      name: file.name,
      text: error ? "" : text,
      status: error ? "refused" : "processing",
      error,
      readyAt: Date.now() + 1800,
    });
    this.log(
      error ? "Import refusé" : "Import démarré",
      file.name + (error ? " · " + error : ""),
    );
    this.save();
    return id;
  }
  async sourceProposal(
    id: string,
    draft: {
      name: string;
      description: string;
      target: string;
      reason: string;
    },
  ) {
    await this.ready();
    this.allow("contribute");
    const s = this.state.sources.find((x) => x.id === id);
    if (!s || s.status !== "ready" || s.proposal)
      throw new MockError(
        409,
        "Source indisponible ou proposition déjà créée.",
      );
    if (
      !draft.name.trim() ||
      !draft.description.trim() ||
      !draft.target.trim() ||
      !draft.reason.trim()
    )
      throw new MockError(
        422,
        "Complétez le concept, sa description, sa relation et la justification.",
      );
    const conceptId = "concept-" + crypto.randomUUID();
    s.proposal = this.makeProposal(
      conceptId,
      draft.target.trim(),
      draft.reason.trim(),
      s.id,
    );
    const proposal = this.state.proposals.find((p) => p.id === s.proposal)!;
    proposal.title = draft.name.trim() + " — nouveau concept";
    proposal.newConcept = {
      name: draft.name.trim(),
      description: draft.description.trim(),
    };
    proposal.after =
      draft.description.trim() + "\nComprend : " + draft.target.trim();
    s.status = "pending";
    this.save();
    return s.proposal;
  }
  async member(name: string, role: Role, reason: string) {
    await this.ready();
    this.allow("admin");
    if (!reason.trim()) throw new MockError(422, "Une raison est requise.");
    const m = this.state.members.find((x) => x.name === name);
    if (!m) throw new MockError(404, "Membre introuvable.");
    if (name === "Claire Lemoine")
      throw new MockError(
        409,
        "La propriétaire de la démonstration doit être conservée.",
      );
    m.role = role;
    this.log(
      "Rôle modifié",
      name + " · " + roleLabels[role] + " · " + reason,
      true,
    );
    this.save();
  }
  reset() {
    this.state = seed();
    this.offline = false;
    this.failPublication = false;
    this.save();
  }
}
export const gateway = new MockGateway();
