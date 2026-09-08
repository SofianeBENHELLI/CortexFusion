/* Generated from the checked-in wire schema. Do not edit. */

export type Event = "started";
export type ProtocolVersion = "1";
export type OperationId = "conversations.query";
export type IdempotencyKey = string;

export interface QueryStreamStarted {
  event?: Event;
  protocol_version?: ProtocolVersion;
  operation_id?: OperationId;
  idempotency_key: IdempotencyKey;
}
