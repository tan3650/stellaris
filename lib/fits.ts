// Minimal, dependency-free FITS reader (server side) for SPHEREx spectral-image cutouts.
import type { Term, Wcs } from "./shared";

export type CardValue = string | number | boolean | null;
export interface Hdu {
  header: Record<string, CardValue>;
  cards: string[];
  dataStart: number;
  dataLen: number;
  extname: string;
}

const BLOCK = 2880;

function parseValue(raw: string): CardValue {
  const s = raw.trim();
  if (s.startsWith("'")) {
    let out = "";
    let i = 1;
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        break;
      }
      out += s[i++];
    }
    return out.trimEnd();
  }
  const slash = s.indexOf("/");
  const core = (slash >= 0 ? s.slice(0, slash) : s).trim();
  if (core === "T") return true;
  if (core === "F") return false;
  if (core === "") return null;
  const n = Number(core.replace(/[dD]/, "E"));
  return Number.isFinite(n) ? n : core;
}

export function parseFits(buf: Uint8Array): Hdu[] {
  const hdus: Hdu[] = [];
  let pos = 0;
  while (pos + BLOCK <= buf.length) {
    const cards: string[] = [];
    const header: Record<string, CardValue> = {};
    let ended = false;
    while (!ended) {
      if (pos + BLOCK > buf.length) throw new Error("Truncated FITS header");
      for (let c = 0; c < 36; c++) {
        const card = Buffer.from(buf.subarray(pos + c * 80, pos + (c + 1) * 80)).toString("latin1");
        const key = card.slice(0, 8).trim();
        if (key === "END") { ended = true; break; }
        cards.push(card);
        if (card[8] === "=" && key) header[key] = parseValue(card.slice(10));
      }
      pos += BLOCK;
    }
    const bitpix = Number(header.BITPIX ?? 8);
    const naxis = Number(header.NAXIS ?? 0);
    let n = naxis > 0 ? 1 : 0;
    for (let i = 1; i <= naxis; i++) n *= Number(header["NAXIS" + i] ?? 0);
    const pcount = Number(header.PCOUNT ?? 0);
    const gcount = Number(header.GCOUNT ?? 1);
    const dataLen = (Math.abs(bitpix) / 8) * gcount * (pcount + n);
    hdus.push({
      header,
      cards,
      dataStart: pos,
      dataLen,
      extname: String(header.EXTNAME ?? "").toUpperCase(),
    });
    pos += Math.ceil(dataLen / BLOCK) * BLOCK;
  }
  if (!hdus.length) throw new Error("Not a FITS file");
  return hdus;
}

/** Read a 2-D image HDU into Float64-safe typed array applying BSCALE/BZERO. */
export function readImage(buf: Uint8Array, hdu: Hdu): { data: Float64Array; w: number; h: number } {
  const bitpix = Number(hdu.header.BITPIX);
  const w = Number(hdu.header.NAXIS1);
  const h = Number(hdu.header.NAXIS2);
  const bscale = Number(hdu.header.BSCALE ?? 1);
  const bzero = Number(hdu.header.BZERO ?? 0);
  const dv = new DataView(buf.buffer, buf.byteOffset + hdu.dataStart, hdu.dataLen);
  const out = new Float64Array(w * h);
  for (let i = 0; i < out.length; i++) {
    let v: number;
    switch (bitpix) {
      case -32: v = dv.getFloat32(i * 4, false); break;
      case -64: v = dv.getFloat64(i * 8, false); break;
      case 32: v = dv.getInt32(i * 4, false); break;
      case 16: v = dv.getInt16(i * 2, false); break;
      case 8: v = dv.getUint8(i); break;
      default: throw new Error("Unsupported BITPIX " + bitpix);
    }
    out[i] = v * bscale + bzero;
  }
  return { data: out, w, h };
}

/** Read the first row of a BINTABLE into named float arrays (used for the WCS-WAVE lookup table). */
export function readBintableRow(buf: Uint8Array, hdu: Hdu): Record<string, number[]> {
  const tfields = Number(hdu.header.TFIELDS ?? 0);
  const dv = new DataView(buf.buffer, buf.byteOffset + hdu.dataStart, hdu.dataLen);
  let off = 0;
  const out: Record<string, number[]> = {};
  for (let i = 1; i <= tfields; i++) {
    const name = String(hdu.header["TTYPE" + i] ?? "COL" + i).toUpperCase();
    const form = String(hdu.header["TFORM" + i] ?? "");
    const m = /^(\d*)([A-Z])/.exec(form);
    if (!m) break;
    const rep = m[1] === "" ? 1 : Number(m[1]);
    const t = m[2];
    const size = { E: 4, D: 8, J: 4, I: 2, B: 1, K: 8 }[t as "E"];
    if (!size) break;
    const arr: number[] = [];
    for (let k = 0; k < rep; k++) {
      const p = off + k * size;
      if (t === "E") arr.push(dv.getFloat32(p, false));
      else if (t === "D") arr.push(dv.getFloat64(p, false));
      else if (t === "J") arr.push(dv.getInt32(p, false));
      else if (t === "I") arr.push(dv.getInt16(p, false));
      else if (t === "B") arr.push(dv.getUint8(p));
      else if (t === "K") arr.push(Number(dv.getBigInt64(p, false)));
    }
    out[name] = arr;
    off += rep * size;
  }
  return out;
}

function sipTerms(h: Record<string, CardValue>, prefix: string): Term[] {
  const order = Number(h[prefix + "_ORDER"] ?? -1);
  const terms: Term[] = [];
  if (order < 0) return terms;
  for (let p = 0; p <= order; p++) {
    for (let q = 0; q <= order - p; q++) {
      const v = h[`${prefix}_${p}_${q}`];
      if (typeof v === "number" && v !== 0) terms.push([p, q, v]);
    }
  }
  return terms;
}

/** Build a Wcs (TAN + optional SIP) from an image-HDU header. */
export function wcsFromHeader(h: Record<string, CardValue>): Wcs {
  const n = (k: string, d = 0) => (typeof h[k] === "number" ? (h[k] as number) : d);
  let cd: [number, number, number, number];
  if ("CD1_1" in h) {
    cd = [n("CD1_1"), n("CD1_2"), n("CD2_1"), n("CD2_2")];
  } else {
    const pc = [n("PC1_1", 1), n("PC1_2"), n("PC2_1"), n("PC2_2", 1)];
    const c1 = n("CDELT1", 1);
    const c2 = n("CDELT2", 1);
    cd = [c1 * pc[0], c1 * pc[1], c2 * pc[2], c2 * pc[3]];
  }
  const wcs: Wcs = {
    crpix: [n("CRPIX1"), n("CRPIX2")],
    crval: [n("CRVAL1"), n("CRVAL2")],
    cd,
  };
  const a = sipTerms(h, "A");
  const b = sipTerms(h, "B");
  if (a.length || b.length) {
    wcs.sip = { a, b, ap: sipTerms(h, "AP"), bp: sipTerms(h, "BP") };
  }
  return wcs;
}
