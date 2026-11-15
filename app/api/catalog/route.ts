import { NextRequest, NextResponse } from "next/server";
import type { CatalogPayload, CatalogStar } from "@/lib/shared";
import { mockCatalog } from "@/lib/mock";

export const runtime = "nodejs";
export const maxDuration = 30;

const TAP = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync";

async function tap(query: string): Promise<Record<string, string>[]> {
  const body = new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: query });
  const r = await fetch(TAP, { method: "POST", body, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("VizieR HTTP " + r.status);
  const lines = (await r.text()).trim().split(/\r?\n/);
  const head = lines.shift()!.split(",").map((h) => h.replace(/"/g, "").trim());
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v.replace(/"/g, "").trim()])));
}
const num = (s?: string) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ra = Number(sp.get("ra"));
  const dec = Number(sp.get("dec"));
  const r = Math.min(0.5, Number(sp.get("r") ?? 0.1));
  if (![ra, dec, r].every(Number.isFinite)) return NextResponse.json({ error: "bad params" }, { status: 400 });
  if (sp.get("demo") === "1") return NextResponse.json(mockCatalog(ra, dec, r));

  const circle = `1=CONTAINS(POINT('ICRS',%RA%,%DEC%),CIRCLE('ICRS',${ra},${dec},${r}))`;
  const out: CatalogPayload = { gaia: [], wise: [] };
  const notes: string[] = [];
  const [g, w] = await Promise.allSettled([
    tap(`SELECT TOP 1500 Source,RA_ICRS,DE_ICRS,pmRA,pmDE,Gmag FROM "I/355/gaiadr3" WHERE ${circle.replace("%RA%", "RA_ICRS").replace("%DEC%", "DE_ICRS")} ORDER BY Gmag`),
    tap(`SELECT TOP 1500 AllWISE,RAJ2000,DEJ2000,pmRA,pmDE,W1mag FROM "II/328/allwise" WHERE ${circle.replace("%RA%", "RAJ2000").replace("%DEC%", "DEJ2000")} ORDER BY W1mag`),
  ]);
  if (g.status === "fulfilled") {
    out.gaia = g.value.flatMap((x): CatalogStar[] => {
      const a = num(x.RA_ICRS), d = num(x.DE_ICRS);
      return a == null || d == null ? [] : [{ ra: a, dec: d, pmra: num(x.pmRA) ?? 0, pmdec: num(x.pmDE) ?? 0, mag: num(x.Gmag), id: x.Source }];
    });
  } else notes.push("Gaia unavailable");
  if (w.status === "fulfilled") {
    out.wise = w.value.flatMap((x): CatalogStar[] => {
      const a = num(x.RAJ2000), d = num(x.DEJ2000);
      return a == null || d == null ? [] : [{ ra: a, dec: d, pmra: num(x.pmRA) ?? 0, pmdec: num(x.pmDE) ?? 0, mag: num(x.W1mag), id: x.AllWISE }];
    });
  } else notes.push("AllWISE unavailable");
  if (notes.length) out.note = notes.join("; ");
  return NextResponse.json(out, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
}
