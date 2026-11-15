import { NextRequest, NextResponse } from "next/server";
import { IRSA_DATA_PREFIX } from "@/lib/shared";
import { processCutout } from "@/lib/cutout";
import { mockCutoutFits } from "@/lib/mock";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const url = sp.get("url") ?? "";
  const ra = Number(sp.get("ra"));
  const dec = Number(sp.get("dec"));
  const size = Number(sp.get("size"));
  const wlLo = sp.get("wlLo") ? Number(sp.get("wlLo")) : null;
  const wlHi = sp.get("wlHi") ? Number(sp.get("wlHi")) : null;
  const det = sp.get("det") ? Number(sp.get("det")) : null;
  if (![ra, dec, size].every(Number.isFinite) || size <= 0 || size > 1) {
    return NextResponse.json({ error: "bad ra/dec/size (size in deg, <=1)" }, { status: 400 });
  }
  try {
    let bytes: Uint8Array;
    if (url.startsWith("mock://")) {
      const [idx, d, mjd] = url.slice(7).split("/");
      bytes = mockCutoutFits(ra, dec, size, Number(idx), Number(d), Number(mjd));
    } else {
      // SSRF guard: only SPHEREx files on IRSA
      if (!url.startsWith(IRSA_DATA_PREFIX) || url.includes("?") || !/\.fits$/i.test(url)) {
        return NextResponse.json({ error: "url must be an IRSA SPHEREx FITS file" }, { status: 400 });
      }
      const src = `${url}?center=${ra.toFixed(6)},${dec.toFixed(6)}d&size=${size.toFixed(5)}`;
      // IRSA's own tutorials report occasional transient read errors on cutouts: retry a few times.
      let r: Response | null = null, lastErr = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          r = await fetch(src, { signal: AbortSignal.timeout(20000) });
          if (r.ok) break;
          lastErr = `IRSA cutout HTTP ${r.status}`;
          if (r.status < 500 && r.status !== 429) break;
        } catch (e) { lastErr = String((e as Error).message ?? e); r = null; }
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
      if (!r || !r.ok) return NextResponse.json({ error: lastErr || "IRSA cutout failed" }, { status: 502 });
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    const payload = processCutout(bytes, { wlLo, wlHi, detector: det });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000, immutable" },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
