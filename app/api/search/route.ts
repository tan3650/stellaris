import { NextRequest, NextResponse } from "next/server";
import { COLLECTIONS, SIA_URL, type Observation } from "@/lib/shared";
import { mockObservations } from "@/lib/mock";

export const runtime = "nodejs";
export const maxDuration = 30;

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { cur.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(f); f = "";
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
    } else f += c;
  }
  if (f !== "" || cur.length) { cur.push(f); rows.push(cur); }
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

function parseVoTable(text: string): Record<string, string>[] {
  const fields = [...text.matchAll(/<FIELD\b[^>]*?\bname="([^"]+)"/gi)].map((m) => m[1].toLowerCase());
  const out: Record<string, string>[] = [];
  for (const tr of text.matchAll(/<TR>([\s\S]*?)<\/TR>/gi)) {
    const tds = [...tr[1].matchAll(/<TD>([\s\S]*?)<\/TD>/gi)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim());
    out.push(Object.fromEntries(fields.map((f, i) => [f, tds[i] ?? ""])));
  }
  return out;
}

const toUm = (v: string | undefined) => {
  const n = v ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return n < 1e-3 ? n * 1e6 : n; // obscore em_* are in metres
};

async function querySia(collection: string, ra: number, dec: number, rad: number) {
  const base = `${SIA_URL}?COLLECTION=${collection}&POS=circle+${ra.toFixed(6)}+${dec.toFixed(6)}+${rad}`;
  let res = await fetch(base + "&RESPONSEFORMAT=CSV", { signal: AbortSignal.timeout(25000) });
  let text = res.ok ? await res.text() : "";
  if (!res.ok || text.trimStart().startsWith("<")) {
    res = await fetch(base, { signal: AbortSignal.timeout(25000) }); // default VOTable
    if (!res.ok) throw new Error(`IRSA SIA ${collection}: HTTP ${res.status}`);
    text = await res.text();
  }
  const rows = text.trimStart().startsWith("<") ? parseVoTable(text) : parseCsv(text);
  const obs: Observation[] = [];
  for (const r of rows) {
    const url = r["access_url"];
    if (!url || !/\.fits/i.test(url)) continue;
    const det = /_2?D(\d)_/.exec(url) ?? /D(\d)_spx/.exec(url);
    if (!det) continue;
    const t0 = Number(r["t_min"]), t1 = Number(r["t_max"]);
    obs.push({
      id: url.split("/").pop()!.replace(/\.fits.*/, "").replace(/^level2_/, ""),
      url: url.split("?")[0],
      detector: Number(det[1]),
      tMjd: Number.isFinite(t0) ? (Number.isFinite(t1) ? (t0 + t1) / 2 : t0) : null,
      wlLo: toUm(r["em_min"]),
      wlHi: toUm(r["em_max"]),
      collection,
    });
  }
  return obs;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ra = Number(sp.get("ra"));
  const dec = Number(sp.get("dec"));
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || Math.abs(dec) > 90) {
    return NextResponse.json({ error: "ra/dec required (degrees)" }, { status: 400 });
  }
  if (sp.get("demo") === "1") {
    return NextResponse.json({ observations: mockObservations(ra, dec), source: "SIMULATED", errors: [] });
  }
  const results = await Promise.allSettled(COLLECTIONS.map((c) => querySia(c, ra, dec, 0.005)));
  const seen = new Set<string>();
  const observations: Observation[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const o of r.value) if (!seen.has(o.url)) { seen.add(o.url); observations.push(o); }
    } else errors.push(`${COLLECTIONS[i]}: ${String(r.reason?.message ?? r.reason)}`);
  });
  observations.sort((a, b) => (a.tMjd ?? 0) - (b.tMjd ?? 0));
  if (!observations.length && errors.length === COLLECTIONS.length) {
    return NextResponse.json({ error: "Could not reach the IRSA archive", errors }, { status: 502 });
  }
  return NextResponse.json(
    { observations, source: "IRSA SIA2", errors },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
