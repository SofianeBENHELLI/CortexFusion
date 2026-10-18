import { expect, it } from "vitest";
import {
  domainViewParams,
  brainConceptHref,
  conversationSelection,
  proposalSelection,
} from "./navigation";
it("preserves one domain's conversation, temporal window and map selection across views", () => {
  const current = new URLSearchParams(
    "api_domain=a&api_view=work&api_conversation=c&map_node=n&map_transport=viewport&time_from=earlier&domains_page=2",
  );
  const brain = domainViewParams(current, "a", "brain");
  expect(domainViewParams(brain, "a", "work").toString()).toBe(
    current.toString(),
  );
  expect(brainConceptHref(current, "a", "other")).toContain(
    "api_conversation=c",
  );
});

it("rejects ambiguous proposal links and normalizes only opaque identities", () => {
  const id = "00000000-0000-0000-0000-00000000000A";
  expect(proposalSelection(new URLSearchParams())).toEqual({
    id: "",
    invalid: false,
  });
  expect(proposalSelection(new URLSearchParams({ api_proposal: id }))).toEqual({
    id: id.toLowerCase(),
    invalid: false,
  });
  for (const query of [
    "api_proposal=",
    "api_proposal=private",
    `api_proposal=${id}&api_proposal=${id}`,
  ])
    expect(proposalSelection(new URLSearchParams(query))).toEqual({
      id: "",
      invalid: true,
    });
});
it("clears identifiers and filters when changing domain", () => {
  const current = new URLSearchParams(
    "api_domain=a&api_conversation=c&map_node=n&time_from=earlier&domains_page=2",
  );
  expect(domainViewParams(current, "b", "work").toString()).toBe(
    "api_domain=b&api_view=work&domains_page=2",
  );
});
it("normalizes valid conversation identities and distinguishes malformed links from new conversations", () => {
  expect(conversationSelection(new URLSearchParams())).toEqual({
    id: "",
    invalid: false,
  });
  expect(
    conversationSelection(new URLSearchParams("api_conversation=broken")),
  ).toEqual({ id: "", invalid: true });
  expect(
    conversationSelection(
      new URLSearchParams(
        "api_conversation=00000000-0000-0000-0000-00000000000A",
      ),
    ),
  ).toEqual({ id: "00000000-0000-0000-0000-00000000000a", invalid: false });
});
