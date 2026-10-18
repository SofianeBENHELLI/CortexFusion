import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Layers } from "lucide-react";
import { CortexApi } from "../api/client";
import { readOverviewPage } from "./api-overview";
import "./brain.css";
const number = (n: number) => n.toLocaleString("fr-FR");
export function ApiBrainOverview({
  api,
  page,
  onPage,
  onDomain,
}: {
  api: CortexApi;
  page: number;
  onPage: (n: number) => void;
  onDomain: (id: string) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedRead = useRef<string | null>(null);
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["api", "brain-overview", page, refresh],
    retry: false,
    queryFn: ({ signal }) => readOverviewPage(api, page, signal),
  });
  useEffect(() => {
    if (query.data && !query.isFetching && !query.error) {
      cache.setQueryData(["api", "identity"], query.data.identity);
      if (query.data.page !== page) onPage(query.data.page);
      else if (focusedRead.current !== `${page}:${refresh}`) {
        focusedRead.current = `${page}:${refresh}`;
        heading.current?.focus();
      }
    }
  }, [query.data, query.isFetching, query.error, cache, page, refresh, onPage]);
  const data = query.data;
  return (
    <section
      className="brain-workspace brain-overview"
      aria-label="BrainMap des domaines"
    >
      <header className="brain-header">
        <div>
          <span className="brain-eyebrow">BrainMap · vue d’ensemble</span>
          <h1 ref={heading} tabIndex={-1}>
            Les territoires du savoir.
          </h1>
          <p>Choisissez un domaine pour explorer sa carte et sa Chronique.</p>
        </div>
        <button
          disabled={query.isFetching}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Actualiser les domaines
        </button>
      </header>
      {query.isFetching ? (
        <p className="brain-overview-message" role="status">
          Lecture des domaines et vérification de vos accès…
        </p>
      ) : query.error ? (
        <div className="brain-overview-message" role="alert">
          <p>{query.error.message}</p>
          <p>
            La lecture précédente est masquée. Actualisez pour relire les
            domaines accessibles.
          </p>
        </div>
      ) : (
        data && (
          <>
            <div
              className="brain-metrics"
              role="group"
              aria-label="Stocks des domaines de cette page"
            >
              <div>
                <span>Domaines de cette page</span>
                <strong>{data.rows.length}</strong>
                <small>
                  sur {number(data.identity.domains.length)} accessibles
                </small>
              </div>
              <div>
                <span>Concepts publiés</span>
                <strong>
                  {data.totals ? number(data.totals.concepts) : "—"}
                </strong>
                <small>
                  {data.totals
                    ? "dans les domaines de cette page"
                    : "total indisponible : lecture incomplète"}
                </small>
              </div>
              <div>
                <span>Relations publiées</span>
                <strong>
                  {data.totals ? number(data.totals.relations) : "—"}
                </strong>
                <small>
                  {data.totals
                    ? "internes à ces domaines"
                    : "total indisponible : lecture incomplète"}
                </small>
              </div>
            </div>
            {!data.rows.length ? (
              <div className="brain-empty">
                <Layers size={26} />
                <h2>Aucun domaine accessible</h2>
                <p>Cette identité ne dispose actuellement d’aucun domaine.</p>
              </div>
            ) : (
              <div className="brain-domain-grid">
                {data.rows.map(({ domain, stock, error }) => (
                  <article className="brain-domain-card" key={domain.id}>
                    <div className="brain-domain-top">
                      <span className="brain-eyebrow">
                        Domaine · {domain.role}
                      </span>
                      <Layers size={18} />
                    </div>
                    <h2>{domain.name}</h2>
                    {stock ? (
                      <>
                        <span className="brain-domain-version">
                          Savoir publié v{stock.version}
                        </span>
                        <dl>
                          <div>
                            <dt>Concepts publiés</dt>
                            <dd>{number(stock.concepts)}</dd>
                          </div>
                          <div>
                            <dt>Relations publiées</dt>
                            <dd>{number(stock.relations)}</dd>
                          </div>
                        </dl>
                        <small>
                          Lu à{" "}
                          {new Date(stock.observedAt).toLocaleTimeString(
                            "fr-FR",
                          )}
                        </small>
                      </>
                    ) : (
                      <div className="brain-domain-unavailable">
                        <strong>Lecture indisponible</strong>
                        <p>{error}</p>
                      </div>
                    )}
                    <button
                      onClick={() => onDomain(domain.id)}
                      aria-label={`Explorer ${domain.name}`}
                    >
                      <span>Explorer le domaine</span>
                      <ArrowUpRight size={16} />
                    </button>
                  </article>
                ))}
              </div>
            )}
            <footer className="brain-overview-footer">
              <p>
                Chaque domaine conserve sa propre version. Les stocks sont lus
                séparément ; ils ne forment pas un instantané global. Les
                relations entre domaines ne sont pas disponibles dans cette vue.
              </p>
              <nav aria-label="Pages des domaines">
                <button
                  disabled={!data.page}
                  onClick={() => onPage(data.page - 1)}
                >
                  Domaines précédents
                </button>
                <span>
                  Page {data.page + 1} / {data.pages}
                </span>
                <button
                  disabled={data.page + 1 >= data.pages}
                  onClick={() => onPage(data.page + 1)}
                >
                  Domaines suivants
                </button>
              </nav>
            </footer>
          </>
        )
      )}
    </section>
  );
}
