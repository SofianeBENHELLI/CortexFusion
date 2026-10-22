/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionDetail {
  title: string;
  objective: string;
  criteria: string;
  agent: string;
  source_id: string;
  source_hash: string;
  max_reads: number;
  max_chars: number;
  expires_at: string;
  id: string;
  author: string;
  status: "queued" | "running" | "stopped" | "completed";
  revision: number;
  reads_used: number;
  chars_used: number;
  expired: boolean;
  lease_expired: boolean;
  lease_id: string | null;
  lease_expires_at: string | null;
  report: string;
  hypotheses: string;
  /**
   * @maxItems 10
   */
  evidence:
    | []
    | [
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ]
    | [
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        },
        {
          start: number;
          end: number;
        }
      ];
  created_at: string;
  updated_at: string;
  /**
   * @maxItems 6
   */
  allowed_actions:
    | []
    | ["claim" | "renew" | "read" | "complete" | "stop" | "resume"]
    | [
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume"
      ]
    | [
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume"
      ]
    | [
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume"
      ]
    | [
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume"
      ]
    | [
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume",
        "claim" | "renew" | "read" | "complete" | "stop" | "resume"
      ];
  provider: "none";
  execution: "client_managed";
}
