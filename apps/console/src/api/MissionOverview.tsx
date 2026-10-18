import type { WorkMissionOverview as Overview } from "../../../../packages/contracts/src/WorkMissionOverview";
import { ApiError } from "./client";
import { workId } from "./workSelection";
const integer = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 0;
export function validateMissionOverview(g: Overview, at: string) {
  const bad = () => {
    throw new ApiError(200, "invalid_response");
  };
  if (
    !g ||
    ![g.total, g.waiting, g.claimed, g.expired, g.reports, g.withheld].every(
      integer,
    ) ||
    g.waiting + g.claimed + g.expired + g.reports !== g.total ||
    g.withheld > g.total ||
    g.sort !== "expired_report_created_id" ||
    !Array.isArray(g.items) ||
    g.items.length !== Math.min(5, g.total) ||
    g.has_more !== g.total > 5 ||
    new Set(g.items.map((i) => i?.id)).size !== g.items.length
  )
    bad();
  for (const i of g.items) {
    if (
      !i ||
      !workId(i.id) ||
      !["queued", "running", "completed"].includes(i.status) ||
      !integer(i.revision) ||
      i.revision < 1 ||
      !Number.isFinite(Date.parse(i.created_at)) ||
      Date.parse(i.created_at) > Date.parse(at) ||
      !Number.isFinite(Date.parse(i.expires_at)) ||
      Date.parse(i.expires_at) <= Date.parse(i.created_at) ||
      typeof i.expired !== "boolean" ||
      i.expired !== Date.parse(i.expires_at) <= Date.parse(at) ||
      typeof i.content_available !== "boolean" ||
      (i.content_available
        ? typeof i.title !== "string" ||
          !i.title.trim() ||
          Array.from(i.title).length > 200
        : i.title !== null) ||
      ![i.reads_used, i.chars_used, i.max_reads, i.max_chars].every(integer) ||
      i.max_reads < 1 ||
      i.max_reads > 100 ||
      i.max_chars < 1 ||
      i.max_chars > 100000 ||
      i.reads_used > i.max_reads ||
      i.chars_used > i.max_chars
    )
      bad();
    if (
      Object.keys(i).some(
        (k) =>
          ![
            "id",
            "title",
            "status",
            "revision",
            "created_at",
            "expires_at",
            "expired",
            "content_available",
            "reads_used",
            "chars_used",
            "max_reads",
            "max_chars",
          ].includes(k),
      )
    )
      bad();
  }
  const count = (test: (i: Overview["items"][number]) => boolean) =>
    g.items.filter(test).length;
  if (
    count((i) => !i.content_available) > g.withheld ||
    count((i) => i.status === "completed") > g.reports ||
    count((i) => i.status !== "completed" && i.expired) > g.expired ||
    count((i) => i.status === "queued" && !i.expired) > g.waiting ||
    count((i) => i.status === "running" && !i.expired) > g.claimed
  )
    bad();
  const rank = (i: Overview["items"][number]) =>
    i.status !== "completed" && i.expired
      ? 0
      : i.status === "completed"
        ? 1
        : 2;
  for (let n = 1; n < g.items.length; n++) {
    const a = g.items[n - 1],
      b = g.items[n];
    if (
      rank(a) > rank(b) ||
      (rank(a) === rank(b) &&
        (Date.parse(a.created_at) > Date.parse(b.created_at) ||
          (a.created_at === b.created_at && a.id.localeCompare(b.id) > 0)))
    )
      bad();
  }
  return g;
}
export function MissionOverview({
  group: g,
  onOpen,
  onAll,
}: {
  group: Overview;
  onOpen: (id: string, controlOnly: boolean) => void;
  onAll: () => void;
}) {
  return (
    <>
      <h4>Le suivi de vos missions</h4>
      <p>
        Vos mandats en attente, réclamés ou expirés et vos rapports candidats
        remis. Les missions arrêtées restent dans l’historique. Un rapport remis
        n’est ni approuvé ni nécessairement non lu.
      </p>
      <dl className="work-brief-counts">
        <div>
          <dt>En attente du service</dt>
          <dd>{g.waiting}</dd>
        </div>
        <div>
          <dt>Réclamées par le service</dt>
          <dd>{g.claimed}</dd>
        </div>
        <div>
          <dt>Mandats expirés</dt>
          <dd>{g.expired}</dd>
        </div>
        <div>
          <dt>Rapports candidats remis</dt>
          <dd>{g.reports}</dd>
        </div>
      </dl>
      <p>
        Un bail ou un état « réclamée » ne prouve pas qu’un worker est actif.
        Aucun modèle n’est lancé par ce brief.
      </p>
      {g.withheld > 0 && (
        <p>
          {g.withheld} missions avec contenu inaccessible : seules vos
          métadonnées de contrôle sont affichées.
        </p>
      )}
      {!g.total && (
        <p>
          Aucune mission non arrêtée à suivre dans ce domaine. Cela ne mesure ni
          la qualité ni la couverture du corpus.
        </p>
      )}
      <ol className="work-brief-list">
        {g.items.map((i) => {
          const title =
            i.title ??
            `Mission ${i.id.slice(0, 8)} créée le ${new Date(i.created_at).toLocaleString("fr-FR")}`;
          const expired = i.status !== "completed" && i.expired;
          const state =
            i.status === "completed"
              ? "Rapport candidat remis"
              : expired
                ? "Mandat expiré"
                : i.status === "queued"
                  ? "En attente du service"
                  : "Réclamée par le service";
          return (
            <li key={i.id}>
              <div>
                <strong>{title}</strong>
                <span>
                  {state} · révision {i.revision}
                </span>
              </div>
              <p>
                {!i.content_available
                  ? "Contenu inaccessible. Relisez le contrôle personnel pour décider d’un arrêt si la mission le permet."
                  : i.status === "completed"
                    ? "Relisez le rapport, ses hypothèses et ses preuves avant de décider de la suite."
                    : expired
                      ? "L’exécution n’est plus autorisée. Vous pouvez constater l’état et préparer un arrêt explicite."
                      : "Relisez la consommation et le journal. Arrêtez le mandat si sa poursuite n’est plus utile."}
              </p>
              <p className="work-brief-meta">
                Créée le {new Date(i.created_at).toLocaleString("fr-FR")} ·
                échéance {new Date(i.expires_at).toLocaleString("fr-FR")}
              </p>
              <p className="work-brief-meta">
                {i.reads_used}/{i.max_reads} lectures · {i.chars_used}/
                {i.max_chars} caractères. Ces budgets ne mesurent pas les autres
                accès du service.
              </p>
              <button onClick={() => onOpen(i.id, !i.content_available)}>
                {i.content_available
                  ? "Ouvrir la mission"
                  : "Ouvrir le contrôle sans contenu"}{" "}
                : {title}
              </button>
            </li>
          );
        })}
      </ol>
      <p>
        {g.items.length} missions présentées sur {g.total}. Expirées, puis
        rapports remis, puis autres mandats ; les plus anciennes d’abord dans
        chaque groupe.{" "}
        <button onClick={onAll}>Voir tous mes contrôles de mission</button>
      </p>
    </>
  );
}
