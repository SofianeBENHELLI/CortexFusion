/* Generated from the checked-in wire schema. Do not edit. */

export interface GraphScene {
  domain_id: string;
  at_version: number;
  visibility: string;
  totals: {
    concepts: number;
    relations: number;
    references: number;
  };
  bounds: MapBounds;
  /**
   * @maxItems 24
   */
  glyphs: MapGlyph[];
  /**
   * @maxItems 120
   */
  links: {
    from: number;
    to: number;
    kind: string;
    count: number;
    weight: number | null;
    aggregate: boolean;
  }[];
  view: MapBounds;
  cell_size: number;
  routes_total: number;
  coverage: "viewport";
}
export interface MapBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface MapGlyph {
  id: string;
  concept_id: string | null;
  title: string;
  x: number;
  y: number;
  count: number;
  bounds: MapBounds;
  degree: number;
}
