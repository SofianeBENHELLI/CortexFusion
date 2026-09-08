/* Generated from the checked-in wire schema. Do not edit. */

export type Status = "ok";
export type Version = string;
export type Mode = "extractive";

export interface HealthView {
  status: Status;
  version: Version;
  mode: Mode;
}
