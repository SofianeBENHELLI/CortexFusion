import type { IssuePage } from "../../../../packages/contracts/src/IssuePage";
import type { IssueView } from "../../../../packages/contracts/src/IssueView";
import type { ReviewPage } from "../../../../packages/contracts/src/ReviewPage";
import type { SourceDetail } from "../../../../packages/contracts/src/SourceDetail";
import type { ProposalPage } from "../../../../packages/contracts/src/ProposalPage";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type { ProposalDifference } from "../../../../packages/contracts/src/ProposalDifference";
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

import type { ConversationPage } from "../../../../packages/contracts/src/ConversationPage";
export interface Operations {
  "issues.list": {
    params: { domain: string };
    body: undefined;
    response: IssuePage;
  };
  "issues.read": {
    params: { domain: string; ident: string };
    body: undefined;
    response: IssueView;
  };
  "episodes.read": {
    params: { domain: string; episode_id: string };
    body: undefined;
    response: QueryResult;
  };
  "proposals.reviews": {
    params: { domain: string; ident: string };
    body: undefined;
    response: ReviewPage;
  };
  "sources.read": {
    params: { domain: string; source_id: string };
    body: undefined;
    response: SourceDetail;
  };
  "proposals.list": {
    params: { domain: string };
    body: undefined;
    response: ProposalPage;
  };
  "proposals.read": {
    params: { domain: string; proposal_id: string };
    body: undefined;
    response: ProposalView;
  };
  "proposals.diff": {
    params: { domain: string; ident: string };
    body: undefined;
    response: ProposalDifference;
  };
  "conversations.list": {
    params: { domain: string };
    body: undefined;
    response: ConversationPage;
  };
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
  "issues.list": { method: "GET", path: "/v1/domains/{domain}/issues" },
  "issues.read": { method: "GET", path: "/v1/domains/{domain}/issues/{ident}" },
  "episodes.read": {
    method: "GET",
    path: "/v1/domains/{domain}/episodes/{episode_id}",
  },
  "proposals.reviews": {
    method: "GET",
    path: "/v1/domains/{domain}/proposals/{ident}/reviews",
  },
  "sources.read": {
    method: "GET",
    path: "/v1/domains/{domain}/sources/{source_id}",
  },
  "proposals.list": { method: "GET", path: "/v1/domains/{domain}/proposals" },
  "proposals.read": {
    method: "GET",
    path: "/v1/domains/{domain}/proposals/{proposal_id}",
  },
  "proposals.diff": {
    method: "GET",
    path: "/v1/domains/{domain}/proposals/{ident}/diff",
  },
  "conversations.list": {
    method: "GET",
    path: "/v1/domains/{domain}/conversations",
  },
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
