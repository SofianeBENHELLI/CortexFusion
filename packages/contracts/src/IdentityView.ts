/* Generated from the checked-in wire schema. Do not edit. */

export type Subject = string;
export type TenantId = string;
export type Id = string;
export type Name = string;
export type Role = "owner" | "corpus_manager" | "contributor" | "agent" | "viewer";
export type Capabilities = string[];
export type Domains = AccessibleDomain[];

export interface IdentityView {
  subject: Subject;
  tenant_id: TenantId;
  domains: Domains;
}
export interface AccessibleDomain {
  id: Id;
  name: Name;
  role: Role;
  capabilities: Capabilities;
}
