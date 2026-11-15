import type { Term, Wcs } from "./shared";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function sip(terms: Term[], u: number, v: number): number {
  let s = 0;
  for (const [p, q, c] of terms) s += c * Math.pow(u, p) * Math.pow(v, q);
  return s;
}

/** TAN deprojection: standard coords (radians) -> RA/Dec (deg). */
function tanInv(xi: number, eta: number, crval: [number, number]): [number, number] {
  const a0 = crval[0] * D2R;
  const d0 = crval[1] * D2R;
  const r = Math.hypot(xi, eta);
  if (r === 0) return [crval[0], crval[1]];
  const c = Math.atan(r);
  const sc = Math.sin(c);
  const cc = Math.cos(c);
  const dec = Math.asin(cc * Math.sin(d0) + (eta * sc * Math.cos(d0)) / r);
  const ra = a0 + Math.atan2(xi * sc, r * Math.cos(d0) * cc - eta * Math.sin(d0) * sc);
  return [(((ra * R2D) % 360) + 360) % 360, dec * R2D];
}

/** TAN projection: RA/Dec (deg) -> standard coords (radians). Returns null if behind the tangent plane. */
function tanFwd(ra: number, dec: number, crval: [number, number]): [number, number] | null {
  const a0 = crval[0] * D2R;
  const d0 = crval[1] * D2R;
  const a = ra * D2R;
  const d = dec * D2R;
  const da = a - a0;
  const den = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  if (den <= 0) return null;
  const xi = (Math.cos(d) * Math.sin(da)) / den;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / den;
  return [xi, eta];
}

/** 0-based pixel (x,y) -> sky (ra,dec) in degrees. Handles TAN + SIP distortion. */
export function pix2sky(w: Wcs, x: number, y: number): [number, number] {
  let u = x + 1 - w.crpix[0];
  let v = y + 1 - w.crpix[1];
  if (w.sip) {
    const du = sip(w.sip.a, u, v);
    const dv = sip(w.sip.b, u, v);
    u += du;
    v += dv;
  }
  const xi = (w.cd[0] * u + w.cd[1] * v) * D2R;
  const eta = (w.cd[2] * u + w.cd[3] * v) * D2R;
  return tanInv(xi, eta, w.crval);
}

/** sky (ra,dec) deg -> 0-based pixel (x,y). Returns null if not projectable. */
export function sky2pix(w: Wcs, ra: number, dec: number): [number, number] | null {
  const p = tanFwd(ra, dec, w.crval);
  if (!p) return null;
  const xi = p[0] * R2D;
  const eta = p[1] * R2D;
  const det = w.cd[0] * w.cd[3] - w.cd[1] * w.cd[2];
  const U = (w.cd[3] * xi - w.cd[1] * eta) / det;
  const V = (-w.cd[2] * xi + w.cd[0] * eta) / det;
  let u = U;
  let v = V;
  if (w.sip) {
    if (w.sip.ap.length || w.sip.bp.length) {
      u = U + sip(w.sip.ap, U, V);
      v = V + sip(w.sip.bp, U, V);
    } else {
      // no inverse coefficients: fixed-point iteration on the forward polynomial
      for (let i = 0; i < 8; i++) {
        u = U - sip(w.sip.a, u, v);
        v = V - sip(w.sip.b, u, v);
      }
    }
  }
  return [u + w.crpix[0] - 1, v + w.crpix[1] - 1];
}

/** A north-up / east-left tangent grid centred on (ra0,dec0) used for display. */
export interface Grid {
  n: number; // pixels per side
  ra0: number;
  dec0: number;
  scaleDeg: number; // deg per output pixel
}
export const gridCrval = (g: Grid): [number, number] => [g.ra0, g.dec0];

/** output pixel (i,j) (0-based, j downward) -> sky */
export function grid2sky(g: Grid, i: number, j: number): [number, number] {
  const xi = -(i - (g.n - 1) / 2) * g.scaleDeg * D2R; // east to the left
  const eta = ((g.n - 1) / 2 - j) * g.scaleDeg * D2R;
  return tanInv(xi, eta, [g.ra0, g.dec0]);
}
/** sky -> output pixel (i,j) (floating) */
export function sky2grid(g: Grid, ra: number, dec: number): [number, number] | null {
  const p = tanFwd(ra, dec, [g.ra0, g.dec0]);
  if (!p) return null;
  const i = -(p[0] * R2D) / g.scaleDeg + (g.n - 1) / 2;
  const j = -(p[1] * R2D) / g.scaleDeg + (g.n - 1) / 2;
  return [i, j];
}

/** Resample one native cutout onto the display grid (NaN-aware bilinear). */
export function reproject(img: Float32Array, w: number, h: number, wcs: Wcs, g: Grid): Float32Array {
  const out = new Float32Array(g.n * g.n);
  for (let j = 0; j < g.n; j++) {
    for (let i = 0; i < g.n; i++) {
      const [ra, dec] = grid2sky(g, i, j);
      const p = sky2pix(wcs, ra, dec);
      let val = NaN;
      if (p) {
        const x = p[0];
        const y = p[1];
        if (x >= -0.5 && y >= -0.5 && x <= w - 0.5 && y <= h - 0.5) {
          const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
          const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
          const fx = Math.max(0, Math.min(1, x - x0));
          const fy = Math.max(0, Math.min(1, y - y0));
          const a = img[y0 * w + x0];
          const b = img[y0 * w + x0 + 1];
          const c = img[(y0 + 1) * w + x0];
          const d = img[(y0 + 1) * w + x0 + 1];
          let sw = 0;
          let s = 0;
          const wa = (1 - fx) * (1 - fy);
          const wb = fx * (1 - fy);
          const wc = (1 - fx) * fy;
          const wd = fx * fy;
          if (a === a) { s += a * wa; sw += wa; }
          if (b === b) { s += b * wb; sw += wb; }
          if (c === c) { s += c * wc; sw += wc; }
          if (d === d) { s += d * wd; sw += wd; }
          // require the dominant neighbours to be valid so masked pixels stay masked
          if (sw > 0.6) val = s / sw;
        }
      }
      out[j * g.n + i] = val;
    }
  }
  return out;
}
