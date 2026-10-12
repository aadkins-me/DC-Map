import type { RentalCriteria } from './criteria';

export interface RentalArea {
  /** Local neighborhood name nearest the tap. */
  place: string;
  /** Neighborhood cluster title shown in the popup. */
  cluster: string;
  /** [west, south, east, north] of the cluster. */
  bounds: [number, number, number, number];
  center: [number, number];
  at: [number, number];
}

export interface SiteLink {
  id: string;
  label: string;
  color: string;
  url: string;
  /** One-line summary shown under the button. */
  short: string;
  /** Tooltip: what is exact vs approximated. */
  detail: string;
}

export function buildLinks(_area: RentalArea, _c: RentalCriteria): SiteLink[] {
  return [];
}
