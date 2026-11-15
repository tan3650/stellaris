// DEMO / OFFLINE data generator. Produces *simulated* SPHEREx-like cutouts as real FITS bytes so the
// exact same parsing + rendering path as live data is exercised. Always labelled SIMULATED in the UI.
import { BANDS, NATIVE_SCALE_ARCSEC, type CatalogPayload, type Observation, type Wcs } from "./shared";
import { pix2sky, sky2pix } from "./wcs";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (a: number, b: number) => (Math.imul(Math.round(a * 50), 73856093) ^ Math.imul(Math.round(b * 50), 19349663)) >>> 0;

interface MockStar { dx: number; dy: number; f0: number; slope: number; pmx: number; pmy: number; kind: "star" | "mover" | "variable"; period?: number }
const T0 = 60800; // MJD 2025-05-01 approx

export function mockSky(ra: number, dec: number): MockStar[] {
  const r = rng(hash(ra, dec));
  const stars: MockStar[] = [];
  for (let i = 0; i < 40; i++) {
    stars.push({ dx: (r() - 0.5) * 0.5, dy: (r() - 0.5) * 0.5, f0: 2 + 40 * Math.pow(r(), 3), slope: -1.6 + 2 * r(), pmx: 0, pmy: 0, kind: "star" });
  }
  // a cold brown-dwarf-like mover: faint at 1 µm, bright at 4-5 µm, ~8 arcsec/yr
  stars.push({ dx: 0.012, dy: -0.006, f0: 4, slope: 3.2, pmx: -8 / 3600, pmy: 0.7 / 3600, kind: "mover" });
  // a variable star near the centre
  stars.push({ dx: -0.015, dy: 0.01, f0: 30, slope: -0.6, pmx: 0, pmy: 0, kind: "variable", period: 330 });
  return stars;
}

function starPos(s: MockStar, ra: number, dec: number, mjd: number): [number, number] {
  const yr = (mjd - T0) / 365.25;
  const cd = Math.cos((dec * Math.PI) / 180);
  return [ra + s.dx / cd + (s.pmx * yr) / cd, dec + s.dy + s.pmy * yr];
}

export function mockObservations(ra: number, dec: number): Observation[] {
  const r = rng(hash(ra, dec) ^ 0x5eed);
  const obs: Observation[] = [];
  let n = 0;
  for (let visit = 0; visit < 12; visit++) {
    const tv = T0 + visit * 40 + r() * 8;
    for (const b of BANDS) {
      if (r() < 0.12) continue;
      obs.push({
        id: `MOCK_${String(n).padStart(3, "0")}D${b.id}`,
        url: `mock://${n}/${b.id}/${(tv + b.id * 0.3).toFixed(3)}`,
        detector: b.id,
        tMjd: tv + b.id * 0.3,
        wlLo: b.lo,
        wlHi: b.hi,
        collection: "simulated",
      });
      n++;
    }
  }
  return obs;
}

export function mockCatalog(ra: number, dec: number, radius: number): CatalogPayload {
  const cd = Math.cos((dec * Math.PI) / 180);
  const stars = mockSky(ra, dec).filter((s) => s.kind === "star");
  const gaia = stars
    .map((s, i) => ({ ra: ra + s.dx / cd, dec: dec + s.dy, pmra: 0, pmdec: 0, mag: 20 - 2.5 * Math.log10(s.f0 / 2), id: "SIM" + i }))
    .filter((g) => Math.hypot((g.ra - ra) * cd, g.dec - dec) < radius);
  return { gaia, wise: gaia.slice(0, 8).map((g) => ({ ...g, mag: (g.mag ?? 15) - 2 })), note: "SIMULATED catalog" };
}

// ---------- FITS writer
function card(k: string, v: string | number | boolean, comment = ""): string {
  let val: string;
  if (typeof v === "string") val = `'${v.replace(/'/g, "''").padEnd(8)}'`.padStart(20);
  else if (typeof v === "boolean") val = (v ? "T" : "F").padStart(20);
  else val = String(Number.isInteger(v) ? v : Number(v.toPrecision(15))).padStart(20);
  return (k.padEnd(8) + "= " + val + (comment ? " / " + comment : "")).padEnd(80).slice(0, 80);
}
function headerBlock(cards: string[]): Buffer {
  const all = [...cards, "END".padEnd(80)];
  const txt = all.join("");
  const padded = txt.padEnd(Math.ceil(txt.length / 2880) * 2880);
  return Buffer.from(padded, "latin1");
}
function imageHdu(name: string, data: Float32Array | Int32Array, w: number, h: number, extra: string[] = []): Buffer {
  const isF = data instanceof Float32Array;
  const cards = [
    card("XTENSION", "IMAGE"), card("BITPIX", isF ? -32 : 32), card("NAXIS", 2), card("NAXIS1", w), card("NAXIS2", h),
    card("PCOUNT", 0), card("GCOUNT", 1), card("EXTNAME", name), ...extra,
  ];
  const body = Buffer.alloc(Math.ceil((w * h * 4) / 2880) * 2880);
  for (let i = 0; i < w * h; i++) {
    if (isF) body.writeFloatBE(data[i], i * 4);
    else body.writeInt32BE(data[i], i * 4);
  }
  return Buffer.concat([headerBlock(cards), body]);
}

