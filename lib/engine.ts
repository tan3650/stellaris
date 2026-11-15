// Client-side image engine: stacking, differencing, stretch, colour maps, photometry.
import type { Grid } from "./wcs";

export interface Frame {
  id: string;
  url: string;
  det: number; // 1..6 ; 0 = mixed (stacked across bands)
  t: number; // MJD
  wl: [number, number]; // µm
  grid: Float32Array;
  n: number; // number of exposures merged
  badFrac: number;
  outlierFrac: number;
  wlSrc: string;
  obsid: string | null;
}

export type DiffMode = "none" | "median" | "prev";
export type StretchKind = "asinh" | "linear" | "sqrt";
export type CmapName = "gray" | "inferno" | "viridis" | "ice";

function sampleSorted(a: Float32Array, step = 1): Float32Array {
  const v: number[] = [];
  for (let i = 0; i < a.length; i += step) if (a[i] === a[i]) v.push(a[i]);
  const s = Float32Array.from(v);
  s.sort();
  return s;
}
export function percentile(sorted: Float32Array, p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}
export function robustStats(a: Float32Array): { med: number; sigma: number } {
  const s = sampleSorted(a, 3);
  const med = percentile(s, 50);
  const dev = Float32Array.from(s, (x) => Math.abs(x - med));
  dev.sort();
  return { med, sigma: 1.4826 * percentile(dev, 50) || 1e-6 };
}

/** Weighted mean of several grids (weights = 1/σ² of each grid) - NaN aware. */
export function coadd(frames: Frame[]): Float32Array {
  const n = frames[0].grid.length;
  const out = new Float32Array(n);
  const w = frames.map((f) => 1 / Math.pow(robustStats(f.grid).sigma, 2));
  for (let i = 0; i < n; i++) {
    let s = 0, sw = 0;
    for (let k = 0; k < frames.length; k++) {
      const v = frames[k].grid[i];
      if (v === v) { s += v * w[k]; sw += w[k]; }
    }
    out[i] = sw > 0 ? s / sw : NaN;
  }
  return out;
}

export function pixelMedian(grids: Float32Array[]): Float32Array {
  const n = grids[0].length;
  const out = new Float32Array(n);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (const g of grids) if (g[i] === g[i]) buf.push(g[i]);
    if (!buf.length) { out[i] = NaN; continue; }
    buf.sort((a, b) => a - b);
    const m = buf.length >> 1;
    out[i] = buf.length % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2;
  }
  return out;
}

export interface StackOpts { windowDays: number; perBand: boolean }

