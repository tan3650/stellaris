# SPHEREx Blink 🛰️

A public web tool for NASA's SPHEREx near-infrared sky survey. Enter a position (or an object name), and it
pulls every SPHEREx exposure covering that patch of sky, aligns them onto one north-up grid, and plays them like a
short video, so moving objects (asteroids, comets, brown dwarfs, high-proper-motion stars) jump out.
Built for the 2026 NASA Space Apps Challenge, *Planet X and SPHEREx*.

## What it does (mapped to the challenge)

| Challenge ask | Implementation |
|---|---|
| Enter RA/Dec, show a "little video" of the patch | RA/Dec in degrees or sexagesimal, plus a name resolver (SIMBAD/NED via CDS Sesame). Blink player with play/step/scrub/speed. Timeline coloured by band. |
| Test targets | One-click presets: WISE 0855−0714, Barnard's Star, ε Indi B, RW Aurigae, R Draconis. |
| Use the 102 bands creatively | Six detector arrays shown as toggleable bands. **Stack** same-epoch exposures (per band or all) to raise S/N. |
| Spectra on the fly | Click any pixel → aperture photometry on every loaded exposure → **spectrum** (flux vs wavelength). |
| Variable stars | Same click → **light curve** (flux vs date). |
| Add / subtract images | **Difference imaging**: subtract per-band median, or previous frame. |
| Choose field of view | 1.8′ – 30′ slider. Cutouts are fetched server-side from IRSA at the requested size. |
| Overlay Gaia / WISE | Gaia DR3 + AllWISE from VizieR. Gaia positions are **moved to each frame's date** with proper motion, so a source that does *not* follow a Gaia track is a candidate. |
| Metadata / contamination flags | Per-frame masked-pixel %, flag-aware masking (HOT, COLD, TRANSIENT, … read from the FLAGS header), table with a link to the raw cutout. OUTLIER/SOURCE flags are deliberately *not* masked. |
| Easy to update with new data | The archive is queried live (SIA2) on every request. New release = add one string to `COLLECTIONS` in `lib/shared.ts`. |
| Query by URL / embed | Everything is in the URL: `?ra=…&dec=…&fov=…&bands=…`. Add `&embed=1` for a chrome-free iframe. "Copy shareable link" button. |

Extras: proper-motion tracking for presets, WebM/PNG export of the blink, keyboard control (space, ←/→), phone layout,
demo mode with simulated data (always labelled SIMULATED).

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # core self-checks
# astropy cross-check (needs: pip install astropy numpy):
python3 scripts/make_astropy_fits.py /tmp/ap.fits && npx tsx scripts/test-core.ts /tmp/ap.fits
npm run build && npm start
```

Try `http://localhost:3000/?demo=1&ra=133.795&dec=-7.245` for the offline simulated demo.

## Deploy (free, ~3 minutes)

There is **no database and no separate backend**: the Next.js API routes proxy IRSA/VizieR/Sesame, and responses are
cached by Vercel's CDN (`s-maxage`), so repeat views are instant. (Supabase isn't needed. If you later want saved
"discoveries" or user accounts, that is where it would plug in.)

1. Push this folder to a GitHub repo.
2. <https://vercel.com/new> → import the repo → framework auto-detects as Next.js → **Deploy**. No environment variables.
3. Share `https://<your-app>.vercel.app/?name=Barnard%27s%20Star` etc.

Alternatives: `npx vercel` from this folder, or any Node host (`npm run build && npm start`).
API routes use `maxDuration` of 30–60 s (fine on Vercel Hobby).

## How it works

```
Browser (Next.js, canvas)                       Next.js API routes                 External
─────────────────────────                       ──────────────────                 ────────
target → /api/search ───────────────────────►   IRSA SIA2 (spherex_qr3, _dr1)  ─►  irsa.ipac.caltech.edu/SIA
for each exposure → /api/cutout ────────────►   <access_url>?center=ra,decd&size=  irsa …/ibe/data/spherex/…
                                                 parse FITS (IMAGE, FLAGS, WCS-WAVE)
                                                 mask bad pixels, float16-pack
◄── packed cutout + WCS (TAN+SIP) + λ + flags
reproject every frame to one north-up grid (client)
stack / difference / stretch / overlay / photometry (client)
catalog overlay → /api/catalog ─────────────►   VizieR TAP (Gaia DR3, AllWISE)
name → /api/resolve ────────────────────────►   CDS Sesame
```

Key files: `lib/fits.ts` (FITS reader), `lib/wcs.ts` (TAN + SIP, reprojection), `lib/cutout.ts` (flags, wavelength),
`lib/engine.ts` (stack/diff/stretch/photometry), `components/App.tsx` (UI), `app/api/*` (proxies).

## Tested vs. not yet tested, read this before the demo

Verified (astropy cross-check above, `npm run build`, and browser tests):
- The FITS parser, SIP WCS (pixel↔sky), flag masking, and the WCS-WAVE lookup-table interpolation agree with
  **astropy** on an independently-written reference file (sub-micro-arcsecond).
- The full pipeline (search → cutout → parse → reproject → blink → difference → spectrum / light curve) runs in a real
  browser in demo mode with zero console errors.

**Not verified: live IRSA/VizieR/Sesame calls.** The environment this was built in could not reach those hosts. The
requests follow IRSA's documented SIA2 + cutout interface, but please open the deployed site once on a real target and
check these four things; each is a one-line fix if IRSA differs:
1. `app/api/search/route.ts`: SIA2 CSV column names (`access_url`, `t_min`, `t_max`, `em_min`, `em_max`); a VOTable fallback is included.
2. `app/api/cutout/route.ts`: cutout query format `?center=<ra>,<dec>d&size=<deg>` (per IRSA's cutout docs).
3. `lib/cutout.ts`: `WCS-WAVE` layout. If it can't be read, wavelength falls back to the detector's SIA2 range (sanity-checked).
4. `app/api/resolve/route.ts`: Sesame `%J` / `%P` lines.

If IRSA is down on demo day, flip to **Demo mode** (checkbox, or `?demo=1`) so you still have a working show.

## Known limitations (be upfront with judges)

- Per-image wavelength inside a cutout is approximate when `WCS-WAVE` is unreadable. IRSA says that table is for visualisation; science work should use the CWAVE/CBAND products.
- Spectra are aperture surface brightness (MJy/sr) minus a local annulus, not calibrated point-source spectrophotometry. For that, use IRSA's SPHEREx Spectrophotometry tool.
- Cutouts are limited to ≤ 30′ FOV and `Max frames` (default 72, spread evenly over time) to keep transfer fast.
- Dense fields near the ecliptic poles can have hundreds of exposures. Raise `Max frames` or narrow bands.

## Suggested 3-minute demo

1. Open **WISE 0855−0714**, band 6 only, **difference imaging → median**, hit **Blink**: the brown dwarf walks across the field.
2. Toggle **Gaia overlay**: the background stars sit in their circles, the mover doesn't.
3. Switch to **Barnard's Star** (proper motion tracking on): it tracks across frames.
4. Click it → **Spectrum** (brown dwarfs rise toward 4–5 µm).
5. **R Draconis** → click the star → **Light curve** shows the variability.
6. Hit **Copy shareable link** → paste into a new tab (and show `&embed=1`).

## Data & credits

NASA/IPAC Infrared Science Archive (SPHEREx), Gaia DR3 and AllWISE via CDS VizieR, CDS Sesame name resolver.
Inspired by WiseView / Backyard Worlds.