export function mockCutoutFits(ra: number, dec: number, sizeDeg: number, obsIndex: number, det: number, mjd: number): Buffer {
  const r = rng(hash(ra, dec) ^ (obsIndex * 2654435761));
  const n = Math.max(24, Math.round((sizeDeg * 3600) / NATIVE_SCALE_ARCSEC));
  const theta = r() * Math.PI * 2; // random roll, like real SPHEREx tiles
  const s = NATIVE_SCALE_ARCSEC / 3600;
  const jit = [(r() - 0.5) * 4, (r() - 0.5) * 4];
  const wcs: Wcs = {
    crpix: [n / 2 + 0.5 + jit[0], n / 2 + 0.5 + jit[1]],
    crval: [ra, dec],
    cd: [-s * Math.cos(theta), s * Math.sin(theta), s * Math.sin(theta), s * Math.cos(theta)],
  };
  const band = BANDS[det - 1];
  const lam = band.lo + (band.hi - band.lo) * (0.2 + 0.6 * r());
  const img = new Float32Array(n * n);
  const flags = new Int32Array(n * n);
  const noise = 0.03;
  const zodi = 0.4 * Math.pow(lam / 2, 1.5);
  for (let i = 0; i < img.length; i++) {
    const u1 = r() || 1e-9, u2 = r();
    img[i] = zodi + noise * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  const sigma = 1.0 + 0.3 * lam / 3;
  for (const st of mockSky(ra, dec)) {
    const [sra, sdec] = starPos(st, ra, dec, mjd);
    const p = sky2pix(wcs, sra, sdec);
    if (!p) continue;
    let amp = st.f0 * Math.pow(lam / 2, st.slope);
    if (st.kind === "variable") amp *= 1 + 0.45 * Math.sin((2 * Math.PI * (mjd - T0)) / (st.period ?? 300));
    const x0 = Math.floor(p[0]), y0 = Math.floor(p[1]);
    for (let y = y0 - 5; y <= y0 + 5; y++) {
      for (let x = x0 - 5; x <= x0 + 5; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d2 = (x - p[0]) ** 2 + (y - p[1]) ** 2;
        img[y * n + x] += amp * Math.exp(-d2 / (2 * sigma * sigma));
      }
    }
  }
  // a few bad pixels
  for (let k = 0; k < Math.floor(n * n * 0.004); k++) {
    const i = Math.floor(r() * n * n);
    flags[i] |= 1 << 10; // HOT
  }
  // flag the SOURCE bit near bright pixels (bit 21) just like the real pipeline does
  for (let i = 0; i < img.length; i++) if (img[i] > zodi + 8 * noise) flags[i] |= 1 << 21;

  const prim = headerBlock([
    card("SIMPLE", true), card("BITPIX", 8), card("NAXIS", 0), card("EXTEND", true),
    card("VERSION", "SIMULATED", "demo data"), card("DETECTOR", det),
  ]);
  const wcsCards = [
    card("CTYPE1", "RA---TAN"), card("CTYPE2", "DEC--TAN"),
    card("CRPIX1", wcs.crpix[0]), card("CRPIX2", wcs.crpix[1]),
    card("CRVAL1", wcs.crval[0]), card("CRVAL2", wcs.crval[1]),
    card("CD1_1", wcs.cd[0]), card("CD1_2", wcs.cd[1]), card("CD2_1", wcs.cd[2]), card("CD2_2", wcs.cd[3]),
    card("BUNIT", "MJy/sr"), card("DETECTOR", det),
  ];
  const maskCards = [card("MSKN10", "HOT"), card("MSKN11", "COLD"), card("MSKN19", "OUTLIER"), card("MSKN21", "SOURCE")];
  void pix2sky;
  return Buffer.concat([
    prim,
    imageHdu("IMAGE", img, n, n, wcsCards),
    imageHdu("FLAGS", flags, n, n, maskCards),
  ]);
}
