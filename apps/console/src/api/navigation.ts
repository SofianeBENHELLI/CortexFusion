import { uuid } from "./uuid";

/** Keep same-domain navigation; never add questions or credentials to the URL. */
export function domainViewParams(
  current: URLSearchParams,
  domain: string,
  view: string,
) {
  const next = new URLSearchParams(
    current.get("api_domain") === domain ? current : undefined,
  );
  if (domain) next.set("api_domain", domain);
  next.set("api_view", view);
  if (current.has("domains_page"))
    next.set("domains_page", current.get("domains_page")!);
  return next;
}

export function brainConceptHref(
  current: URLSearchParams,
  domain: string,
  concept?: string,
) {
  const next = domainViewParams(current, domain, "brain");
  if (concept) {
    next.set("map_node", concept);
    next.delete("map_event");
  }
  return `?${next}`;
}

export function proposalHref(
  current: URLSearchParams,
  domain: string,
  proposal: string,
) {
  const next = domainViewParams(current, domain, "work");
  next.set("api_proposal", proposal);
  return `?${next}`;
}

export function conversationSelection(params: URLSearchParams) {
  const value = params.get("api_conversation") ?? "";
  const valid = uuid.test(value);
  return { id: valid ? value.toLowerCase() : "", invalid: !!value && !valid };
}

/** Proposal IDs survive reloads; names, reasons and prepared commands stay out of URLs. */
export function proposalSelection(params: URLSearchParams) {
  const values = params.getAll("api_proposal");
  const value = values[0] ?? "";
  const valid = values.length === 1 && uuid.test(value);
  return {
    id: valid ? value.toLowerCase() : "",
    invalid: values.length > 0 && !valid,
  };
}
