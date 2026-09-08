/* Generated from the checked-in wire schema. Do not edit. */

export type Resource = string;
export type AuthorizationServers = string[];
export type BearerMethodsSupported = "header"[];
export type ResourceName = string;

export interface ProtectedResourceMetadata {
  resource: Resource;
  authorization_servers: AuthorizationServers;
  bearer_methods_supported: BearerMethodsSupported;
  resource_name: ResourceName;
}
