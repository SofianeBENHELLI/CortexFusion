/* Generated from the checked-in wire schema. Do not edit. */

export type Version = string;
export type OpenapiUrl = string;
export type AuthorizationNotice = string;
export type ActionId = string;
export type OperationId = string;
export type Method = string;
export type Path = string;
export type Roles = string[];
export type Effect = string;
export type EffectDescription = string;
export type IntentExample = string;
export type ConfirmationPolicy = string;
export type ObjectAuthorization = string;
export type Items = InteractionView[];

export interface InteractionCatalog {
  version: Version;
  openapi_url: OpenapiUrl;
  authorization_notice: AuthorizationNotice;
  items: Items;
}
export interface InteractionView {
  action_id: ActionId;
  operation_id: OperationId;
  method: Method;
  path: Path;
  roles: Roles;
  effect: Effect;
  effect_description: EffectDescription;
  intent_example: IntentExample;
  confirmation_policy: ConfirmationPolicy;
  object_authorization: ObjectAuthorization;
}
