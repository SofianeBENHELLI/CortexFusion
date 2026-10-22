# 0053 — Progressive source contribution selection

Accepted locally, 2026-10-17. Existing proposal/draft authority and limits remain.

Load, restore and page navigation use source passages. Preparation locates the exact excerpt across the source with a pinned hash, optionally choosing a global Unicode occurrence, then displays only one page. Confirmation revalidates that same exact range before creating the candidate. An uncertain submission keeps its original body/key and recovery behavior. A200000-character user-supplied excerpt remains valid; it is never silently shortened.

Pages replace each other and preserve fields. Current source metadata contains no hidden full body. Denied access clears the editor and resets neighbouring proposal list/detail caches before authorised reads, fixing a stale title found in Chrome. Other domains remain unaffected. The four-field direct chat command remains compatible; an optional fifth field identifies a repeated occurrence. Buttons and exact commands share functions.

Browser validation covers restored distant evidence, keyboard selection, mobile light/dark, chat confirmation and ACL removal. Component tests cover maximum payload, page failure, source changes, drafts and unknown receipts. Native proposal validation still loads accessible source bodies; this increment bounds source transport to the browser, not all server memory or database work. See lot46 journal for denominators and limits.

Lot48 extends this to private draft validation: metadata/hash/Unicode length under the source lock, then PostgreSQL substring equality using UTF-8 bytes. Only a boolean crosses back to Rust. Range/length are checked before signed SQL index conversion; the existing200000-character draft limit and incomplete unselected drafts remain. Database scanning/decompression is still not a constant-work guarantee. Receipt replay and read never need the source body.
