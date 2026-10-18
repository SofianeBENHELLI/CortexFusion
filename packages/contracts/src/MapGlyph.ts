/* Generated from the checked-in wire schema. Do not edit. */

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
export interface MapBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
