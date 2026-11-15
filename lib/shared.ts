// Shared constants & types (used by both server routes and the browser).

/** IRSA SIA2 endpoint + collections to search.
 *  >>> To pick up new SPHEREx releases, just add the new collection id here. <<<
 *  (e.g. 'spherex_qr4', 'spherex_dr2'; deep fields: 'spherex_qr3_deep').          */
export const SIA_URL = "https://irsa.ipac.caltech.edu/SIA";
export const COLLECTIONS = ["spherex_qr3", "spherex_dr1"];
export const IRSA_DATA_PREFIX = "https://irsa.ipac.caltech.edu/ibe/data/spherex/";

/** The six SPHEREx detector arrays (bands). λ ranges in µm (SPHEREx archive docs). */
export const BANDS = [
  { id: 1, lo: 0.75, hi: 1.09, r: 39, color: "#6aa7ff" },
  { id: 2, lo: 1.1, hi: 1.62, r: 41, color: "#3fd0c4" },
  { id: 3, lo: 1.63, hi: 2.41, r: 41, color: "#a6e35a" },
  { id: 4, lo: 2.42, hi: 3.82, r: 35, color: "#ffd166" },
  { id: 5, lo: 3.83, hi: 4.41, r: 112, color: "#ff9a52" },
  { id: 6, lo: 4.42, hi: 5.0, r: 128, color: "#ff5d73" },
] as const;

export const bandColor = (det: number) => BANDS.find((b) => b.id === det)?.color ?? "#cfd8ff";

/** Pixel scale of the SPHEREx detectors (arcsec / pixel). */
export const NATIVE_SCALE_ARCSEC = 6.15;

export type Term = [number, number, number]; // [p, q, coefficient]
export interface Wcs {
  crpix: [number, number];
  crval: [number, number];
  /** CD matrix [cd11, cd12, cd21, cd22] in deg/pixel */
  cd: [number, number, number, number];
  sip?: { a: Term[]; b: Term[]; ap: Term[]; bp: Term[] };
}

export interface Observation {
  id: string;
  url: string; // IRSA access_url of the full spectral-image MEF
  detector: number; // 1..6
  tMjd: number | null;
  wlLo: number | null; // µm, whole-detector range (from SIA2 em_min/em_max)
  wlHi: number | null;
  collection: string;
}

export interface CutoutPayload {
  w: number;
  h: number;
  wcs: Wcs;
  /** Float16 little-endian packed, base64. NaN = masked/bad/outside. */
  image: string;
  wl: { lo: number; hi: number; mid: number; src: "wcs-wave" | "sia" | "none" };
  meta: {
    detector: number | null;
    obsid: string | null;
    bunit: string;
    version: string | null;
    badFrac: number; // fraction of pixels masked
    outlierFrac: number; // fraction flagged OUTLIER (often where movers show up)
    sourceFrac: number;
    maskedFlags: string[];
  };
}

export interface CatalogStar {
  ra: number;
  dec: number;
  pmra: number; // mas/yr (includes cos dec)
  pmdec: number; // mas/yr
  mag: number | null;
  id?: string;
}
export interface CatalogPayload {
  gaia: CatalogStar[];
  wise: CatalogStar[];
  note?: string;
}

export const mjdToYear = (mjd: number) => 2000 + (mjd - 51544.5) / 365.25;
export const mjdToDate = (mjd: number) => new Date((mjd - 40587) * 86400000);
export const fmtDate = (mjd: number) => mjdToDate(mjd).toISOString().slice(0, 10);
