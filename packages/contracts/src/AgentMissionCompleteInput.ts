/* Generated from the checked-in wire schema. Do not edit. */

export interface AgentMissionCompleteInput {
  expected_revision: number;
  idempotency_key: string;
  lease_id: string;
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
}
