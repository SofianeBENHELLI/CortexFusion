import {
  clearMissionRecovery,
  readMissionRecovery,
} from "./missionRecoveryStore";
import { clearReviewRecovery, readReviewRecovery } from "./reviewRecoveryStore";
import {
  clearReferenceRecovery,
  readReferenceRecovery,
} from "./referenceRecoveryStore";
import { clearTaskRecovery, readTaskRecovery } from "./taskRecoveryStore";
import { useExitRequest } from "./PendingWorkBoundary";
import {
  WorkspaceEntry,
  ResponsibilityHelp,
  responsibilityLabel,
} from "./WorkspaceEntry";
import { ActivityStatus } from "../ActivityStatus";
import { AsyncWorkspace } from "../AsyncWorkspace";
import { BrandName } from "../BrandName";
import {
  lazy,
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { validateIdentity } from "./identity";
import { domainViewParams } from "./navigation";
import {
  ApiError,
  CortexApi,
  type Session,
  type CookieSession,
} from "./client";
import { ThemeControl } from "../theme";

const ApiBrainOverview = lazy(() =>
  import("../brain/ApiBrainOverview").then((m) => ({
    default: m.ApiBrainOverview,
  })),
);
const SpatialBrainWorkspace = lazy(() =>
  import("../brain/SpatialBrainWorkspace").then((m) => ({
    default: m.SpatialBrainWorkspace,
  })),
);
const GovernanceWorkspace = lazy(() => import("./GovernanceWorkspace"));
const ProgressiveBrainWorkspace = lazy(() =>
  import("../brain/ProgressiveBrainWorkspace").then((m) => ({
    default: m.ProgressiveBrainWorkspace,
  })),
);

/** Initial real-mode boundary: verify identity and domain versions before wiring mutation journeys. */
export function ApiConnection({
  browserAuth,
  defaultDomain,
  localAccess = false,
}: {
  defaultDomain?: string;
  localAccess?: boolean;
  browserAuth?: {
    session: CookieSession;
    onExpired: () => void;
    onLogout: () => void;
  };
}) {
  const requestExit = useExitRequest();
  const session = useRef<Session | null>(browserAuth?.session ?? null);
  const browserBoundary = useRef(browserAuth);
  browserBoundary.current = browserAuth;
  const [api] = useState(
    () =>
      new CortexApi(
        () => session.current,
        fetch,
        () => browserBoundary.current?.onExpired(),
      ),
  );
  const [connected, setConnected] = useState(!!browserAuth);
  useLayoutEffect(() => {
    // StrictMode remounts effects. Restore only this mount's explicit session.
    // Install renewed credentials before the retained workspace is interactive.
    if (browserAuth) session.current = browserAuth.session;
    return () => {
      session.current = null;
    };
  }, [browserAuth?.session]);
  const [tenant, setTenant] = useState("");
  const [token, setToken] = useState("");
  const [params, setParams] = useSearchParams();
  const versionMessage = useRef<HTMLParagraphElement>(null);
  const retryDomain = useRef<string | null>(null);
  const domain = params.get("api_domain") ?? "";
  const view = params.get("api_view");
  const workspace = view === "brain" || view === "overview" ? view : "work";
  const BrainWorkspace =
    params.get("map_transport") === "viewport"
      ? ProgressiveBrainWorkspace
      : SpatialBrainWorkspace;
  const page = Number(params.get("domains_page") ?? 0);
  const chooseDomain = (
    id: string,
    target = workspace === "overview" ? "brain" : workspace,
  ) => {
    setParams(domainViewParams(params, id, target));
  };
  const setOverviewPage = useCallback(
    (n: number) => {
      const next = new URLSearchParams({ api_view: "overview" });
      if (n) next.set("domains_page", String(n));
      setParams(next);
    },
    [setParams],
  );
  const cache = useQueryClient();
  const identity = useQuery({
    queryKey: ["api", "identity"],
    enabled: connected,
    retry: false,
    queryFn: async ({ signal }) =>
      validateIdentity(
        await api.call("identity.read", {}, undefined, { signal }),
      ),
  });
  useEffect(() => {
    // A configured landing page is navigation, never an authorization grant.
    // Preserve explicit links and only enter a domain returned by native /me.
    if (
      connected &&
      defaultDomain &&
      !params.has("api_domain") &&
      !params.has("api_view") &&
      !identity.error &&
      identity.data?.domains.some((d) => d.id === defaultDomain)
    )
      setParams(domainViewParams(params, defaultDomain, "work"), {
        replace: true,
      });
  }, [
    connected,
    defaultDomain,
    identity.data,
    identity.error,
    params,
    setParams,
  ]);
  const version = useQuery({
    queryKey: ["api", "version", domain],
    enabled:
      connected &&
      workspace !== "overview" &&
      !!identity.data?.domains.some((d) => d.id === domain),
    retry: false,
    queryFn: async ({ signal }) => {
      const value = await api.call("domain.version", { domain }, undefined, {
        signal,
      });
      if (
        !value ||
        value.domain_id !== domain ||
        !Number.isInteger(value.accepted_version) ||
        !Number.isInteger(value.published_version)
      )
        throw new ApiError(200, "invalid_response");
      return value;
    },
  });
  useEffect(() => {
    if (!connected || retryDomain.current !== domain) {
      retryDomain.current = null;
      return;
    }
    if (version.isFetching || version.error || !version.data) return;
    retryDomain.current = null;
    versionMessage.current?.focus();
  }, [connected, domain, version.data, version.error, version.isFetching]);
  useEffect(() => {
    if (identity.data && !identity.error) {
      readReferenceRecovery(
        { tenant: identity.data.tenant_id, subject: identity.data.subject },
        Date.now(),
        true,
      );
      readMissionRecovery(
        { tenant: identity.data.tenant_id, subject: identity.data.subject },
        Date.now(),
        true,
      );
      readReviewRecovery(
        { tenant: identity.data.tenant_id, subject: identity.data.subject },
        Date.now(),
        true,
      );
      readTaskRecovery(
        { tenant: identity.data.tenant_id, subject: identity.data.subject },
        Date.now(),
        true,
      );
    }
  }, [identity.data, identity.error]);
  async function disconnect(preserveLocation = false) {
    if (!preserveLocation) {
      clearTaskRecovery();
      clearReferenceRecovery();
      clearMissionRecovery();
      clearReviewRecovery();
    }
    session.current = null;
    if (browserAuth) {
      if (preserveLocation) browserAuth.onExpired();
      else browserAuth.onLogout();
      return;
    }
    setConnected(false);
    // Reauthentication keeps only navigation, never credentials or cached data.
    if (!preserveLocation) setParams(new URLSearchParams());
    setToken("");
    await cache.cancelQueries({ queryKey: ["api"] });
    cache.removeQueries({ queryKey: ["api"] });
  }
  return (
    <main
      className={`api-connection ${connected && !domain && workspace !== "overview" ? "entry-active" : ""} ${connected && domain && workspace === "work" ? "work-active" : ""} ${connected && (workspace === "overview" || (domain && workspace === "brain")) ? "brain-active" : ""}`}
    >
      <div className="api-shell-bar">
        <span className="kicker">
          <BrandName />
          {!connected && " · Connexion au serveur"}
        </span>
        <ThemeControl />
        {connected && (
          <button onClick={() => requestExit(() => void disconnect())}>
            {localAccess ? "Fermer l’espace" : "Se déconnecter"}
          </button>
        )}
      </div>
      {!connected && (
        <>
          <h1>
            Votre espace <BrandName />
          </h1>
          <p>
            Interrogez le savoir publié de votre domaine et signalez les
            réponses à améliorer. Les brouillons ne sont pas utilisés pour
            répondre.
          </p>
        </>
      )}
      {!connected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            session.current = { tenant: tenant.trim(), token: token.trim() };
            setToken("");
            setConnected(true);
          }}
        >
          <label>
            Identifiant du tenant
            <input
              required
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              placeholder="UUID du tenant"
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            />
          </label>
          <label>
            <span>
              Jeton d’accès <BrandName />
            </span>
            <input
              required
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p>
            Utilisez un jeton utilisateur émis pour <BrandName />. Il reste en
            mémoire jusqu’à la déconnexion ou au rechargement de la page.
          </p>
          <button className="primary" type="submit" disabled={!token.trim()}>
            Se connecter
          </button>
        </form>
      ) : (
        <>
          {identity.isPending && (
            <ActivityStatus state="connecting">
              Vérification de vos accès…
            </ActivityStatus>
          )}
          {identity.error && (
            <div role="alert">
              <p>{identity.error.message}</p>
              {identity.error instanceof ApiError &&
              identity.error.status === 401 ? (
                <button onClick={() => void disconnect(true)}>
                  Se reconnecter
                </button>
              ) : (
                <button onClick={() => void identity.refetch()}>
                  Réessayer
                </button>
              )}
            </div>
          )}
          {identity.data && !identity.error && (
            <section>
              <div className="api-domain-context">
                <div>
                  <h2 className={workspace === "work" ? "sr-only" : undefined}>
                    Domaines accessibles
                  </h2>
                  <p>Connecté en tant que {identity.data.subject}</p>
                </div>
                {!identity.data.domains.length ? (
                  <p>Aucun domaine accessible avec cette identité.</p>
                ) : (
                  <label>
                    Domaine
                    <select
                      value={workspace === "overview" ? "" : domain}
                      onChange={(e) => chooseDomain(e.target.value)}
                    >
                      <option value="">Choisir un domaine</option>
                      {identity.data.domains.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} · {responsibilityLabel(d)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!domain && workspace !== "overview" && (
                  <button
                    disabled={identity.isFetching}
                    onClick={() => void identity.refetch()}
                  >
                    Actualiser mes accès
                  </button>
                )}
                <button
                  className="api-overview-entry"
                  aria-pressed={workspace === "overview"}
                  onClick={() =>
                    setOverviewPage(
                      Number.isSafeInteger(page) && page >= 0 ? page : 0,
                    )
                  }
                >
                  Vue d’ensemble BrainMap
                </button>
              </div>
              {workspace === "overview" ? (
                <AsyncWorkspace
                  name="Vue d’ensemble BrainMap"
                  resetKey="overview"
                >
                  <ApiBrainOverview
                    api={api}
                    page={Number.isSafeInteger(page) && page >= 0 ? page : 0}
                    onPage={setOverviewPage}
                    onDomain={(id) => chooseDomain(id, "brain")}
                  />
                </AsyncWorkspace>
              ) : domain &&
                !identity.data.domains.some((d) => d.id === domain) ? (
                <p role="alert">
                  Ce domaine n’est plus accessible avec cette identité.
                </p>
              ) : !domain ? (
                <WorkspaceEntry
                  domains={identity.data.domains}
                  localAccess={localAccess}
                  onOpen={(id) => chooseDomain(id, "work")}
                />
              ) : (
                domain && (
                  <>
                    <ResponsibilityHelp
                      key={domain}
                      domain={
                        identity.data.domains.find((d) => d.id === domain)!
                      }
                    />
                    {version.isPending && (
                      <ActivityStatus>Chargement des versions…</ActivityStatus>
                    )}
                    {version.error && (
                      <div role="alert">
                        <p>{version.error.message}</p>
                        <button
                          onClick={() => {
                            retryDomain.current = domain;
                            void version.refetch();
                          }}
                        >
                          Réessayer le chargement
                        </button>
                      </div>
                    )}
                    {version.data && !version.error && (
                      <>
                        <p
                          className="api-domain-version"
                          ref={versionMessage}
                          tabIndex={-1}
                        >
                          Savoir accepté : v{version.data.accepted_version} ·
                          Savoir publié : v{version.data.published_version}
                        </p>
                        <nav
                          className="api-workspace-nav"
                          aria-label="Espaces du domaine"
                        >
                          <button
                            aria-label="Cerveau"
                            aria-pressed={workspace === "brain"}
                            onClick={() => chooseDomain(domain, "brain")}
                          >
                            Explorer
                          </button>
                          <button
                            aria-label="Conversations et gouvernance"
                            aria-pressed={workspace === "work"}
                            onClick={() => chooseDomain(domain, "work")}
                          >
                            Conversation
                          </button>
                        </nav>
                        <AsyncWorkspace
                          name={
                            workspace === "brain"
                              ? "BrainMap et Chronique"
                              : "Conversations et gouvernance"
                          }
                          resetKey={`${workspace}:${domain}`}
                        >
                          {workspace === "brain" ? (
                            <BrainWorkspace
                              key={`brain-${domain}`}
                              api={api}
                              onReconnect={() => void disconnect(true)}
                              domain={domain}
                              name={
                                identity.data.domains.find(
                                  (d) => d.id === domain,
                                )?.name ?? "Domaine"
                              }
                              owner={
                                identity.data.domains.find(
                                  (d) => d.id === domain,
                                )?.role === "owner"
                              }
                            />
                          ) : (
                            <GovernanceWorkspace
                              recoveryScope={{
                                tenant: identity.data.tenant_id,
                                subject: identity.data.subject,
                              }}
                              capabilities={
                                identity.data.domains.find(
                                  (d) => d.id === domain,
                                )?.capabilities ?? []
                              }
                              key={domain}
                              api={api}
                              domain={domain}
                              onReconnect={() => void disconnect(true)}
                            />
                          )}
                        </AsyncWorkspace>
                      </>
                    )}
                  </>
                )
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
