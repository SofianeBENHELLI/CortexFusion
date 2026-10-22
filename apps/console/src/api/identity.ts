import type { IdentityView } from "../../../../packages/contracts/src/IdentityView";
import { ApiError } from "./client";
import { uuid } from "./uuid";
const roleOrder = ["owner", "corpus_manager", "contributor", "viewer", "agent"];
function validRoles(d: IdentityView["domains"][number]) {
  if (d.roles == null) return true; // Explicit legacy single-role compatibility.
  return (
    Array.isArray(d.roles) &&
    d.roles.length > 0 &&
    d.roles.length <= 4 &&
    d.roles.every((r) => roleOrder.includes(r)) &&
    new Set(d.roles).size === d.roles.length &&
    (!d.roles.includes("agent") || d.roles.length === 1) &&
    roleOrder.find((r) => d.roles!.includes(r as typeof d.role)) === d.role
  );
}
export function validateIdentity(value: IdentityView): IdentityView {
  if (
    !value ||
    typeof value.subject !== "string" ||
    !value.subject.trim() ||
    !uuid.test(value.tenant_id) ||
    !Array.isArray(value.domains) ||
    value.domains.some(
      (d) =>
        !d ||
        !uuid.test(d.id) ||
        typeof d.name !== "string" ||
        !d.name.trim() ||
        !["owner", "corpus_manager", "contributor", "agent", "viewer"].includes(
          d.role,
        ) ||
        !validRoles(d) ||
        (d.membership_revision != null &&
          (!Number.isSafeInteger(d.membership_revision) ||
            d.membership_revision < 0)) ||
        !Array.isArray(d.capabilities) ||
        d.capabilities.some((c) => typeof c !== "string"),
    ) ||
    new Set(value.domains.map((d) => d.id.toLowerCase())).size !==
      value.domains.length
  )
    throw new ApiError(200, "invalid_response");
  return value;
}
