/* Generated from the checked-in wire schema. Do not edit. */

export interface MapNodePage {
  domain_id: string;
  at_version: number;
  visibility: string;
  totals: {
    concepts: number;
    relations: number;
    references: number;
  };
  bounds: MapBounds;
  total: number;
  offset: number;
  /**
   * @maxItems 16
   */
  items:
    | []
    | [
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ]
    | [
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        },
        {
          node: MapNode;
          link: MapLink | null;
        }
      ];
  selected: MapNode | null;
  focus_bounds: MapBounds | null;
  /**
   * Server page bound: eight for a nonempty normalized search, sixteen otherwise.
   */
  page_size: 8 | 16;
}
export interface MapBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface MapNode {
  id: string;
  title: string;
  maturity: string;
  group: string;
  territory: string;
  x: number;
  y: number;
  degree: number;
}
export interface MapLink {
  from: string;
  to: string;
  kind: "reference" | "structural" | "associative";
  weight: number | null;
}
