"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chart from "./Chart";
import { BANDS, bandColor, fmtDate, mjdToYear, type CatalogPayload, type Observation } from "@/lib/shared";
import { PRESETS, SPHEREX_EPOCH, propagate, type Preset } from "@/lib/presets";
import { fmtDec, fmtRa, parseAngle } from "@/lib/coords";
import { grid2sky, sky2grid, type Grid } from "@/lib/wcs";
import {
  aperturePhot, applyDiff, limits, maskBrightStars, renderToImageData, stackFrames,
  type CmapName, type DiffMode, type Frame, type PhotPoint, type Stretch, type StretchKind,
} from "@/lib/engine";
import { fetchFrame, gridFor, pool, subsample } from "@/lib/loader";

interface Base { ra: number; dec: number; pmra?: number; pmdec?: number; epoch?: number; name: string }

const niceLen = (arcsec: number) => [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].reduce((b, v) => (v <= arcsec ? v : b), 1);
const fmtLen = (a: number) => (a >= 60 ? `${a / 60}′` : `${a}″`);

export default function App() {
  // ---------- inputs
  const [name, setName] = useState("");
  const [raT, setRaT] = useState("");
  const [decT, setDecT] = useState("");
  const [fov, setFov] = useState(0.15);
  const [bands, setBands] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [maxFrames, setMaxFrames] = useState(72);
  const [demo, setDemo] = useState(false);
  const [usePm, setUsePm] = useState(true);
  const [base, setBase] = useState<Base | null>(null);
  // processing
  const [stackDays, setStackDays] = useState(0);
  const [perBand, setPerBand] = useState(true);
  const [diff, setDiff] = useState<DiffMode>("none");
  // display
  const [kind, setKind] = useState<StretchKind>("asinh");
  const [cmap, setCmap] = useState<CmapName>("inferno");
  const [loP, setLoP] = useState(5);
  const [hiP, setHiP] = useState(99.7);
  const [lock, setLock] = useState(false);
  const [maskOn, setMaskOn] = useState(false);
  const [maskSigma, setMaskSigma] = useState(30);
  const [measure, setMeasure] = useState(false);
  type Mark = { x: number; y: number; ra: number; dec: number; t: number };
  const [marks, setMarks] = useState<Mark[]>([]);
  const [smooth, setSmooth] = useState(true);
  const [showGaia, setShowGaia] = useState(true);
  const [showWise, setShowWise] = useState(false);
  const [showCross, setShowCross] = useState(true);
  const [embed, setEmbed] = useState(false);
  // playback
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(5);
  // data
  const [grid, setGrid] = useState<Grid | null>(null);
  const store = useRef<Map<string, Frame>>(new Map());
  const gridRef = useRef<Grid | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<{ phase: "idle" | "search" | "load" | "done" | "error"; done: number; total: number; failed: number; msg?: string; source?: string; found?: number }>({ phase: "idle", done: 0, total: 0, failed: 0 });
  const runId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  // measurement
  const [sel, setSel] = useState<{ x: number; y: number } | null>(null);
  const [apArcsec, setApArcsec] = useState(9);
  const [chartMode, setChartMode] = useState<"spectrum" | "lightcurve">("spectrum");
  const [toast, setToast] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const say = (m: string) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 2600); };

  // ---------- derived frames
  const display = useMemo(() => {
    const raw = [...store.current.values()].filter((f) => bands.includes(f.det));
    if (!raw.length) return [] as Frame[];
    return applyDiff(stackFrames(raw, { windowDays: stackDays, perBand }), diff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, bands, stackDays, perBand, diff]);
  const cur = display[Math.min(idx, display.length - 1)] as Frame | undefined;
  useEffect(() => { if (idx >= display.length) setIdx(Math.max(0, display.length - 1)); }, [display.length, idx]);

  const lockedLimits = useMemo(() => {
    const m = new Map<number, [number, number]>();
    if (!lock) return m;
    const byDet = new Map<number, Frame[]>();
    for (const f of display) (byDet.get(f.det) ?? byDet.set(f.det, []).get(f.det)!).push(f);
    for (const [d, fs] of byDet) {
      const pooled = new Float32Array(fs.reduce((s, f) => s + Math.ceil(f.grid.length / 5), 0));
      let k = 0;
      for (const f of fs) for (let i = 0; i < f.grid.length; i += 5) pooled[k++] = f.grid[i];
      m.set(d, limits(pooled, loP, hiP));
    }
    return m;
  }, [display, lock, loP, hiP]);

  // ---------- render current frame
  const stretch: Stretch = useMemo(() => ({ kind, lo: loP, hi: hiP, cmap, locked: lock, invert: false }), [kind, loP, hiP, cmap, lock]);
  const maskCache = useRef<{ s: number; m: WeakMap<Float32Array, Float32Array> }>({ s: -1, m: new WeakMap() });
  const masked = useCallback((f: Frame, n: number) => {
    if (maskCache.current.s !== maskSigma) maskCache.current = { s: maskSigma, m: new WeakMap() };
    let r = maskCache.current.m.get(f.grid);
    if (!r) { r = maskBrightStars(f.grid, n, maskSigma); maskCache.current.m.set(f.grid, r); }
    return r;
  }, [maskSigma]);
  const drawFrame = useCallback((cv: HTMLCanvasElement, f: Frame, n: number) => {
    if (cv.width !== n) { cv.width = n; cv.height = n; }
    const ctx = cv.getContext("2d")!;
    const im = ctx.createImageData(n, n);
    const g = maskOn ? masked(f, n) : f.grid;
    const [lo, hi] = lock && !maskOn && lockedLimits.get(f.det) ? lockedLimits.get(f.det)! : limits(g, loP, hiP);
    renderToImageData(g, n, lo, hi, stretch, im);
    ctx.putImageData(im, 0, 0);
  }, [lock, lockedLimits, loP, hiP, stretch, maskOn, masked]);
  useEffect(() => {
    if (cur && grid && canvasRef.current) drawFrame(canvasRef.current, cur, grid.n);
  }, [cur, grid, drawFrame]);

  // ---------- playback
  useEffect(() => {
    if (!playing || display.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % display.length), 1000 / fps);
    return () => clearInterval(t);
  }, [playing, fps, display.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowRight") { setPlaying(false); setIdx((i) => Math.min(display.length - 1, i + 1)); }
      else if (e.key === "ArrowLeft") { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [display.length]);

  // ---------- load data
  const centerOf = (b: Base): [number, number] => (usePm && b.pmra != null && b.epoch != null ? propagate(b, SPHEREX_EPOCH) : [b.ra, b.dec]);

  const run = useCallback(async (b: Base, opts?: { fov?: number; bands?: number[]; demo?: boolean; max?: number; pm?: boolean }) => {
    const f = opts?.fov ?? fov, bs = opts?.bands ?? bands, dm = opts?.demo ?? demo, mx = opts?.max ?? maxFrames, pm = opts?.pm ?? usePm;
    const [ra, dec] = pm && b.pmra != null && b.epoch != null ? propagate(b, SPHEREX_EPOCH) : [b.ra, b.dec];
    const id = ++runId.current;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const g = gridFor(ra, dec, f);
    // reset cache if the field changed
    const old = gridRef.current;
    if (!old || old.ra0 !== g.ra0 || old.dec0 !== g.dec0 || old.scaleDeg !== g.scaleDeg || old.n !== g.n) store.current = new Map();
    gridRef.current = g;
    setGrid(g);
    setBase(b); setIdx(0); setSel({ x: g.n / 2 - 0.5, y: g.n / 2 - 0.5 }); setCatalog(null);
    setVersion((v) => v + 1);
    setStatus({ phase: "search", done: 0, total: 0, failed: 0 });
    pushUrl(b, f, bs, dm, mx, pm);
    try {
      const r = await fetch(`/api/search?ra=${ra}&dec=${dec}${dm ? "&demo=1" : ""}`, { signal: ac.signal });
      const j = await r.json();
      if (id !== runId.current) return;
      if (!r.ok) { setStatus({ phase: "error", done: 0, total: 0, failed: 0, msg: (j.error ?? "Search failed") + (j.errors ? " — " + j.errors.join("; ") : "") }); return; }
      const all: Observation[] = j.observations;
      const want = subsample(all.filter((o) => bs.includes(o.detector)), mx);
      setStatus({ phase: "load", done: 0, total: want.length, failed: 0, source: j.source, found: all.length });
      if (!all.length) { setStatus({ phase: "done", done: 0, total: 0, failed: 0, source: j.source, found: 0 }); return; }
      // catalogue overlay in parallel
      fetch(`/api/catalog?ra=${ra}&dec=${dec}&r=${Math.min(0.5, f * 0.75)}${dm ? "&demo=1" : ""}`).then((x) => x.json()).then((c) => id === runId.current && setCatalog(c)).catch(() => {});
      let done = 0, failed = 0, lastPaint = 0;
      const todo = want.filter((o) => !store.current.has(o.id));
      done = want.length - todo.length;
      await pool(todo, 6, async (o) => {
        try {
          const fr = await fetchFrame(o, g, f, dm, ac.signal);
          if (id !== runId.current) return;
          store.current.set(o.id, fr);
          done++;
        } catch (e) { if ((e as Error).name !== "AbortError") failed++; }
        const now = performance.now();
        if (now - lastPaint > 250) { lastPaint = now; setVersion((v) => v + 1); setStatus((s) => ({ ...s, done, failed })); }
      }, ac.signal);
      if (id !== runId.current) return;
      setVersion((v) => v + 1);
      setStatus((s) => ({ ...s, phase: "done", done, failed }));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus({ phase: "error", done: 0, total: 0, failed: 0, msg: String((e as Error).message) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fov, bands, demo, maxFrames, usePm]);

  // ---------- URL state
  function pushUrl(b: Base, f: number, bs: number[], dm: boolean, mx: number, pm: boolean) {
    const p = new URLSearchParams(window.location.search);
    p.set("ra", b.ra.toFixed(6)); p.set("dec", b.dec.toFixed(6)); p.set("fov", String(f));
    if (b.name) p.set("name", b.name); else p.delete("name");
    if (b.pmra != null) { p.set("pmra", String(b.pmra)); p.set("pmdec", String(b.pmdec ?? 0)); p.set("epoch", String(b.epoch ?? 2000)); } else { p.delete("pmra"); p.delete("pmdec"); p.delete("epoch"); }
    p.set("bands", bs.join(",")); p.set("max", String(mx)); p.set("pm", pm ? "1" : "0");
    if (dm) p.set("demo", "1"); else p.delete("demo");
    window.history.replaceState(null, "", "?" + p.toString());
  }
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const num = (k: string) => (p.get(k) != null && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : null);
    if (p.get("embed") === "1") setEmbed(true);
    const f = num("fov") ?? 0.15; setFov(f);
    const bs = p.get("bands")?.split(",").map(Number).filter((x) => x >= 1 && x <= 6) ?? [1, 2, 3, 4, 5, 6]; setBands(bs);
    const mx = num("max") ?? 72; setMaxFrames(mx);
    const dm = p.get("demo") === "1"; setDemo(dm);
    const pm = p.get("pm") !== "0"; setUsePm(pm);
    if (num("stack") != null) setStackDays(num("stack")!);
    if (p.get("diff") === "median" || p.get("diff") === "prev") setDiff(p.get("diff") as DiffMode);
    if (p.get("cmap")) setCmap(p.get("cmap") as CmapName);
    if (p.get("perband") === "0") setPerBand(false);
    const ra = num("ra"), dec = num("dec");
    if (ra != null && dec != null) {
      const b: Base = { ra, dec, name: p.get("name") ?? "", pmra: num("pmra") ?? undefined, pmdec: num("pmdec") ?? undefined, epoch: num("epoch") ?? undefined };
      setName(b.name); setRaT(ra.toFixed(6)); setDecT(dec.toFixed(6));
      run(b, { fov: f, bands: bs, demo: dm, max: mx, pm });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // keep display params in the URL as well
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.get("ra")) return;
    p.set("stack", String(stackDays)); p.set("diff", diff); p.set("cmap", cmap); p.set("perband", perBand ? "1" : "0");
    window.history.replaceState(null, "", "?" + p.toString());
  }, [stackDays, diff, cmap, perBand]);

  // ---------- actions
  const choosePreset = (pr: Preset) => {
    setName(pr.name); setRaT(pr.ra.toFixed(6)); setDecT(pr.dec.toFixed(6)); setFov(pr.fov);
    run({ ra: pr.ra, dec: pr.dec, pmra: pr.pmra, pmdec: pr.pmdec, epoch: pr.epoch, name: pr.name }, { fov: pr.fov });
  };
  const submit = async (byName = false) => {
    const nm = name.trim();
    let ra = byName ? null : parseAngle(raT, true), dec = byName ? null : parseAngle(decT, false);
    if ((ra == null || dec == null) && nm) {
      try {
        const r = await fetch("/api/resolve?name=" + encodeURIComponent(nm));
        const j = await r.json();
        if (!r.ok) { say(j.error ?? "Could not resolve name"); return; }
        setRaT(j.ra.toFixed(6)); setDecT(j.dec.toFixed(6)); setName(j.name);
        run({ ra: j.ra, dec: j.dec, pmra: j.pmra || undefined, pmdec: j.pmdec || undefined, epoch: j.pmra ? 2000 : undefined, name: j.name });
        return;
      } catch { say("Name resolver unreachable — enter RA/Dec"); return; }
    }
    if (ra == null || dec == null) { say("Enter RA & Dec (deg or sexagesimal) or an object name"); return; }
    run({ ra, dec, name: nm });
  };
  const resolveName = () => { if (name.trim()) submit(true); };

  // ---------- overlays
  const nGrid = grid?.n ?? 256;
  const overlay = useMemo(() => {
    if (!cur || !grid) return null;
    const yr = mjdToYear(cur.t);
    const project = (s: { ra: number; dec: number; pmra: number; pmdec: number }, ep: number) => {
      const dt = yr - ep, cd = Math.cos((s.dec * Math.PI) / 180);
      return sky2grid(grid, s.ra + (s.pmra * dt) / 3.6e6 / cd, s.dec + (s.pmdec * dt) / 3.6e6);
    };
    const out: { k: string; x: number; y: number; r: number; c: "g" | "w" }[] = [];
    if (catalog && showGaia) catalog.gaia.forEach((s, i) => { const p = project(s, 2016); if (p && p[0] > 0 && p[1] > 0 && p[0] < grid.n && p[1] < grid.n) out.push({ k: "g" + i, x: p[0], y: p[1], r: Math.max(2.2, Math.min(9, 9 - ((s.mag ?? 18) - 9) * 0.5)) * (grid.n / 256), c: "g" }); });
    if (catalog && showWise) catalog.wise.forEach((s, i) => { const p = project(s, 2010.5); if (p && p[0] > 0 && p[1] > 0 && p[0] < grid.n && p[1] < grid.n) out.push({ k: "w" + i, x: p[0], y: p[1], r: 7 * (grid.n / 256), c: "w" }); });
    return out;
  }, [cur, grid, catalog, showGaia, showWise]);

  // ---------- measurement (spectrum / light curve)
  const phot = useMemo(() => {
    if (!sel || !grid) return [] as PhotPoint[];
    const rPix = apArcsec / (grid.scaleDeg * 3600);
    const pts: PhotPoint[] = [];
    for (const f of store.current.values()) {
      if (!bands.includes(f.det)) continue;
      const m = aperturePhot(f, grid.n, sel.x, sel.y, rPix);
      if (m) pts.push({ det: f.det, t: f.t, wl: (f.wl[0] + f.wl[1]) / 2, wlLo: f.wl[0], wlHi: f.wl[1], flux: m.flux, err: m.err, id: f.id });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, grid, apArcsec, bands, version]);

  const onStageClick = (e: React.MouseEvent) => {
    if (!grid) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * grid.n - 0.5, y = ((e.clientY - r.top) / r.height) * grid.n - 0.5;
    if (measure) {
      if (!cur) return;
      const [ra, dec] = grid2sky(grid, x, y);
      setPlaying(false);
      setMarks((m) => (m.length >= 2 ? [{ x, y, ra, dec, t: cur.t }] : [...m, { x, y, ra, dec, t: cur.t }]));
      return;
    }
    setSel({ x, y });
  };
  useEffect(() => { setMarks([]); }, [base]);
  // Shift between two marks, and the distance it would imply if it were pure parallax of Earth's motion.
  const shift = (() => {
    if (marks.length < 2) return null;
    const [a, b] = marks, R = Math.PI / 180;
    const h = Math.sin(((b.dec - a.dec) * R) / 2) ** 2 + Math.cos(a.dec * R) * Math.cos(b.dec * R) * Math.sin(((b.ra - a.ra) * R) / 2) ** 2;
    const arcsec = 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 206264.806;
    const dt = Math.abs(b.t - a.t);
    const baseline = 2 * Math.abs(Math.sin((Math.PI * dt) / 365.25)); // AU, Earth on a circular 1 AU orbit
    return { arcsec, dt, baseline, dist: baseline > 0.01 && arcsec > 0 ? (baseline * 206264.806) / arcsec : null, rate: dt > 0 ? (arcsec / dt) * 365.25 : null };
  })();
  const selSky = sel && grid ? grid2sky(grid, sel.x, sel.y) : null;

  // ---------- export
  const savePng = () => {
    const cv = canvasRef.current; if (!cv || !cur) return;
    cv.toBlob((b) => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `spherex_${(name || "field").replace(/\W+/g, "_")}_${fmtDate(cur.t)}_b${cur.det}.png`; a.click(); });
  };
  const recording = useRef(false);
  const saveVideo = async () => {
    if (!grid || !display.length || recording.current || typeof MediaRecorder === "undefined") { say("Video export not supported in this browser"); return; }
    recording.current = true; say("Recording WebM…"); setPlaying(false);
    const S = 720, cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    const ctx = cv.getContext("2d")!; const tmp = document.createElement("canvas");
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: "video/webm" });
    const chunks: Blob[] = []; rec.ondataavailable = (e) => chunks.push(e.data);
    const fin = new Promise<void>((res) => (rec.onstop = () => res()));
    rec.start();
    for (const f of display) {
      drawFrame(tmp, f, grid.n); ctx.imageSmoothingEnabled = smooth; ctx.drawImage(tmp, 0, 0, S, S);
      ctx.fillStyle = "#000a"; ctx.fillRect(0, 0, S, 28); ctx.fillStyle = "#fff"; ctx.font = "14px monospace";
      ctx.fillText(`SPHEREx band ${f.det || "mix"} · ${f.wl[0].toFixed(2)}-${f.wl[1].toFixed(2)} µm · ${fmtDate(f.t)}`, 8, 19);
      await new Promise((r) => setTimeout(r, 1000 / fps));
    }
    rec.stop(); await fin; recording.current = false;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" })); a.download = "spherex_blink.webm"; a.click();
    say("Saved WebM");
  };
  const copyLink = async () => { try { await navigator.clipboard.writeText(window.location.href); say("Link copied — shareable & embeddable (add &embed=1)"); } catch { say("Copy the address bar URL to share"); } };

  const sonify = () => {
    const pts = [...phot].sort((a, b) => a.wl - b.wl);
    if (!pts.length) { say("Click the image first to pick a spot, then press Hear spectrum"); return; }
    const A = new (window.AudioContext || (window as any).webkitAudioContext)();
    const fl = pts.map((p) => p.flux), lo = Math.min(...fl), hi = Math.max(...fl), step = Math.min(0.25, 6 / pts.length);
    pts.forEach((p, k) => { const o = A.createOscillator(), g = A.createGain(); o.frequency.value = 200 + p.wl * 180; g.gain.value = 0.02 + 0.12 * (hi > lo ? (p.flux - lo) / (hi - lo) : 0.5); o.connect(g).connect(A.destination); o.start(A.currentTime + k * step); o.stop(A.currentTime + k * step + step * 0.9); });
    say("Playing spectrum: pitch = wavelength, loudness = brightness");
  };

  // ---------- helpers for UI
  const toggleBand = (id: number) => setBands((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id].sort()));
  const missingBands = base ? bands.filter((b) => ![...store.current.values()].some((f) => f.det === b)) : [];
  const scaleBar = grid ? (() => { const fovAs = grid.n * grid.scaleDeg * 3600; const L = niceLen(fovAs / 4); return { L, frac: L / fovAs }; })() : null;
  const loading = status.phase === "search" || status.phase === "load";
  const dateRange = display.length ? `${fmtDate(Math.min(...display.map((f) => f.t)))} → ${fmtDate(Math.max(...display.map((f) => f.t)))}` : "";

  return (
    <div className={"app" + (embed ? " embed" : "")}>
      <header className="top">
        <div className="brand"><span className="logo" aria-hidden>◎</span><div><h1>SPHEREx Blink</h1><p>Spot moving objects in the infrared sky</p></div></div>
        <div className="top-r">
          {demo && <span className="badge warn" title="Simulated data — not from SPHEREx">SIMULATED DATA</span>}
          <a className="btn ghost" href="/data">Real data &amp; docs</a>
          <button className="btn ghost" onClick={sonify} title="Hear the spectrum of the selected spot">🔊 Hear spectrum</button>
          <button className="btn ghost" onClick={copyLink}>Copy shareable link</button>
          <span className="wctl" aria-hidden><i>–</i><i>▢</i><i>✕</i></span>
        </div>
      </header>

      <div className="main">
        {!embed && (
          <aside className="side">
            <section className="panel">
              <h2>Target</h2>
              <label className="lbl">Object name <small>(SIMBAD/NED resolver)</small></label>
              <div className="row"><input value={name} placeholder="e.g. Barnard's Star" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && resolveName()} /><button className="btn" onClick={resolveName}>Go</button></div>
              <div className="two">
                <div><label className="lbl">RA</label><input value={raT} placeholder="133.795 or 08h55m10.8s" onChange={(e) => setRaT(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
                <div><label className="lbl">Dec</label><input value={decT} placeholder="-7.245 or -07d14m42s" onChange={(e) => setDecT(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
              </div>
              <div className="chips">
                {PRESETS.map((p) => <button key={p.key} className="chip" title={p.blurb} onClick={() => choosePreset(p)}>{p.name}</button>)}
              </div>
              <label className="lbl">Field of view: <b>{fov < 0.1 ? (fov * 60).toFixed(1) + "′" : fov.toFixed(2) + "°"}</b> <small>({(fov * 60).toFixed(0)}′ across)</small></label>
              <input type="range" min={0.03} max={0.5} step={0.01} value={fov} onChange={(e) => setFov(Number(e.target.value))} />
              <label className="check"><input type="checkbox" checked={usePm} onChange={(e) => setUsePm(e.target.checked)} /> Track proper motion to 2026 <small>(for presets / resolved stars)</small></label>
              <button className="btn primary wide" onClick={() => submit()} disabled={loading}>{loading ? "Loading…" : base ? "Reload frames" : "Load SPHEREx frames"}</button>
            </section>

            <section className="panel">
              <h2>Detector bands</h2>
              <div className="bands">
                {BANDS.map((b) => (
                  <button key={b.id} className={"band" + (bands.includes(b.id) ? " on" : "")} style={{ "--c": b.color } as React.CSSProperties} onClick={() => toggleBand(b.id)} title={`Detector ${b.id}: ${b.lo}–${b.hi} µm, R≈${b.r}`}>
                    <b>{b.id}</b><span>{b.lo}–{b.hi} µm</span>
                  </button>
                ))}
              </div>
              {missingBands.length > 0 && !loading && <button className="btn wide" onClick={() => base && run(base)}>Fetch band{missingBands.length > 1 ? "s" : ""} {missingBands.join(", ")}</button>}
              <label className="lbl">Max frames: <b>{maxFrames}</b> <small>(more = slower)</small></label>
              <input type="range" min={12} max={240} step={6} value={maxFrames} onChange={(e) => setMaxFrames(Number(e.target.value))} />
            </section>

            <section className="panel">
              <h2>Find movers</h2>
              <label className="lbl">Difference imaging</label>
              <select value={diff} onChange={(e) => setDiff(e.target.value as DiffMode)}>
                <option value="none">Off — raw images</option>
                <option value="median">Subtract per-band median (movers pop out)</option>
                <option value="prev">Subtract previous frame (same band)</option>
              </select>
              <label className="lbl">Stack window: <b>{stackDays === 0 ? "off (single exposures)" : stackDays + " days"}</b></label>
              <input type="range" min={0} max={120} step={5} value={stackDays} onChange={(e) => setStackDays(Number(e.target.value))} />
              {stackDays > 0 && <label className="check"><input type="checkbox" checked={perBand} onChange={(e) => setPerBand(e.target.checked)} /> Keep bands separate</label>}
              <label className="check"><input type="checkbox" checked={maskOn} onChange={(e) => setMaskOn(e.target.checked)} /> Hide bright stars <small>(replace with local background)</small></label>
              {maskOn && <><label className="lbl">Star threshold: <b>{maskSigma}σ</b> <small>(lower = hides more)</small></label><input type="range" min={5} max={100} step={5} value={maskSigma} onChange={(e) => setMaskSigma(Number(e.target.value))} /></>}
              <p className="hint">Coadding same-epoch exposures raises signal-to-noise. Select a single band + difference imaging for the cleanest blink.</p>
            </section>

            <section className="panel">
              <h2>Measure shift &amp; distance</h2>
              <button className={"btn wide" + (measure ? " primary" : "")} onClick={() => { setMeasure((m) => !m); setMarks([]); }}>{measure ? "Marking: click the object in two frames" : "Start marking an object"}</button>
              <p className="hint">Click the mover in one frame, step to a frame from a different date, click it again.</p>
              {marks.length === 1 && <div className="hint"><b>A</b> placed at {fmtDate(marks[0].t)}. Now mark B.</div>}
              {shift && (
                <table className="info"><tbody>
                  <tr><th>Shift</th><td>{shift.arcsec.toFixed(1)}″</td></tr>
                  <tr><th>Time apart</th><td>{shift.dt.toFixed(1)} days</td></tr>
                  <tr><th>Rate</th><td>{shift.rate != null ? shift.rate.toFixed(1) + "″/yr" : "–"}</td></tr>
                  <tr><th>Earth baseline</th><td>{shift.baseline.toFixed(3)} AU</td></tr>
                  <tr><th>Distance if parallax</th><td>{shift.dist != null ? (shift.dist >= 63241 ? (shift.dist / 63241).toFixed(2) + " ly" : shift.dist.toFixed(shift.dist < 100 ? 1 : 0) + " AU") : "need ≥ ~2 days apart"}</td></tr>
                </tbody></table>
              )}
              <p className="hint">Rough only: assumes the whole shift is parallax from Earth&apos;s orbit (circular, 1 AU). A real object also moves on its own, and a star&apos;s own proper motion looks the same. Check candidates against known asteroids with IRSA&apos;s Moving Object Search Tool.</p>
            </section>

            <section className="panel">
              <h2>Display</h2>
              <div className="two">
                <div><label className="lbl">Stretch</label><select value={kind} onChange={(e) => setKind(e.target.value as StretchKind)}><option value="asinh">asinh</option><option value="sqrt">sqrt</option><option value="linear">linear</option></select></div>
                <div><label className="lbl">Colour</label><select value={cmap} onChange={(e) => setCmap(e.target.value as CmapName)}><option value="inferno">inferno</option><option value="gray">gray</option><option value="viridis">viridis</option><option value="ice">ice</option></select></div>
              </div>
              <label className="lbl">Black point {loP}% · White point {hiP}%</label>
              <input type="range" min={0} max={50} step={1} value={loP} onChange={(e) => setLoP(Number(e.target.value))} />
              <input type="range" min={90} max={100} step={0.1} value={hiP} onChange={(e) => setHiP(Number(e.target.value))} />
              <label className="check"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Lock stretch per band (keeps brightness steady)</label>
              <label className="check"><input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> Smooth pixels</label>
            </section>

            <section className="panel">
              <h2>Overlays</h2>
              <label className="check"><input type="checkbox" checked={showGaia} onChange={(e) => setShowGaia(e.target.checked)} /> <span className="dot g" /> Gaia DR3 <small>(moved to each frame’s date)</small></label>
              <label className="check"><input type="checkbox" checked={showWise} onChange={(e) => setShowWise(e.target.checked)} /> <span className="dot w" /> AllWISE</label>
              <label className="check"><input type="checkbox" checked={showCross} onChange={(e) => setShowCross(e.target.checked)} /> Centre crosshair</label>
              <label className="check"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Demo mode (simulated data)</label>
            </section>
          </aside>
        )}

        <section className="col">
          <div className="stage-wrap">
            {!grid || (!display.length && !loading) ? (
              <div className="empty">
                {status.phase === "error" ? (
                  <><h3>Couldn’t load data</h3><p>{status.msg}</p><button className="btn primary" onClick={() => { setDemo(true); base && run(base, { demo: true }); }}>Try demo mode (simulated)</button></>
                ) : status.phase === "done" && status.found === 0 ? (
                  <><h3>No SPHEREx coverage found here (yet)</h3><p>The archive returned no spectral images for this position. New data arrives continuously — try another target or check back soon.</p></>
                ) : (
                  <><h3>Pick a target to blink</h3><p>Choose one of the challenge test targets or enter coordinates.</p>
                    <div className="chips big">{PRESETS.map((p) => <button key={p.key} className="chip" onClick={() => choosePreset(p)}><b>{p.name}</b><small>{p.blurb}</small></button>)}</div></>
                )}
              </div>
            ) : (
              <div className="stage" onClick={onStageClick} style={{ cursor: "crosshair" }}>
                <canvas ref={canvasRef} width={nGrid} height={nGrid} style={{ imageRendering: smooth ? "auto" : "pixelated" }} />
                <svg viewBox={`0 0 ${nGrid} ${nGrid}`} className="ov">
                  {overlay?.map((o) => o.c === "g"
                    ? <circle key={o.k} cx={o.x} cy={o.y} r={o.r} className="o-g" />
                    : <rect key={o.k} x={o.x - o.r / 2} y={o.y - o.r / 2} width={o.r} height={o.r} className="o-w" />)}
                  {showCross && <g className="o-c"><path d={`M${nGrid / 2 - 14} ${nGrid / 2}h8M${nGrid / 2 + 6} ${nGrid / 2}h8M${nGrid / 2} ${nGrid / 2 - 14}v8M${nGrid / 2} ${nGrid / 2 + 6}v8`} /></g>}
                  {marks.length === 2 && <line x1={marks[0].x + 0.5} y1={marks[0].y + 0.5} x2={marks[1].x + 0.5} y2={marks[1].y + 0.5} className="o-l" />}
                  {marks.map((m, i) => <g key={i}><circle cx={m.x + 0.5} cy={m.y + 0.5} r={Math.max(3, nGrid / 40)} className={i ? "o-b" : "o-a"} /><text x={m.x + 0.5 + Math.max(4, nGrid / 36)} y={m.y + 0.5 - 3} className="o-t">{i ? "B" : "A"}</text></g>)}
                  {sel && grid && <circle cx={sel.x + 0.5} cy={sel.y + 0.5} r={apArcsec / (grid.scaleDeg * 3600)} className="o-s" />}
                </svg>
                {cur && (
                  <div className="hud tl">
                    <span className="pill" style={{ background: bandColor(cur.det) }}>{cur.det ? "Band " + cur.det : "Stack"}</span>
                    <b>{cur.wl[0].toFixed(2)}–{cur.wl[1].toFixed(2)} µm</b>
                    <span>{fmtDate(cur.t)}</span>
                    {cur.n > 1 && <span>· {cur.n} exposures</span>}
                    {diff !== "none" && <span className="pill dim">Δ {diff}</span>}
                  </div>
                )}
                <div className="hud tr"><svg width="46" height="46" viewBox="0 0 46 46"><g stroke="#cfd8ff" fill="none" strokeWidth="1.5"><path d="M23 40V8M23 8l-4 6M23 8l4 6M40 23H8M8 23l6-4M8 23l6 4" /></g><text x="20" y="6" fill="#cfd8ff" fontSize="9">N</text><text x="1" y="26" fill="#cfd8ff" fontSize="9">E</text></svg></div>
                {scaleBar && <div className="hud bl"><div className="sb" style={{ width: `${scaleBar.frac * 100}%` }} />{fmtLen(scaleBar.L)}</div>}
                {demo && <div className="hud br warn">SIMULATED</div>}
                {loading && <div className="loadbar"><i style={{ width: status.total ? `${(100 * status.done) / status.total}%` : "8%" }} /></div>}
              </div>
            )}
          </div>

          <div className="player">
            <button className="btn" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={!display.length} title="Previous (←)">⏮</button>
            <button className="btn primary" onClick={() => setPlaying((p) => !p)} disabled={display.length < 2} title="Play / pause (space)">{playing ? "⏸ Pause" : "▶ Blink"}</button>
            <button className="btn" onClick={() => setIdx((i) => Math.min(display.length - 1, i + 1))} disabled={!display.length} title="Next (→)">⏭</button>
            <div className="tl-wrap">
              <div className="ticks">
                {display.length > 1 && (() => { const t0 = display[0].t, t1 = display[display.length - 1].t; return display.map((f, i) => (
                  <i key={f.id + i} className={i === idx ? "cur" : ""} style={{ left: `${t1 > t0 ? ((f.t - t0) / (t1 - t0)) * 100 : (i / (display.length - 1)) * 100}%`, background: bandColor(f.det) }} onClick={() => { setPlaying(false); setIdx(i); }} />
                )); })()}
              </div>
              <input type="range" min={0} max={Math.max(0, display.length - 1)} value={Math.min(idx, Math.max(0, display.length - 1))} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
            </div>
            <span className="count">{display.length ? `${Math.min(idx, display.length - 1) + 1}/${display.length}` : "–"}</span>
            <label className="fps">speed <input type="range" min={1} max={15} value={fps} onChange={(e) => setFps(Number(e.target.value))} /> {fps} fps</label>
            <button className="btn ghost" onClick={savePng} disabled={!cur} title="Save current frame">PNG</button>
            <button className="btn ghost" onClick={saveVideo} disabled={!display.length} title="Export blink as WebM video">WebM</button>
          </div>

          <div className="statusline">
            {status.phase === "load" && <span>Loading cutouts {status.done}/{status.total}{status.failed ? ` · ${status.failed} failed` : ""}…</span>}
            {status.phase === "search" && <span>Searching the SPHEREx archive…</span>}
            {status.phase === "done" && status.found != null && <span>{status.found} spectral images cover this position ({status.source}) · showing {display.length} {status.failed ? `· ${status.failed} cutouts failed` : ""}{dateRange ? ` · ${dateRange}` : ""}</span>}
            {selSky && <span className="mono">cursor {fmtRa(selSky[0])} {fmtDec(selSky[1])}</span>}
          </div>

          {!embed && (
            <div className="lower">
              <div className="panel chartp">
                <div className="chart-head">
                  <h2>Measure</h2>
                  <div className="seg">
                    <button className={chartMode === "spectrum" ? "on" : ""} onClick={() => setChartMode("spectrum")}>Spectrum</button>
                    <button className={chartMode === "lightcurve" ? "on" : ""} onClick={() => setChartMode("lightcurve")}>Light curve</button>
                  </div>
                  <label className="fps">aperture r <input type="range" min={4} max={30} value={apArcsec} onChange={(e) => setApArcsec(Number(e.target.value))} /> {apArcsec}″</label>
                </div>
                <Chart points={phot} mode={chartMode} markT={cur?.t ?? null} onPick={(p) => { const i = display.findIndex((f) => f.id === p.id); if (i >= 0) { setPlaying(false); setIdx(i); } }} />
                <p className="hint">Click the image to place the aperture. Spectrum = brightness vs wavelength from every loaded exposure; light curve = brightness vs date (try R Draconis / RW Aurigae).</p>
              </div>
              <div className="panel tablep">
                <h2>Frames <small>{display.length}</small></h2>
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>#</th><th>Band</th><th>Date</th><th>λ µm</th><th>Masked</th><th>FITS</th></tr></thead>
                    <tbody>
                      {display.map((f, i) => (
                        <tr key={f.id + i} className={i === idx ? "cur" : ""} onClick={() => { setPlaying(false); setIdx(i); }}>
                          <td>{i + 1}</td><td><i className="dot" style={{ background: bandColor(f.det) }} />{f.det || "mix"}</td><td>{fmtDate(f.t)}</td>
                          <td>{f.wl[0].toFixed(2)}–{f.wl[1].toFixed(2)}</td><td>{(f.badFrac * 100).toFixed(1)}%</td>
                          <td>{!demo && grid && f.n === 1 ? <a href={`${f.url}?center=${grid.ra0.toFixed(5)},${grid.dec0.toFixed(5)}d&size=${(grid.n * grid.scaleDeg).toFixed(4)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>cutout ↗</a> : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
