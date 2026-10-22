import { operations, type Operations } from "./operations";
import { uuid } from "./uuid";

export interface BearerSession {
  kind?: "bearer";
  token: string;
  tenant: string;
}
export interface CookieSession {
  kind: "cookie";
  csrfToken: string;
}
export type Session = BearerSession | CookieSession;
/** Mutable budget shared only by the requests belonging to one bounded read. */
export interface ResponseBudget {
  remainingBytes: number;
}
// Only these reviewed codes may refine a public error. Never display server text.
const publicErrors: Record<string, { status: number; message: string }> = {
  AMBIGUOUS_EXCERPT: {
    status: 422,
    message:
      "Ce passage apparaît plusieurs fois. Sélectionnez son occurrence dans la source ou indiquez sa position Unicode.",
  },
  SCENE_CAPACITY_EXCEEDED: {
    status: 422,
    message:
      "Cette zone dépasse son budget de lecture. Zoomez ou précisez la recherche.",
  },
  MAP_CAPACITY_EXCEEDED: {
    status: 422,
    message:
      "La carte dépasse son budget de lecture global (10 000 concepts ou 8 Mo). Une lecture par zones reste à construire pour ce volume.",
  },
  REQUEST_REJECTED: {
    status: 403,
    message:
      "La vérification de la session navigateur a échoué. Rouvrez l’espace avant de préparer une nouvelle action. Aucun réessai automatique.",
  },
  ORIGIN_NOT_ALLOWED: {
    status: 403,
    message:
      "Cette adresse de la console n’est pas autorisée par le serveur. Utilisez l’adresse prévue pour cet environnement.",
  },
  CORRECTION_NOT_PUBLISHED: {
    status: 409,
    message:
      "La correction liée n’est pas encore publiée. Le ticket reste ouvert jusqu’à sa publication ou à une nouvelle décision explicite.",
  },
  CORRECTION_NOT_ACTIVE: {
    status: 409,
    message:
      "La proposition corrective liée n’est plus active. Vérifiez son état avant de traiter le ticket.",
  },
  REQUEST_TIMEOUT: {
    status: 503,
    message:
      "Le serveur ne répond pas à temps. Le résultat d’une action peut être incertain.",
  },
};
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(
      publicErrors[code]?.status === status
        ? publicErrors[code].message
        : code === "read_limit"
          ? "Cette lecture dépasse le budget de données. Réduisez la période ou la profondeur du journal."
          : status === 401
            ? "Session absente ou expirée. Reconnectez-vous."
            : status === 403
              ? "Votre rôle ne permet pas cette action."
              : status === 404
                ? "Élément absent ou inaccessible."
                : status === 409
                  ? "Les données ont changé. Actualisez avant de décider."
                  : status === 429
                    ? "Limite atteinte. Réessayez plus tard."
                    : status === 422
                      ? "Les données envoyées sont invalides."
                      : code === "timeout"
                        ? "Le serveur ne répond pas à temps. Le résultat d’une action peut être incertain."
                        : code === "invalid_response"
                          ? "Réponse du serveur incompatible avec le contrat attendu."
                          : "Connexion au serveur indisponible. Aucun résultat n’est confirmé.",
    );
    this.name = "ApiError";
  }
}
export async function boundedJson(
  response: Response,
  controller: AbortController,
  maximum: number,
  budget?: ResponseBudget,
) {
  const exceeded = () => {
    controller.abort();
    if (response.body && !response.body.locked)
      void response.body.cancel().catch(() => {});
    return new ApiError(0, "read_limit");
  };
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    (budget &&
      (!Number.isSafeInteger(budget.remainingBytes) ||
        budget.remainingBytes < 0))
  )
    throw exceeded();
  const declared = Number(response.headers.get("content-length"));
  if (declared > maximum || (budget && declared > budget.remainingBytes))
    throw exceeded();
  if (!response.body) throw new ApiError(response.status, "invalid_response");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  controller.signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      if (controller.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (controller.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      if (done) break;
      bytes += value.byteLength;
      if (budget) budget.remainingBytes -= value.byteLength;
      if (bytes > maximum || (budget && budget.remainingBytes < 0))
        throw exceeded();
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(""));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    controller.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
/** Same-origin transport. No credential persistence, redirects, fallback or automatic mutation retry. */
export class CortexApi {
  constructor(
    private readonly session: () => Session | null,
    private readonly transport: typeof fetch = fetch,
    private readonly onUnauthorized?: () => void,
  ) {}
  async call<K extends keyof Operations>(
    operation: K,
    params: Operations[K]["params"],
    body: Operations[K]["body"],
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      maxResponseBytes?: number;
      responseBudget?: ResponseBudget;
      query?: {
        q?: string;
        after?: string | number;
        limit?: number;
        active_only?: boolean;
        assigned_to_me?: boolean;
        scope?: "mine" | "team" | "assigned" | "domain";
        before?: number | string;
        at_version?: number;
        expected_revision?: number;
        visibility?: string;
        focus?: string;
        locate?: string;
        direction?: "both" | "outgoing" | "in" | "out";
        layout?: string;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        offset?: number;
        kind?: string;
        search?: string;
        since?: string;
        until?: string;
      };
    } = {},
  ): Promise<Operations[K]["response"]> {
    const session = this.session();
    if (
      !session ||
      (session.kind === "cookie"
        ? !/^[A-Za-z0-9_-]{43}$/.test(session.csrfToken)
        : !session.token.trim() || !uuid.test(session.tenant))
    )
      throw new ApiError(401, "invalid_session");
    const route = operations[operation];
    const path = route.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
      const value = (params as Record<string, string>)[key];
      if (operation === "agent_missions.evidence" && key === "index") {
        if (!/^(?:[1-9]|10)$/.test(value ?? ""))
          throw new ApiError(422, "invalid_identifier");
        return value;
      }
      if (
        !uuid.test(value ?? "") &&
        !(
          key === "draft_key" &&
          value === "new" &&
          (operation === "drafts.read" || operation === "drafts.save")
        )
      )
        throw new ApiError(422, "invalid_identifier");
      return encodeURIComponent(value);
    });
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? 30000);
    try {
      const search = new URLSearchParams(
        Object.entries(options.query ?? {}).map(([key, value]) => [
          key,
          String(value),
        ]),
      );
      // Native fetch must not receive this CortexApi instance as its receiver.
      const transport = this.transport;
      const response = await transport(
        `/api${path}${search.size ? `?${search}` : ""}`,
        {
          method: route.method,
          credentials: session.kind === "cookie" ? "same-origin" : "omit",
          redirect: "error",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            ...(session.kind === "cookie"
              ? route.method === "POST"
                ? { "X-Cortex-CSRF": session.csrfToken }
                : {}
              : {
                  Authorization: `Bearer ${session.token}`,
                  "x-tenant-id": session.tenant,
                }),
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (session.kind === "cookie" && this.session() !== session)
        throw new ApiError(0, "session_changed");
      if (!response.ok) {
        if (response.status === 401 && session.kind === "cookie")
          this.onUnauthorized?.();
        let code = `http_${response.status}`;
        if (
          [403, 409, 422, 503].includes(response.status) &&
          response.headers.get("content-type")?.includes("application/json")
        ) {
          try {
            const payload = await boundedJson(response, controller, 8192);
            if (
              typeof payload?.error === "string" &&
              publicErrors[payload.error]?.status === response.status
            )
              code = payload.error;
          } catch {
            // Malformed or oversized error bodies keep the safe HTTP fallback.
          }
        }
        throw new ApiError(response.status, code);
      }
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new ApiError(response.status, "invalid_response");
      try {
        const result = (
          options.maxResponseBytes !== undefined
            ? await boundedJson(
                response,
                controller,
                options.maxResponseBytes,
                options.responseBudget,
              )
            : await response.json()
        ) as Operations[K]["response"];
        if (session.kind === "cookie" && this.session() !== session)
          throw new ApiError(0, "session_changed");
        return result;
      } catch (error) {
        if (error instanceof ApiError || controller.signal.aborted) throw error;
        throw new ApiError(response.status, "invalid_response");
      }
    } catch (error) {
      if (options.signal?.aborted)
        throw (
          options.signal.reason ?? new DOMException("Aborted", "AbortError")
        );
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, timedOut ? "timeout" : "network_error");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
