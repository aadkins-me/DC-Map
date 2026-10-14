export interface RentalCriteria {
  beds: number;
  den: boolean;
  baths: number;
  centralAir: boolean;
  maxRent: number | null;
}

export const DEFAULT_CRITERIA: RentalCriteria = { beds: 2, den: true, baths: 2.5, centralAir: true, maxRent: null };

export const BED_OPTIONS = [0, 1, 2, 3, 4];
export const BATH_OPTIONS = [1, 1.5, 2, 2.5, 3, 4];

const STORAGE_KEY = 'dc-map:rental-criteria';
export const HASH_KEY = 'rent';

function clean(raw: Partial<RentalCriteria>): RentalCriteria {
  const c = { ...DEFAULT_CRITERIA };
  if (typeof raw.beds === 'number' && BED_OPTIONS.includes(raw.beds)) c.beds = raw.beds;
  if (typeof raw.baths === 'number' && BATH_OPTIONS.includes(raw.baths)) c.baths = raw.baths;
  if (typeof raw.den === 'boolean') c.den = raw.den;
  if (typeof raw.centralAir === 'boolean') c.centralAir = raw.centralAir;
  if (typeof raw.maxRent === 'number' && Number.isFinite(raw.maxRent) && raw.maxRent > 0) c.maxRent = Math.round(raw.maxRent);
  else c.maxRent = null;
  return c;
}

export function loadCriteria(): RentalCriteria {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return clean(JSON.parse(saved));
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return { ...DEFAULT_CRITERIA };
}

export function saveCriteria(c: RentalCriteria) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* private mode / quota: criteria still apply for this session */
  }
}

const SHARE_PREF_KEY = 'dc-map:rental-share';

export function loadSharePref(): boolean {
  try {
    return localStorage.getItem(SHARE_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveSharePref(on: boolean) {
  try {
    localStorage.setItem(SHARE_PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export const isDefault = (c: RentalCriteria) =>
  (Object.keys(DEFAULT_CRITERIA) as (keyof RentalCriteria)[]).every((k) => c[k] === DEFAULT_CRITERIA[k]);

// Hash value: beds.bathsInTenths.flags[.maxRent], flags = d (den) and/or a (central air), "-" for neither.
// Example: rent=2.25.da.3500 → 2+ beds, 2.5+ baths, den, central air, max $3,500.
export function encodeCriteria(c: RentalCriteria): string {
  const flags = `${c.den ? 'd' : ''}${c.centralAir ? 'a' : ''}` || '-';
  return [c.beds, Math.round(c.baths * 10), flags, ...(c.maxRent ? [c.maxRent] : [])].join('.');
}

export function decodeCriteria(value: string): RentalCriteria | null {
  const m = /^(\d)\.(\d{1,2})\.([da]{1,2}|-)(?:\.(\d{2,6}))?$/.exec(value);
  if (!m) return null;
  return clean({
    beds: Number(m[1]),
    baths: Number(m[2]) / 10,
    den: m[3].includes('d'),
    centralAir: m[3].includes('a'),
    maxRent: m[4] ? Number(m[4]) : null,
  });
}

export function criteriaFromHash(hash: string): RentalCriteria | null {
  for (const part of hash.replace(/^#/, '').split('&')) {
    if (part.startsWith(`${HASH_KEY}=`)) return decodeCriteria(part.slice(HASH_KEY.length + 1));
  }
  return null;
}

export function summarize(c: RentalCriteria): string {
  const parts = [c.beds ? `${c.beds}+ bd${c.den ? ' + den' : ''}` : `Studio+${c.den ? ' + den' : ''}`, `${c.baths}+ ba`];
  if (c.centralAir) parts.push('central air');
  if (c.maxRent) parts.push(`≤ $${c.maxRent.toLocaleString('en-US')}`);
  return parts.join(' · ');
}
