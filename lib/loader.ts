import { reproject, type Grid } from "./wcs";
import { unpackHalf } from "./f16";
import type { CutoutPayload, Observation } from "./shared";
import type { Frame } from "./engine";

export const gridFor = (ra: number, dec: number, fov: number): Grid => {
  const n = Math.max(192, Math.min(384, Math.round(((fov * 3600) / 6.15) * 3 / 2) * 2));
  return { n, ra0: ra, dec0: dec, scaleDeg: fov / n };
};

/** Pick at most `max` observations, spread evenly in time within each band. */
export function subsample(obs: Observation[], max: number): Observation[] {
  if (obs.length <= max) return obs;
  const byDet = new Map<number, Observation[]>();
  for (const o of obs) (byDet.get(o.detector) ?? byDet.set(o.detector, []).get(o.detector)!).push(o);
  const quota = Math.max(1, Math.floor(max / byDet.size));
  const out: Observation[] = [];
  for (const list of byDet.values()) {
    list.sort((a, b) => (a.tMjd ?? 0) - (b.tMjd ?? 0));
    if (list.length <= quota) out.push(...list);
    else for (let i = 0; i < quota; i++) out.push(list[Math.round((i * (list.length - 1)) / (quota - 1 || 1))]);
  }
  return out;
}

export async function fetchFrame(o: Observation, grid: Grid, fov: number, demo: boolean, signal: AbortSignal): Promise<Frame> {
  const size = Math.min(1, fov * 1.42); // cover the rotated field-of-view
  const q = new URLSearchParams({
    url: o.url, ra: String(grid.ra0), dec: String(grid.dec0), size: size.toFixed(5), det: String(o.detector),
  });
  if (o.wlLo != null) q.set("wlLo", String(o.wlLo));
  if (o.wlHi != null) q.set("wlHi", String(o.wlHi));
  void demo;
  const r = await fetch("/api/cutout?" + q, { signal });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
  const p = j as CutoutPayload;
  const bin = atob(p.image);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const img = unpackHalf(new Uint16Array(bytes.buffer));
  const g = reproject(img, p.w, p.h, p.wcs, grid);
  return {
    id: o.id, url: o.url, det: o.detector, t: o.tMjd ?? 0,
    wl: Number.isFinite(p.wl.lo) ? [p.wl.lo, p.wl.hi] : [o.wlLo ?? 0, o.wlHi ?? 0],
    grid: g, n: 1, badFrac: p.meta.badFrac, outlierFrac: p.meta.outlierFrac, wlSrc: p.wl.src, obsid: p.meta.obsid,
  };
}

/** Run `fn` over items with limited concurrency. */
export async function pool<T>(items: T[], conc: number, fn: (x: T) => Promise<void>, signal: AbortSignal) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(conc, items.length) }, async () => {
      while (i < items.length && !signal.aborted) await fn(items[i++]);
    }),
  );
}
