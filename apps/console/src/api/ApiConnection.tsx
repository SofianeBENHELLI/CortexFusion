import { IssueWorkspace } from "./IssueWorkspace";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IdentityView } from "../../../../packages/contracts/src/IdentityView";
import { ApiError, CortexApi, type Session } from "./client";
import { ProposalWorkspace } from "./ProposalWorkspace";
import { ConversationWorkspace } from "./ConversationWorkspace";

function validateIdentity(value: IdentityView): IdentityView {
  if (
    !value ||
    typeof value.subject !== "string" ||
    typeof value.tenant_id !== "string" ||
    !Array.isArray(value.domains) ||
    value.domains.some(
      (d) =>
        !d ||
        typeof d.id !== "string" ||
        typeof d.name !== "string" ||
        typeof d.role !== "string" ||
        !Array.isArray(d.capabilities) ||
        d.capabilities.some((c) => typeof c !== "string"),
    )
  )
    throw new ApiError(200, "invalid_response");
  return value;
}
/** Initial real-mode boundary: verify identity and domain versions before wiring mutation journeys. */
export function ApiConnection() {
  const session = useRef<Session | null>(null);
  const [api] = useState(() => new CortexApi(() => session.current));
  const [connected, setConnected] = useState(false);
  const [tenant, setTenant] = useState("");
  const [token, setToken] = useState("");
  const [domain, setDomain] = useState("");
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
  const version = useQuery({
    queryKey: ["api", "version", domain],
    enabled: connected && !!identity.data && !!domain,
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
  async function disconnect() {
    session.current = null;
    setConnected(false);
    setDomain("");
    setToken("");
    await cache.cancelQueries({ queryKey: ["api"] });
    cache.removeQueries({ queryKey: ["api"] });
  }
  return (
    <main className="api-connection">
      <span className="kicker">Cortex Fusion · Connexion au serveur</span>
      <h1>Votre espace Cortex</h1>
      <p>
        Interrogez le savoir publié de votre domaine et signalez les réponses à
        améliorer. Les brouillons ne sont pas utilisés pour répondre.
      </p>
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
            Jeton d’accès Cortex
            <input
              required
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p>
            Utilisez un jeton utilisateur émis pour Cortex. Il reste en mémoire
            jusqu’à la déconnexion ou au rechargement de la page.
          </p>
          <button className="primary" type="submit" disabled={!token.trim()}>
            Se connecter
          </button>
        </form>
      ) : (
        <>
          <button onClick={() => void disconnect()}>Se déconnecter</button>
          {identity.isPending && (
            <p role="status">Vérification de vos accès…</p>
          )}
          {identity.error && (
            <div role="alert">
              <p>{identity.error.message}</p>
              {identity.error instanceof ApiError &&
              identity.error.status === 401 ? (
                <button onClick={() => void disconnect()}>
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
              <h2>Domaines accessibles</h2>
              <p>Connecté en tant que {identity.data.subject}</p>
              {!identity.data.domains.length ? (
                <p>Aucun domaine accessible avec cette identité.</p>
              ) : (
                <label>
                  Domaine
                  <select
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                  >
                    <option value="">Choisir un domaine</option>
                    {identity.data.domains.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.role}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {domain && (
                <>
                  <p>
                    Rôle :{" "}
                    {identity.data.domains.find((d) => d.id === domain)?.role}
                  </p>
                  {version.isPending && (
                    <p role="status">Chargement des versions…</p>
                  )}
                  {version.error && (
                    <div role="alert">
                      <p>{version.error.message}</p>
                      <button onClick={() => void version.refetch()}>
                        Réessayer le chargement
                      </button>
                    </div>
                  )}
                  {version.data && !version.error && (
                    <>
                      <p>
                        Savoir accepté : v{version.data.accepted_version} ·
                        Savoir publié : v{version.data.published_version}
                      </p>
                      <IssueWorkspace
                        key={`issues-${domain}`}
                        api={api}
                        domain={domain}
                      />
                      <ProposalWorkspace
                        key={`proposals-${domain}`}
                        api={api}
                        domain={domain}
                      />
                      <ConversationWorkspace
                        key={domain}
                        api={api}
                        domain={domain}
                      />
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
