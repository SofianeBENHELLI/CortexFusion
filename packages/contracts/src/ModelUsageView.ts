/* Generated from the checked-in wire schema. Do not edit. */

export type UtcDay = string;
export type DailyLimit = number;
export type ReservedAttempts = number;
export type RemainingAttempts = number;
export type Scope = string;

export interface ModelUsageView {
  utc_day: UtcDay;
  daily_limit: DailyLimit;
  reserved_attempts: ReservedAttempts;
  remaining_attempts: RemainingAttempts;
  scope: Scope;
}
