import { parseFits, readImage, readBintableRow, wcsFromHeader, type Hdu } from "./fits";
import { packHalf } from "./f16";
import type { CutoutPayload } from "./shared";

/** Flags that make a pixel unusable. SOURCE and OUTLIER are intentionally NOT masked
 *  (OUTLIER often marks real movers/transients - exactly what we want to see). */
const BAD_NAMES = new Set([
  "TRANSIENT", "OVERFLOW", "SUR_ERROR", "NONFUNC", "DICHROIC", "MISSING_DATA",
  "HOT", "COLD", "FULLSAMPLE", "PHANTOM", "NONLINEAR", "PERSIST",
]);
const FALLBACK_BAD_BITS = [0, 10, 11]; // TRANSIENT, HOT, COLD (documented in the IRSA intro tutorial)

function findHdu(hdus: Hdu[], name: string, idx: number): Hdu | undefined {
  return hdus.find((h) => h.extname.startsWith(name)) ?? hdus[idx];
}

/** Bilinear interpolation of the WCS-WAVE lookup table at pixel (x,y) -> [central λ, bandwidth] in µm. */
function waveFromTable(tab: Record<string, number[]>, x: number, y: number): [number, number] | null {
  const X = tab["X"], Y = tab["Y"], V = tab["VALUES"];
  if (!X || !Y || !V) return null;
  const nx = X.length, ny = Y.length;
  if (V.length < 2 * nx * ny) return null;
  const locate = (arr: number[], v: number) => {
    if (arr.length < 2) return [0, 0, 0] as const;
    let i = 0;
    while (i < arr.length - 2 && arr[i + 1] < v) i++;
    const t = (v - arr[i]) / (arr[i + 1] - arr[i]);
    return [i, i + 1, Math.max(0, Math.min(1, t))] as const;
  };
  const [i0, i1, tx] = locate(X, x);
  const [j0, j1, ty] = locate(Y, y);
  const at = (i: number, j: number, c: number) => V[c + 2 * (i + nx * j)];
  const interp = (c: number) =>
    (1 - ty) * ((1 - tx) * at(i0, j0, c) + tx * at(i1, j0, c)) + ty * ((1 - tx) * at(i0, j1, c) + tx * at(i1, j1, c));
  const lam = interp(0);
  const bw = interp(1);
  return Number.isFinite(lam) ? [lam, bw] : null;
}

export function processCutout(
  bytes: Uint8Array,
  sia?: { wlLo?: number | null; wlHi?: number | null; detector?: number | null },
): CutoutPayload {
  const hdus = parseFits(bytes);
  const imgHdu = findHdu(hdus, "IMAGE", 1);
  if (!imgHdu) throw new Error("No IMAGE extension in cutout");
  const flagHdu = findHdu(hdus, "FLAGS", 2);
  const { data, w, h } = readImage(bytes, imgHdu);
  const wcs = wcsFromHeader(imgHdu.header);

  // ----- flags -> mask
  const out = new Float32Array(w * h);
  let nBad = 0, nOut = 0, nSrc = 0;
  const maskedFlags: string[] = [];
  let badBits = FALLBACK_BAD_BITS;
  let outlierBit = 19, sourceBit = 21;
  if (flagHdu) {
    const names: Record<number, string> = {};
    for (const k of Object.keys(flagHdu.header)) {
      const m = /^MSKN(\d+)$/.exec(k);
      if (m) names[Number(m[1])] = String(flagHdu.header[k]).toUpperCase();
    }
    if (Object.keys(names).length) {
      badBits = Object.entries(names).filter(([, nm]) => BAD_NAMES.has(nm)).map(([b]) => Number(b));
      for (const [b, nm] of Object.entries(names)) {
        if (nm === "OUTLIER") outlierBit = Number(b);
        if (nm === "SOURCE") sourceBit = Number(b);
      }
    }
    for (const b of badBits) maskedFlags.push((flagHdu.header["MSKN" + b] as string) ?? "bit" + b);
  }
  let badMask = 0;
  for (const b of badBits) badMask += Math.pow(2, b);
  let flags: Float64Array | null = null;
  if (flagHdu && Number(flagHdu.header.NAXIS1) === w && Number(flagHdu.header.NAXIS2) === h) {
    flags = readImage(bytes, flagHdu).data;
  }
  for (let i = 0; i < out.length; i++) {
    let bad = !Number.isFinite(data[i]);
    if (flags) {
      const f = flags[i];
      const has = (bit: number) => Math.floor(f / Math.pow(2, bit)) % 2 === 1;
      let masked = false;
      for (const b of badBits) if (has(b)) { masked = true; break; }
      if (masked) bad = true;
      if (has(outlierBit)) nOut++;
      if (has(sourceBit)) nSrc++;
    }
    if (bad) { out[i] = NaN; nBad++; } else out[i] = data[i];
  }
  void badMask;

  // ----- wavelength
  let wl: CutoutPayload["wl"] = { lo: NaN, hi: NaN, mid: NaN, src: "none" };
  const siaLo = sia?.wlLo ?? null, siaHi = sia?.wlHi ?? null;
  if (siaLo != null && siaHi != null) {
    wl = { lo: siaLo, hi: siaHi, mid: (siaLo + siaHi) / 2, src: "sia" };
  }
  try {
    const wh = hdus.find((x) => x.extname.startsWith("WCS-WAVE"));
    if (wh) {
      const tab = readBintableRow(bytes, wh);
      const ltv1 = Number(imgHdu.header.LTV1 ?? 0), ltv2 = Number(imgHdu.header.LTV2 ?? 0);
      const r = waveFromTable(tab, w / 2 - ltv1, h / 2 - ltv2);
      if (r) {
        const ok = siaLo == null || siaHi == null || (r[0] >= siaLo * 0.9 && r[0] <= siaHi * 1.1);
        if (ok && r[0] > 0.5 && r[0] < 5.5) {
          wl = { lo: r[0] - r[1] / 2, hi: r[0] + r[1] / 2, mid: r[0], src: "wcs-wave" };
        }
      }
    }
  } catch {
    /* keep SIA fallback */
  }

  const prim = hdus[0].header;
  const detector = sia?.detector ?? (typeof imgHdu.header.DETECTOR === "number" ? (imgHdu.header.DETECTOR as number) : null);
  const total = w * h;
  return {
    w, h, wcs,
    image: Buffer.from(packHalf(out).buffer).toString("base64"),
    wl,
    meta: {
      detector,
      obsid: (imgHdu.header.OBSID as string) ?? (prim.OBSID as string) ?? null,
      bunit: String(imgHdu.header.BUNIT ?? "MJy/sr"),
      version: (prim.VERSION as string) ?? null,
      badFrac: nBad / total,
      outlierFrac: nOut / total,
      sourceFrac: nSrc / total,
      maskedFlags,
    },
  };
}