/** Group frames into time windows (optionally per band) and coadd each group. */
export function stackFrames(frames: Frame[], o: StackOpts): Frame[] {
  const sorted = [...frames].sort((a, b) => a.t - b.t || a.det - b.det);
  if (o.windowDays <= 0) return sorted;
  const groups = new Map<string, Frame[]>();
  const t0 = sorted[0]?.t ?? 0;
  for (const f of sorted) {
    const key = `${Math.floor((f.t - t0) / o.windowDays)}|${o.perBand ? f.det : 0}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }
  const out: Frame[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    out.push({
      id: g.map((x) => x.id).join("+"),
      url: g[0].url,
      det: o.perBand ? g[0].det : new Set(g.map((x) => x.det)).size === 1 ? g[0].det : 0,
      t: g.reduce((s, x) => s + x.t, 0) / g.length,
      wl: [Math.min(...g.map((x) => x.wl[0])), Math.max(...g.map((x) => x.wl[1]))],
      grid: coadd(g),
      n: g.reduce((s, x) => s + x.n, 0),
      badFrac: g.reduce((s, x) => s + x.badFrac, 0) / g.length,
      outlierFrac: g.reduce((s, x) => s + x.outlierFrac, 0) / g.length,
      wlSrc: "stack",
      obsid: null,
    });
  }
  return out.sort((a, b) => a.t - b.t || a.det - b.det);
}

/** Difference images to make movers pop out. "median": subtract per-band pixel median. "prev": frame - previous in same band. */
export function applyDiff(frames: Frame[], mode: DiffMode): Frame[] {
  if (mode === "none" || frames.length < 2) return frames;
  const byDet = new Map<number, Frame[]>();
  for (const f of frames) (byDet.get(f.det) ?? byDet.set(f.det, []).get(f.det)!).push(f);
  const meds = new Map<number, Float32Array>();
  if (mode === "median") for (const [d, fs] of byDet) if (fs.length >= 3) meds.set(d, pixelMedian(fs.map((f) => f.grid)));
  const prev = new Map<number, Frame>();
  return frames.map((f) => {
    let ref: Float32Array | undefined;
    if (mode === "median") ref = meds.get(f.det);
    else { ref = prev.get(f.det)?.grid; prev.set(f.det, f); }
    if (!ref) return { ...f, grid: new Float32Array(f.grid.length) };
    const g = new Float32Array(f.grid.length);
    for (let i = 0; i < g.length; i++) g[i] = f.grid[i] - ref[i];
    return { ...f, grid: g };
  });
}

// ---------------- colour maps (256-entry LUTs from key stops)
const STOPS: Record<CmapName, [number, number, number][]> = {
  gray: [[0, 0, 0], [255, 255, 255]],
  inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]],
  viridis: [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37]],
  ice: [[2, 6, 18], [10, 40, 80], [20, 90, 140], [60, 160, 190], [170, 225, 235], [255, 255, 255]],
};
const lutCache = new Map<CmapName, Uint8ClampedArray>();
export function lut(name: CmapName): Uint8ClampedArray {
  const c = lutCache.get(name);
  if (c) return c;
  const st = STOPS[name];
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (st.length - 1);
    const k = Math.min(st.length - 2, Math.floor(x));
    const t = x - k;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = st[k][c] * (1 - t) + st[k + 1][c] * t;
  }
  lutCache.set(name, out);
  return out;
}

export interface Stretch { kind: StretchKind; lo: number; hi: number; cmap: CmapName; locked: boolean; invert: boolean }

/** Compute display limits from percentiles of the frame. */
export function limits(g: Float32Array, loP: number, hiP: number): [number, number] {
  const s = sampleSorted(g, 2);
  return [percentile(s, loP), percentile(s, hiP)];
}

export function renderToImageData(g: Float32Array, n: number, lo: number, hi: number, st: Stretch, out: ImageData) {
  const L = lut(st.cmap);
  const span = hi - lo || 1;
  const a = 8;
  const norm = Math.asinh(a);
  const px = out.data;
  for (let i = 0; i < g.length; i++) {
    const v = g[i];
    const o = i * 4;
    if (v !== v) { px[o] = 14; px[o + 1] = 16; px[o + 2] = 28; px[o + 3] = 255; continue; }
    let t = (v - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (st.kind === "asinh") t = Math.asinh(a * t) / norm;
    else if (st.kind === "sqrt") t = Math.sqrt(t);
    if (st.invert) t = 1 - t;
    const k = Math.round(t * 255) * 3;
    px[o] = L[k]; px[o + 1] = L[k + 1]; px[o + 2] = L[k + 2]; px[o + 3] = 255;
  }
  void n;
}

// ---------------- photometry
export interface PhotPoint { det: number; t: number; wl: number; wlLo: number; wlHi: number; flux: number; err: number; id: string }

/** Aperture-mean surface brightness at output-grid position (cx,cy) minus an annulus median. */
export function aperturePhot(f: Frame, n: number, cx: number, cy: number, rPix: number): { flux: number; err: number } | null {
  const rIn = rPix, rOut = rPix * 2.5;
  const ap: number[] = [], bg: number[] = [];
  const x0 = Math.max(0, Math.floor(cx - rOut)), x1 = Math.min(n - 1, Math.ceil(cx + rOut));
  const y0 = Math.max(0, Math.floor(cy - rOut)), y1 = Math.min(n - 1, Math.ceil(cy + rOut));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = f.grid[y * n + x];
      if (v !== v) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rIn) ap.push(v);
      else if (d <= rOut && d > rIn * 1.3) bg.push(v);
    }
  }
  if (ap.length < 3 || bg.length < 8) return null;
  bg.sort((a, b) => a - b);
  const med = bg[bg.length >> 1];
  const mad = bg.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[bg.length >> 1] * 1.4826;
  const mean = ap.reduce((s, v) => s + v, 0) / ap.length;
  return { flux: mean - med, err: mad / Math.sqrt(Math.max(1, ap.length / 6)) }; // ~6 display px per beam-independent sample
}

export function pixelScaleArcsec(g: Grid) {
  return g.scaleDeg * 3600;
}

/** Star masking: find pixels brighter than median + sigma*MAD-sigma, grow the mask by 2 px (to cover halos),
 *  and replace them with the mean of nearby unmasked pixels. Faint movers stay visible against a cleaner sky. */
export function maskBrightStars(g: Float32Array, n: number, sigma: number): Float32Array {
  const { med, sigma: s } = robustStats(g);
  const thr = med + sigma * s;
  const bad = new Uint8Array(n * n);
  for (let i = 0; i < g.length; i++) if (g[i] > thr) bad[i] = 1;
  const grown = new Uint8Array(bad);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!bad[y * n + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < n && xx >= 0 && xx < n) grown[yy * n + xx] = 1;
    }
  }
  const out = Float32Array.from(g);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!grown[y * n + x]) continue;
    let sum = 0, cnt = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || yy >= n || xx < 0 || xx >= n || grown[yy * n + xx]) continue;
      const v = g[yy * n + xx];
      if (Number.isFinite(v)) { sum += v; cnt++; }
    }
    out[y * n + x] = cnt ? sum / cnt : med;
  }
  return out;
}
