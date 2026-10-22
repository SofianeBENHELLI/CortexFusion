/** Integration plan: these are real operation IDs. UI DTOs in mock.ts are not wire payloads. */
export const backendOperations = {
  brief: ["domain.brief", "domain.version"],
  concepts: ["concepts.list", "concepts.read"],
  proposal: ["proposals.list", "proposals.read", "proposals.diff"],
  approve: ["proposals.approve"],
  rejectOrDefer: ["proposals.review"],
  revise: ["proposals.revise"],
  publish: [
    "proposals.publish",
    "proposals.publication_attempts",
    "proposals.publication_events",
  ],
  retryPublication: ["proposals.retry_publication"],
  correction: ["proposals.create"],
  signals: ["feedback.signals", "feedback.summary"],
  signalTriage: ["issues.list", "issues.decide", "issues.history"],
  feedback: ["episodes.feedback", "feedback.record_signal"],
  sources: ["sources.list", "sources.read", "sources.chunks"],
  upload: ["files.upload", "files.process", "files.read"],
  sourceProposal: ["sources.propose"],
  journal: ["commits.list", "members.history", "proposals.publication_events"],
  roles: ["members.list", "members.change"],
  conversation: [
    "conversations.create",
    "conversations.query",
    "conversations.messages",
  ],
} as const;
