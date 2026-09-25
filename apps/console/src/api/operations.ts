// Wire types imported from the checked-in backend contracts. Contract tests guard methods and paths.
import type { Concept } from "../../../../packages/contracts/src/QueryResult";
import type { ConversationInput } from "../../../../packages/contracts/src/ConversationInput";
import type { ConversationMessages } from "../../../../packages/contracts/src/ConversationMessages";
import type { ConversationQueryInput } from "../../../../packages/contracts/src/ConversationQueryInput";
import type { ConversationView } from "../../../../packages/contracts/src/ConversationView";
import type { FeedbackInput } from "../../../../packages/contracts/src/FeedbackInput";
import type { FeedbackReceipt } from "../../../../packages/contracts/src/FeedbackReceipt";
import type { IdentityView } from "../../../../packages/contracts/src/IdentityView";
import type { QueryResult } from "../../../../packages/contracts/src/QueryResult";
import type { VersionView } from "../../../../packages/contracts/src/VersionView";

export interface Operations {
  "conversations.create": {
    params: { domain: string };
    body: ConversationInput;
    response: ConversationView;
  };
  "conversations.messages": {
    params: { domain: string; ident: string };
    body: undefined;
    response: ConversationMessages;
  };
  "conversations.query": {
    params: { domain: string; ident: string };
    body: ConversationQueryInput;
    response: QueryResult;
  };
  "identity.read": { params: {}; body: undefined; response: IdentityView };
  "domain.version": {
    params: { domain: string };
    body: undefined;
    response: VersionView;
  };
  "concepts.list": {
    params: { domain: string };
    body: undefined;
    response: Concept[];
  };
  "episodes.feedback": {
    params: { domain: string; episode_id: string };
    body: FeedbackInput;
    response: FeedbackReceipt;
  };
}
export const operations = {
  "conversations.create": {
    method: "POST",
    path: "/v1/domains/{domain}/conversations",
  },
  "conversations.messages": {
    method: "GET",
    path: "/v1/domains/{domain}/conversations/{ident}/messages",
  },
  "conversations.query": {
    method: "POST",
    path: "/v1/domains/{domain}/conversations/{ident}/query",
  },
  "identity.read": { method: "GET", path: "/v1/me" },
  "domain.version": { method: "GET", path: "/v1/domains/{domain}/version" },
  "concepts.list": { method: "GET", path: "/v1/domains/{domain}/concepts" },
  "episodes.feedback": {
    method: "POST",
    path: "/v1/domains/{domain}/episodes/{episode_id}/feedback",
  },
} as const;
