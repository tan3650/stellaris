import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Name -> coordinates via CDS Sesame (SIMBAD/NED/VizieR). */
export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get("name") ?? "").trim();
  if (!name || name.length > 80) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const r = await fetch(`https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(12000),
    });
    const t = await r.text();
    const m = /%J\s+([\d.]+)\s+([+-]?[\d.]+)/.exec(t);
    if (!m) return NextResponse.json({ error: `Could not resolve "${name}"` }, { status: 404 });
    const label = /%I\.0\s+(.+)/.exec(t)?.[1]?.trim() ?? name;
    const pm = /%P\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)/.exec(t);
    return NextResponse.json(
      { ra: Number(m[1]), dec: Number(m[2]), name: label, pmra: pm ? Number(pm[1]) : 0, pmdec: pm ? Number(pm[2]) : 0 },
      { headers: { "Cache-Control": "public, s-maxage=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "Name resolver unreachable" }, { status: 502 });
  }
}
