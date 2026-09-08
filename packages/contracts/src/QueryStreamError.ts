/* Generated from the checked-in wire schema. Do not edit. */

export type Event = "error";
export type ProtocolVersion = "1";
export type Error = string;
export type HttpStatus = number;
export type Message = string;
export type Recovery = "inspect_or_retry_same_key";

export interface QueryStreamError {
  event?: Event;
  protocol_version?: ProtocolVersion;
  error: Error;
  http_status: HttpStatus;
  message?: Message;
  recovery?: Recovery;
}
