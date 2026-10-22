/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionEventPage {
  mission_id: string;
  current_revision: number;
  /**
   * @maxItems 20
   */
  items:
    | []
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ]
    | [
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        },
        {
          id: string;
          actor: string;
          action: "create" | "claim" | "renew" | "stop" | "resume" | "read" | "complete";
          revision: number;
          status: "queued" | "running" | "stopped" | "completed";
          reads_used: number;
          chars_used: number;
          start: number | null;
          end: number | null;
          reason: string;
          created_at: string;
        }
      ];
  next_after: string | null;
}
