import Link from "next/link";
import { BANDS } from "@/lib/shared";
import { CHANNELS, EXAMPLE_CUTOUT, HIPS, LINES, PHOT, RELEASES, TAP_QUERY, TARGETS, TOOLS } from "@/lib/realdata";

export const metadata = { title: "Real data & docs – SPHEREx Blink" };

function Win({ title, children, active }: { title: string; children: React.ReactNode; active?: boolean }) {
  return (<section className="win"><div className={"wtitle" + (active ? "" : " off")}><span>{title}</span><span className="wb">_ ▫ x</span></div><div className="wbody">{children}</div></section>);
}

function PhotChart() {
  const W = 520, H = 220, L = 52, R = 14, T = 14, B = 34;
  const x0 = 0.74, x1 = 0.95, y1 = 600;
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R), Y = (v: number) => H - B - (v / y1) * (H - B - T);
  const line = (i: 2 | 3) => PHOT.map((p) => `${X(p[1])},${Y(p[i])}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chartsvg" role="img" aria-label="Real SPHEREx quick-look flux, first 10 channels">
      {[0, 200, 400, 600].map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#4a3b70" /><text x={L - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#cdbff0">{v}</text></g>)}
      {[0.75, 0.8, 0.85, 0.9, 0.95].map((v) => <text key={v} x={X(v)} y={H - 16} textAnchor="middle" fontSize="11" fill="#cdbff0">{v}</text>)}
      <text x={(L + W - R) / 2} y={H - 3} textAnchor="middle" fontSize="11" fill="#fee440">wavelength (µm)</text>
      <text transform={`translate(12 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="#fee440">flux (mJy)</text>
      <polyline points={line(2)} fill="none" stroke="#9a5de8" strokeWidth="1.5" /><polyline points={line(3)} fill="none" stroke="#f15bb5" strokeWidth="2" />
      {PHOT.map((p) => <circle key={p[0]} cx={X(p[1])} cy={Y(p[3])} r="3.5" fill="#fee440" />)}
      <text x={X(0.91) + 6} y={Y(511) + 4} fontSize="11" fill="#fff">plane 8: 511 mJy</text>
      <text x={L + 6} y={T + 8} fontSize="11" fill="#9a5de8">— total</text><text x={L + 56} y={T + 8} fontSize="11" fill="#f15bb5">— background-subtracted</text>
    </svg>
  );
}

