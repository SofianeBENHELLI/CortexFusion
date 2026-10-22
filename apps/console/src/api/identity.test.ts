import { expect, it } from "vitest";
import { validateIdentity } from "./identity";
const domain = {
  id: "00000000-0000-0000-0000-000000000002",
  name: "Synthétique",
  role: "contributor" as const,
  capabilities: ["query"],
};
const identity = {
  subject: "synthetic",
  tenant_id: "00000000-0000-0000-0000-000000000001",
  domains: [domain],
};
it("accepts legacy identity and explicit roles with a consistent effective role", () => {
  expect(validateIdentity(identity)).toBe(identity);
  expect(
    validateIdentity({
      ...identity,
      domains: [
        { ...domain, roles: ["viewer", "contributor"], membership_revision: 3 },
      ],
    }).domains[0].roles,
  ).toHaveLength(2);
});
it("rejects malformed, escalated, mixed technical roles and invalid revisions", () => {
  for (const patch of [
    { roles: [] },
    { roles: ["owner"] },
    { roles: ["viewer", "viewer"] },
    { roles: ["agent", "contributor"] },
    { roles: ["unknown"] },
    { membership_revision: -1 },
    { membership_revision: 1.2 },
  ]) {
    expect(() =>
      validateIdentity({
        ...identity,
        domains: [{ ...domain, ...patch }],
      } as any),
    ).toThrow();
  }
});
