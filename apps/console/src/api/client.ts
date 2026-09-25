import { operations, type Operations } from "./operations";

export interface Session {
  token: string;
  tenant: string;
}
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(
      status === 401
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
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same-origin transport. No credential persistence, redirects, fallback or automatic mutation retry. */
export class CortexApi {
  constructor(
    private readonly session: () => Session | null,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async call<K extends keyof Operations>(
    operation: K,
    params: Operations[K]["params"],
    body: Operations[K]["body"],
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      query?: { after?: string | number; limit?: number };
    } = {},
  ): Promise<Operations[K]["response"]> {
    const session = this.session();
    if (!session?.token.trim() || !uuid.test(session.tenant))
      throw new ApiError(401, "invalid_session");
    const route = operations[operation];
    const path = route.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
      const value = (params as Record<string, string>)[key];
      if (!uuid.test(value ?? ""))
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
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${session.token}`,
            "x-tenant-id": session.tenant,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new ApiError(response.status, `http_${response.status}`);
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new ApiError(response.status, "invalid_response");
      try {
        return (await response.json()) as Operations[K]["response"];
      } catch {
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