export default function DataPage() {
  return (
    <main className="page">
      <div className="note"><b>Everything on this page is real</b>: values were copied from IRSA&apos;s SPHEREx tutorials (Caltech/IPAC-IRSA). Only the first rows of long tables are shown. <Link href="/">← Back to the blink tool</Link></div>

      <Win title="Real SPHEREx spectrum – first 10 channels" active>
        <p>Quick-look photometry at RA 60.8109955°, Dec 51.3404038° from the DR1 all-sky cube (5-pixel aperture, local background removed). These 10 channels cover 0.75–0.93 µm, a small part of the full 102-channel, 0.75–5 µm spectrum. The jump at plane 8 (0.910 µm) is in the published table.</p>
        <PhotChart />
        <table className="info"><thead><tr><th>Plane</th><th>λ (µm)</th><th>Flux (mJy)</th><th>Background-subtracted (mJy)</th></tr></thead>
          <tbody>{PHOT.map((p) => <tr key={p[0]}><td>{p[0]}</td><td>{p[1].toFixed(3)}</td><td>{p[2].toFixed(3)}</td><td>{p[3].toFixed(3)}</td></tr>)}</tbody></table>
        <p className="hint">The IRSA tutorial says cube spectra are for visualisation only; for science use IRSA&apos;s Spectrophotometry Tool. Features it marks on spectra:</p>
        <p>{LINES.map(([w, n]) => <span key={n} className="tag">{n} · {w} µm</span>)}</p>
      </Win>

      <Win title="Test positions from the IRSA tutorials">
        <table className="info"><thead><tr><th>Target</th><th>RA°</th><th>Dec°</th><th>Tutorial note</th><th></th></tr></thead>
          <tbody>{TARGETS.map((t) => <tr key={t.name}><td>{t.name}</td><td>{t.ra}</td><td>{t.dec}</td><td>{t.note}</td>
            <td><a className="btn" href={`/?ra=${t.ra}&dec=${t.dec}&fov=${t.fov}`}>Blink it</a></td></tr>)}</tbody></table>
      </Win>

      <Win title="The 102 spectral channels (first 10 shown)">
        <p>Six detectors, 17 channels each. Cube frame index = 17×(band−1) + (channel−1). Frames 50 and 51 (the dichroic channels, band 3 ch 17 and band 4 ch 1) are blank in the all-sky cube.</p>
        <table className="info"><thead><tr><th>Det</th><th>Chan</th><th>λ µm</th><th>λ min</th><th>λ max</th><th>R</th><th>R std</th><th>Bandwidth µm</th></tr></thead>
          <tbody>{CHANNELS.map((c, i) => <tr key={i}>{c.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table>
        <h2>Detector bands</h2>
        <table className="info"><thead><tr><th>Detector</th><th>Wavelength (µm)</th><th>Resolving power R</th></tr></thead>
          <tbody>{BANDS.map((b) => <tr key={b.id}><td>D{b.id}</td><td>{b.lo}–{b.hi}</td><td>{b.r}</td></tr>)}</tbody></table>
      </Win>

      <Win title="How this tool gets the data">
        <p>The tutorials query IRSA&apos;s TAP service. It sees new data right after weekly ingestion, while the SIA service lags by about a day. QR3 and DR1 supersede QR2, and IRSA searches no longer return QR2 images, so this app searches <span className="mono">spherex_dr1</span> and <span className="mono">spherex_qr3</span>.</p>
        <pre>{TAP_QUERY}</pre>
        <p>Each result is cut out on the server with a URL of this form (center in degrees, size in degrees):</p>
        <pre>{EXAMPLE_CUTOUT}</pre>
        <ul>
          <li>Cutout files hold IMAGE, FLAGS, VARIANCE, ZODI, EPSF and WCS-WAVE extensions. The tutorials note occasional transient read errors, so this app retries each cutout up to 3 times.</li>
          <li>Flags: the Source Discovery tutorial keeps pixels with flag value 0, 2 or 2097152 and treats HOT, COLD, TRANSIENT, NONFUNC, GHOST, STREAK, PERSIST and others as bad.</li>
          <li>Images with processing version ≥ 7.0 (QR3, DR1) carry the newer ePSF model; older QR1/QR2 data carry the old PSF.</li>
          <li>Flux: [mJy] = [MJy/sr] × 23.5045 × (pixel scale in arcsec)² / 1000. SPHEREx detector pixels are 6.15″.</li>
          <li>All-sky HiPS cube (order 0–5, 102 layers): <a href={HIPS.viewer} target="_blank" rel="noreferrer">viewer root</a> · data root <span className="mono">{HIPS.data}</span>. The 3.3 µm layer is index 62.</li>
        </ul>
      </Win>

      <Win title="About the SPHEREx mission">
        <table className="info"><tbody>
          <tr><th>Lifetime</th><td>2025 – 2027 (planned)</td></tr><tr><th>Area coverage</th><td>100% of sky (planned)</td></tr>
          <tr><th>Instrument</th><td>Wide Field Linear Variable Filter (LVF) Imaging Spectrograph</td></tr><tr><th>Funding agency</th><td>NASA</td></tr>
          <tr><th>Institutions</th><td>JPL, Caltech, RIT, Harvard/CFA, Arizona State, University of Arizona, Ohio State University, KASI, UC Irvine, Johns Hopkins, ASIAA</td></tr>
          <tr><th>Papers</th><td>Mission: Bock et al (2026) · Pipeline: Akeson et al (2026) · Sky Simulator: Crill et al. (2025) · Instrument &amp; Calibration: Korngut et al. (2026)</td></tr>
        </tbody></table>
        <h2>Releases</h2>
        <table className="info"><tbody>{RELEASES.map(([d, t]) => <tr key={d}><th>{d}</th><td>{t}</td></tr>)}</tbody></table>
        <h2>IRSA tools</h2>
        <table className="info"><tbody>{TOOLS.map(([n, t]) => <tr key={n}><th>{n}</th><td>{t}</td></tr>)}</tbody></table>
        <p><a href="https://irsa.ipac.caltech.edu/Missions/spherex.html" target="_blank" rel="noreferrer">IRSA SPHEREx page</a> · <a href="https://caltech-ipac.github.io/irsa-tutorials/spherex/" target="_blank" rel="noreferrer">IRSA tutorials</a></p>
        <div className="note"><b>Please acknowledge SPHEREx in published work:</b> “This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.”</div>
      </Win>
    </main>
  );
}
