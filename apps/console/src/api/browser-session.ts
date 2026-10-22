import { ApiError, boundedJson, type CookieSession } from "./client";
import { validateIdentity } from "./identity";
import { isUuid } from "./uuid";

export interface BrowserSession extends CookieSession {
  expiresAt: number;
  identityStamp: string;
}

/** Public session metadata only; never an API bearer or cookie. */
export async function browserSessionRequest(
  csrf: string | undefined,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<BrowserSession | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 10000);
  try {
    if (csrf !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(csrf))
      throw new ApiError(401, "invalid_session");
    const request = async (): Promise<BrowserSession | null> => {
      if (controller.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      const response = await transport(
        csrf === undefined ? "/auth/session" : "/auth/logout",
        {
          method: csrf === undefined ? "GET" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: {
            Accept: "application/json",
            ...(csrf === undefined ? {} : { "X-Cortex-CSRF": csrf }),
          },
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      if (
        response.status === 401 ||
        (csrf !== undefined && response.status === 204)
      )
        return null;
      if (!response.ok)
        throw new ApiError(response.status, "session_unavailable");
      if (
        csrf !== undefined ||
        response.headers.get("content-type")?.split(";")[0] !==
          "application/json"
      )
        throw new ApiError(200, "invalid_response");
      const value = await boundedJson(response, controller, 73728);
      if (
        !value ||
        value.authenticated !== true ||
        Object.keys(value).sort().join(",") !==
          "authenticated,csrf_token,expires_at,identity" ||
        typeof value.csrf_token !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.csrf_token) ||
        typeof value.expires_at !== "number" ||
        !Number.isFinite(value.expires_at) ||
        value.expires_at * 1000 <= Date.now() ||
        value.expires_at * 1000 > Date.now() + 86400000
      )
        throw new ApiError(200, "invalid_response");
      const identity = validateIdentity(value.identity);
      return {
        kind: "cookie",
        csrfToken: value.csrf_token,
        expiresAt: value.expires_at * 1000,
        identityStamp: JSON.stringify([
          identity.tenant_id,
          identity.subject,
          identity.domains
            .map((d) => [
              d.id,
              d.name,
              d.role,
              [...(d.roles ?? [d.role])].sort(),
              d.membership_revision ?? null,
              [...d.capabilities].sort(),
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ]),
      };
    };
    // Same-origin tabs share the cookie jar. Serialize restoration through receipt
    // validation so a second tab sees the cookie installed by the first response.
    // This lock never wraps or retries a business command and carries no credentials.
    if (typeof navigator !== "undefined" && navigator.locks?.request)
      return await navigator.locks.request(
        "openbrain.browser-session.v1",
        { mode: "exclusive", signal: controller.signal },
        request,
      );
    return await request();
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      controller.signal.aborted ? "timeout" : "invalid_response",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

const choices: Record<string, string[]> = {
  api_view: ["brain", "work", "overview"],
  api_dossier: [
    "cases",
    "tasks",
    "sources",
    "issues",
    "proposals",
    "imports",
    "references",
    "referenceReviews",
    "missions",
  ],
  colors: ["1"],
  map_changes: ["1"],
  mode: ["overview", "changes"],
  map_transport: ["viewport"],
  history_pages: ["1", "5"],
};
function validEvent(value: string, domain: string | null): boolean {
  try {
    const e = JSON.parse(value);
    if (
      !Array.isArray(e) ||
      e.length !== 5 ||
      !isUuid(e[0]) ||
      e[0] !== domain ||
      !Number.isSafeInteger(e[1]) ||
      e[1] < 0 ||
      !isUuid(e[2]) ||
      typeof e[3] !== "string"
    )
      return false;
    if (
      ["concept_created", "concept_updated", "concept_removed"].includes(e[3])
    )
      return e[4] === "";
    if (
      ![
        "relation_created",
        "relation_removed",
        "relation_strengthened",
        "relation_weakened",
        "relation_primary_changed",
      ].includes(e[3]) ||
      typeof e[4] !== "string"
    )
      return false;
    const r = JSON.parse(e[4]);
    return (
      Array.isArray(r) &&
      r.length === 4 &&
      r[0] === domain &&
      r[1] === e[2] &&
      isUuid(r[2]) &&
      ["structural", "associative"].includes(r[3])
    );
  } catch {
    return false;
  }
}
/** Drop text/unknown/ambiguous parameters before making an auth URL. Server revalidates. */
export function loginLocation(params: URLSearchParams): string {
  const safe = new URLSearchParams();
  for (const [key, value] of params) {
    if (params.getAll(key).length !== 1) continue;
    const valid = [
      "api_domain",
      "api_conversation",
      "api_import",
      "api_proposal",
      "api_task",
      "api_case",
      "map_node",
    ].includes(key)
      ? isUuid(value)
      : Object.hasOwn(choices, key)
        ? choices[key].includes(value)
        : key === "domains_page"
          ? /^[1-9][0-9]{0,3}$/.test(value)
          : ["time_from", "time_to"].includes(key)
            ? /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
              Number.isFinite(Date.parse(value))
            : key === "map_event"
              ? validEvent(value, params.get("api_domain"))
              : false;
    if (valid) safe.set(key, value);
  }
  if (!safe.has("api_domain"))
    for (const key of [
      "api_conversation",
      "api_import",
      "api_proposal",
      "api_task",
      "api_case",
      "map_node",
      "map_event",
    ])
      safe.delete(key);
  const route = safe.size ? `/?${safe}` : "/";
  return `/auth/login?${new URLSearchParams({ return_to: route.length <= 2048 ? route : "/" })}`;
}
