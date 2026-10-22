import { clearMissionRecovery } from "./missionRecoveryStore";
import { clearReviewRecovery } from "./reviewRecoveryStore";
import { clearReferenceRecovery } from "./referenceRecoveryStore";
import { clearTaskRecovery } from "./taskRecoveryStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ThemeControl } from "../theme";
import { ApiConnection } from "./ApiConnection";
import { BrandName } from "../BrandName";
import { ActivityStatus } from "../ActivityStatus";
import {
  browserSessionRequest,
  loginLocation,
  type BrowserSession,
} from "./browser-session";

type State =
  | { kind: "checking" | "signed-out" | "expired" | "error" }
  | {
      kind: "ready" | "revalidating" | "logging-out" | "logout-error";
      session: BrowserSession;
    };

/** Explicit cookie mode. No token form, credential storage or automatic mutation replay. */
export function BrowserConnection({
  localAccess = import.meta.env.VITE_LOCAL_ACCESS === "1",
  defaultDomain = import.meta.env.VITE_LOCAL_DOMAIN,
}: { localAccess?: boolean; defaultDomain?: string } = {}) {
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<State>({ kind: "checking" });
  const current = useRef<State>(state);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const lastAutomaticRecovery = useRef<number>();
  const workspaceGeneration = useRef(0);
  const sessionChannel = useRef<BroadcastChannel>();
  const update = useCallback((next: State) => {
    current.current = next;
    setState(next);
  }, []);
  const purge = useCallback(() => {
    // Cancel and remove synchronously; a late former identity cannot seed the next one.
    void cache.cancelQueries({ queryKey: ["api"] });
    cache.removeQueries({ queryKey: ["api"] });
  }, [cache]);
  const expire = useCallback(() => {
    if (!mounted.current) return;
    operation.current?.abort();
    operation.current = null;
    update({ kind: "expired" });
    purge();
  }, [purge, update]);
  const restore = useCallback(async () => {
    const previous =
      current.current.kind === "ready" ? current.current.session : undefined;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    update(
      previous
        ? { kind: "revalidating", session: previous }
        : { kind: "checking" },
    );
    if (!previous) purge();
    try {
      const session = await browserSessionRequest(undefined, controller.signal);
      if (
        !mounted.current ||
        controller.signal.aborted ||
        operation.current !== controller
      )
        return;
      const unchanged =
        previous &&
        session &&
        previous.csrfToken === session.csrfToken &&
        previous.identityStamp === session.identityStamp &&
        previous.expiresAt === session.expiresAt;
      // A local grant can rotate credentials without changing the verified
      // person or permissions. Keep in-memory work only across that boundary.
      // identityStamp includes memberships, revisions and capabilities.
      const sameLocalIdentity =
        localAccess &&
        previous &&
        session &&
        previous.identityStamp === session.identityStamp;
      if (!unchanged && !sameLocalIdentity) {
        workspaceGeneration.current++;
        purge();
      }
      if (
        session &&
        !unchanged &&
        (!previous ||
          previous.csrfToken !== session.csrfToken ||
          previous.expiresAt !== session.expiresAt ||
          previous.identityStamp !== session.identityStamp)
      )
        sessionChannel.current?.postMessage({ type: "changed" });
      update(
        session
          ? { kind: "ready", session: unchanged ? previous : session }
          : { kind: "signed-out" },
      );
    } catch {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        operation.current === controller
      ) {
        purge();
        update({ kind: "error" });
      }
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }, [localAccess, purge, update]);
  const logout = useCallback(
    async (session: BrowserSession) => {
      clearTaskRecovery();
      clearReferenceRecovery();
      clearReviewRecovery();
      clearMissionRecovery();
      sessionChannel.current?.postMessage({ type: "closed" });
      operation.current?.abort();
      const controller = new AbortController();
      operation.current = controller;
      update({ kind: "logging-out", session });
      purge();
      try {
        await browserSessionRequest(session.csrfToken, controller.signal);
        if (
          !mounted.current ||
          controller.signal.aborted ||
          operation.current !== controller
        )
          return;
        update({ kind: "signed-out" });
        setParams(new URLSearchParams(), { replace: true });
      } catch {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          operation.current === controller
        )
          update({ kind: "logout-error", session });
      } finally {
        if (operation.current === controller) operation.current = null;
      }
    },
    [purge, setParams, update],
  );
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel("openbrain.browser-session.v1");
    } catch {
      return;
    }
    sessionChannel.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || Object.keys(message).length !== 1) return;
      if (message.type === "closed") {
        operation.current?.abort();
        operation.current = null;
        clearTaskRecovery();
        clearReferenceRecovery();
        clearReviewRecovery();
        clearMissionRecovery();
        purge();
        update({ kind: "signed-out" });
      } else if (
        message.type === "changed" &&
        current.current.kind === "ready" &&
        !operation.current
      ) {
        // Read authority from our own server; broadcasts never carry or grant it.
        void restore();
      }
    };
    return () => {
      channel.close();
      if (sessionChannel.current === channel)
        sessionChannel.current = undefined;
    };
  }, [purge, restore, update]);
  useEffect(() => {
    mounted.current = true;
    void restore();
    const focus = () => {
      if (current.current.kind === "ready" && !operation.current)
        void restore();
    };
    const hide = () => {
      // Do not retain a private screen in a restored back-forward-cache document.
      if (["ready", "revalidating"].includes(current.current.kind)) expire();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) void restore();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = null;
      purge();
      window.removeEventListener("focus", focus);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, [expire, purge, restore]);
  useEffect(() => {
    // An expired timestamp must not restart/abort an in-flight renewal.
    if (state.kind !== "ready") return;
    const timer = setTimeout(
      () => (localAccess ? void restore() : expire()),
      Math.max(0, state.session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state, expire, restore, localAccess]);

  if (state.kind === "ready" || state.kind === "revalidating") {
    const session = state.session;
    return (
      <>
        {state.kind === "revalidating" && (
          <ActivityStatus state="connecting">
            Vérification de votre connexion…
          </ActivityStatus>
        )}
        <div hidden={state.kind === "revalidating"}>
          <ApiConnection
            key={workspaceGeneration.current + session.identityStamp}
            defaultDomain={localAccess ? defaultDomain : undefined}
            localAccess={localAccess}
            browserAuth={{
              session,
              onExpired: () => {
                if (
                  (current.current.kind === "ready" ||
                    current.current.kind === "revalidating") &&
                  current.current.session === session
                ) {
                  // Local sessions may expire before a background tab's timer runs.
                  // Renew metadata once, never replay the failed business request.
                  // A backend repeatedly returning 401 must not create a login loop.
                  if (
                    localAccess &&
                    !operation.current &&
                    (lastAutomaticRecovery.current === undefined ||
                      Date.now() - lastAutomaticRecovery.current > 30000)
                  ) {
                    lastAutomaticRecovery.current = Date.now();
                    void restore();
                  } else if (!operation.current) expire();
                }
              },
              onLogout: () => void logout(session),
            }}
          />
        </div>
      </>
    );
  }
  return (
    <main className="api-connection">
      <div className="api-shell-bar">
        <span className="kicker">
          <BrandName />
        </span>
        <ThemeControl />
      </div>
      <h1>
        Votre espace <BrandName />
      </h1>
      {state.kind === "checking" ? (
        <ActivityStatus state="connecting">
          Vérification de votre connexion…
        </ActivityStatus>
      ) : state.kind === "logging-out" ? (
        <ActivityStatus state="connecting">
          Déconnexion en cours…
        </ActivityStatus>
      ) : state.kind === "logout-error" ? (
        <div role="alert">
          <p>
            La déconnexion n’a pas été confirmée. Vos données sont masquées ; la
            session peut rester active sur le serveur.
          </p>
          <button onClick={() => void logout(state.session)}>
            Réessayer la déconnexion
          </button>
          <button onClick={() => void restore()}>Vérifier la connexion</button>
        </div>
      ) : state.kind === "error" ? (
        <div role="alert">
          <p>
            Votre connexion n’a pas pu être vérifiée. Réessayez lorsque le
            service est disponible.
          </p>
          <button onClick={() => void restore()}>Réessayer la connexion</button>
        </div>
      ) : localAccess ? (
        <>
          <p>
            Votre espace local est fermé. Vous pouvez le rouvrir sans
            identifiant ni jeton.
          </p>
          <button className="primary" onClick={() => void restore()}>
            Ouvrir ma base de connaissances
          </button>
        </>
      ) : (
        <>
          <p role={state.kind === "expired" ? "alert" : undefined}>
            {state.kind === "expired"
              ? "Votre session a expiré ou a changé. Reconnectez-vous pour retrouver votre navigation."
              : "Connectez-vous avec votre compte pour retrouver les domaines auxquels vous avez accès."}
          </p>
          <a className="primary api-session-login" href={loginLocation(params)}>
            {state.kind === "expired" ? "Se reconnecter" : "Se connecter"}
          </a>
        </>
      )}
    </main>
  );
}
