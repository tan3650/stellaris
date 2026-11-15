// Run: npm test  (cross-checks FITS/WCS/cutout code against an astropy-written reference file if present)
import { readFileSync, existsSync } from "fs";
import { processCutout } from "../lib/cutout";
import { pix2sky, sky2pix, reproject, grid2sky, sky2grid } from "../lib/wcs";
import { unpackHalf, toHalf, fromHalf } from "../lib/f16";
import { mockCutoutFits } from "../lib/mock";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const near = (a: number, b: number, t: number) => Math.abs(a - b) <= t;

// f16
for (const v of [0, 1, -2.5, 0.0123, 1234.5, 60000]) ok(near(fromHalf(toHalf(v)), v, Math.abs(v) * 1e-3 + 1e-6), "f16 roundtrip " + v);
ok(Number.isNaN(fromHalf(toHalf(NaN))), "f16 NaN");

const ref = process.argv[2];
if (ref && existsSync(ref)) {
  const truth = JSON.parse(readFileSync(ref + ".json", "utf8"));
  const p = processCutout(new Uint8Array(readFileSync(ref)), { wlLo: 2.42, wlHi: 3.82, detector: 4 });
  ok(p.w === 80 && p.h === 80, "size 80x80");
  for (const [x, y, ra, dec] of truth.pix2sky) {
    const [r2, d2] = pix2sky(p.wcs, x, y);
    ok(near(r2, ra, 1e-8) && near(d2, dec, 1e-8), `pix2sky(SIP) (${x},${y}) matches astropy  d=${(Math.hypot((r2 - ra) * Math.cos(dec * Math.PI / 180), d2 - dec) * 3600).toExponential(2)}"`);
  }
  const [ra, dec, ex, ey] = truth.sky2pix;
  const q = sky2pix(p.wcs, ra, dec)!;
  ok(near(q[0], ex, 0.01) && near(q[1], ey, 0.01), `sky2pix matches astropy (${q[0].toFixed(3)},${q[1].toFixed(3)}) vs (${ex.toFixed(3)},${ey.toFixed(3)})`);
  const img = unpackHalf(new Uint16Array(Buffer.from(p.image, "base64").buffer.slice(0)));
  ok(Number.isNaN(img[5 * 80 + 5]), "NaN pixel preserved");
  ok(Number.isNaN(img[10 * 80 + 10]), "HOT flag (bit10) masked");
  ok(!Number.isNaN(img[20 * 80 + 20]), "OUTLIER (bit19) NOT masked");
  ok(!Number.isNaN(img[30 * 80 + 30]), "SOURCE (bit21) NOT masked");
  ok(p.meta.detector === 4 && p.meta.version === "v27", "meta detector/version");
  // WCS-WAVE: cutout centre x=40 -> original x = 40 - LTV1(-100) = 140 -> lambda ~ 2.42+1.4*(140/2040) ~ 2.516
  ok(p.wl.src === "wcs-wave" && near(p.wl.mid, 2.42 + 1.4 * (140 / 2040), 0.02), `WCS-WAVE lookup λ=${p.wl.mid.toFixed(3)} (src ${p.wl.src})`);
}

// round-trip reprojection with the in-house mock FITS (rotated random roll)
{
  const bytes = mockCutoutFits(269.4463, 4.7679, 0.14, 7, 5, 60900);
  const p = processCutout(new Uint8Array(bytes), { wlLo: 3.83, wlHi: 4.41, detector: 5 });
  const g = { n: 128, ra0: 269.4463, dec0: 4.7679, scaleDeg: 0.1 / 128 };
  const img = unpackHalf(new Uint16Array(Buffer.from(p.image, "base64").buffer.slice(0)));
  const out = reproject(img, p.w, p.h, p.wcs, g);
  const valid = out.filter((v) => Number.isFinite(v)).length;
  ok(valid / out.length > 0.97, `reprojected grid ${(100 * valid / out.length).toFixed(1)}% valid`);
  const [ra, dec] = grid2sky(g, 40.3, 77.7);
  const back = sky2grid(g, ra, dec)!;
  ok(near(back[0], 40.3, 1e-6) && near(back[1], 77.7, 1e-6), "grid2sky/sky2grid round trip");
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
