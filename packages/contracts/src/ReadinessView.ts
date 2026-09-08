/* Generated from the checked-in wire schema. Do not edit. */

export type Status = "ready";
export type SchemaRevision = string;

export interface ReadinessView {
  status: Status;
  schema_revision: SchemaRevision;
}
