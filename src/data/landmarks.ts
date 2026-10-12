export type LandmarkCategory = 'government' | 'university' | 'sports' | 'culture' | 'park' | 'transit';

export interface Landmark {
  name: string;
  category: LandmarkCategory;
  lngLat: [number, number];
  blurb: string;
}

export const CATEGORY_META: Record<LandmarkCategory, { label: string; color: string }> = {
  government: { label: 'Government', color: '#1e3a8a' },
  university: { label: 'University', color: '#7c3aed' },
  sports: { label: 'Sports & arenas', color: '#dc2626' },
  culture: { label: 'Museums & culture', color: '#d97706' },
  park: { label: 'Parks & outdoors', color: '#15803d' },
  transit: { label: 'Transit hubs', color: '#0f766e' },
};

export const LANDMARKS: Landmark[] = [
  { name: 'U.S. Capitol', category: 'government', lngLat: [-77.00905, 38.8899], blurb: 'Seat of Congress at the east end of the National Mall; anchors Capitol Hill.' },
  { name: 'The White House', category: 'government', lngLat: [-77.03653, 38.89768], blurb: "The President's residence at 1600 Pennsylvania Ave NW, beside Lafayette Square." },
  { name: 'Library of Congress', category: 'government', lngLat: [-77.00473, 38.88871], blurb: 'The Jefferson Building, just behind the Capitol on Independence Ave SE.' },
  { name: 'Howard University', category: 'university', lngLat: [-77.0194, 38.9227], blurb: 'Historic HBCU founded in 1867, between Shaw, LeDroit Park and Pleasant Plains.' },
  { name: 'Georgetown University', category: 'university', lngLat: [-77.0723, 38.90763], blurb: 'Hilltop campus at the west edge of Georgetown; no Metro stop nearby.' },
  { name: 'George Washington University', category: 'university', lngLat: [-77.04848, 38.89983], blurb: 'Foggy Bottom campus a few blocks west of the White House.' },
  { name: 'American University', category: 'university', lngLat: [-77.0887, 38.93711], blurb: 'Leafy campus in Northwest DC near Tenleytown and Spring Valley.' },
  { name: 'Catholic University', category: 'university', lngLat: [-76.9995, 38.9365], blurb: 'Brookland campus next to the Brookland-CUA Red Line station.' },
  { name: 'Gallaudet University', category: 'university', lngLat: [-76.99389, 38.90694], blurb: 'University for deaf and hard-of-hearing students, near NoMa and Union Market.' },
  { name: 'Union Station', category: 'transit', lngLat: [-77.00636, 38.89735], blurb: 'Amtrak, MARC, VRE and Red Line hub at the edge of Capitol Hill and NoMa.' },
  { name: 'Reagan National Airport (DCA)', category: 'transit', lngLat: [-77.04023, 38.85121], blurb: 'Close-in airport across the Potomac in Arlington, on the Blue and Yellow lines.' },
  { name: 'National Mall & Washington Monument', category: 'park', lngLat: [-77.03528, 38.88948], blurb: 'Two miles of lawn and monuments between the Capitol and the Lincoln Memorial.' },
  { name: 'Lincoln Memorial', category: 'park', lngLat: [-77.05008, 38.88929], blurb: 'Western end of the Mall, overlooking the Reflecting Pool.' },
  { name: 'Rock Creek Park', category: 'park', lngLat: [-77.0524, 38.9402], blurb: '1,700+ acres of trails and parkway running through Northwest DC.' },
  { name: 'Meridian Hill Park', category: 'park', lngLat: [-77.0359, 38.9215], blurb: 'Terraced park with Sunday drum circles, between Columbia Heights and Adams Morgan.' },
  { name: 'Dupont Circle', category: 'park', lngLat: [-77.0434, 38.9096], blurb: 'Traffic circle and park at the heart of one of DC’s most walkable neighborhoods.' },
  { name: 'Nationals Park', category: 'sports', lngLat: [-77.00744, 38.87301], blurb: 'Home of the Washington Nationals in Navy Yard, by the Navy Yard-Ballpark station.' },
  { name: 'Audi Field', category: 'sports', lngLat: [-77.01283, 38.86841], blurb: 'D.C. United and Washington Spirit stadium at Buzzard Point.' },
  { name: 'Capital One Arena', category: 'sports', lngLat: [-77.02088, 38.89807], blurb: 'Capitals and Wizards arena above Gallery Place-Chinatown.' },
  { name: 'The Wharf', category: 'culture', lngLat: [-77.0235, 38.87903], blurb: 'Waterfront restaurants, music venues and marinas along the Washington Channel.' },
  { name: 'Kennedy Center', category: 'culture', lngLat: [-77.05578, 38.89566], blurb: 'Performing arts center on the Potomac next to the Watergate.' },
  { name: 'National Museum of African American History & Culture', category: 'culture', lngLat: [-77.03265, 38.8911], blurb: 'Smithsonian museum on the Mall next to the Washington Monument.' },
  { name: "Smithsonian's National Zoo", category: 'culture', lngLat: [-77.0497, 38.9296], blurb: 'Free zoo off Connecticut Ave between Woodley Park and Cleveland Park.' },
  { name: 'Washington National Cathedral', category: 'culture', lngLat: [-77.07087, 38.93065], blurb: 'Gothic cathedral on Wisconsin Ave, high above Cathedral Heights.' },
  { name: 'Eastern Market', category: 'culture', lngLat: [-76.99634, 38.88655], blurb: 'Capitol Hill’s 1873 public market with weekend flea and farmers markets.' },
  { name: 'Union Market', category: 'culture', lngLat: [-76.9976, 38.90848], blurb: 'Food hall and fast-growing district northeast of NoMa.' },
];

export function landmarksGeoJSON(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: LANDMARKS.map((l, i) => ({
      type: 'Feature',
      id: i,
      properties: { index: i, name: l.name, category: l.category, color: CATEGORY_META[l.category].color },
      geometry: { type: 'Point', coordinates: l.lngLat },
    })),
  };
}
