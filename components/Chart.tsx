"use client";
import { useEffect, useRef, useState } from "react";
import { BANDS, bandColor, fmtDate } from "@/lib/shared";
import type { PhotPoint } from "@/lib/engine";

interface Props {
  points: PhotPoint[];
  mode: "spectrum" | "lightcurve";
  markT: number | null;
  onPick?: (p: PhotPoint) => void;
}

export default function Chart({ points, mode, markT, onPick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ p: PhotPoint; x: number; y: number } | null>(null);
  const layout = useRef<{ p: PhotPoint; x: number; y: number }[]>([]);

  useEffect(() => {
    const cv = ref.current, wr = wrap.current;
    if (!cv || !wr) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = wr.clientWidth, H = wr.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      cv.style.width = W + "px"; cv.style.height = H + "px";
      const c = cv.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const L = 52, R = 14, T = 12, B = 34;
      const pts = points.filter((p) => Number.isFinite(p.flux) && (mode === "spectrum" ? p.wl > 0 : p.t > 0));
      c.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      c.fillStyle = "#8a93b8"; c.strokeStyle = "#232a4a";
      if (!pts.length) { c.fillText("Click the image to measure a position (spectrum / light curve).", L, H / 2); layout.current = []; return; }
      const xv = (p: PhotPoint) => (mode === "spectrum" ? p.wl : p.t);
      let x0 = Math.min(...pts.map(xv)), x1 = Math.max(...pts.map(xv));
      if (mode === "spectrum") { x0 = 0.7; x1 = 5.05; } else { const pad = (x1 - x0) * 0.03 || 1; x0 -= pad; x1 += pad; }
      const ys = pts.map((p) => p.flux).sort((a, b) => a - b);
      let y0 = Math.min(...pts.map((p) => p.flux - p.err)), y1 = Math.max(...pts.map((p) => p.flux + p.err));
      const q = (f: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(f * (ys.length - 1))))];
      if (ys.length > 8) { y0 = Math.max(y0, q(0.01) - (q(0.99) - q(0.01)) * 0.15); y1 = Math.min(y1, q(0.99) + (q(0.99) - q(0.01)) * 0.15); }
      const pad = (y1 - y0) * 0.08 || 1; y0 -= pad; y1 += pad;
      const X = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
      const Y = (v: number) => H - B - ((v - y0) / (y1 - y0)) * (H - B - T);
      // grid
      c.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const v = y0 + ((y1 - y0) * i) / 4, yy = Y(v);
        c.beginPath(); c.moveTo(L, yy); c.lineTo(W - R, yy); c.stroke();
        c.fillStyle = "#8a93b8"; c.textAlign = "right"; c.fillText(Math.abs(v) < 0.1 && v !== 0 ? v.toExponential(0) : v.toFixed(Math.abs(v) < 10 ? 2 : 1), L - 6, yy + 4);
      }
      c.textAlign = "center";
      if (mode === "spectrum") {
        for (const b of BANDS) { // band shading
          c.fillStyle = b.color + "14"; c.fillRect(X(b.lo), T, X(b.hi) - X(b.lo), H - B - T);
        }
        c.fillStyle = "#8a93b8";
        for (const v of [1, 2, 3, 4, 5]) c.fillText(String(v), X(v), H - B + 14);
        c.fillText("wavelength (µm)", (L + W - R) / 2, H - 6);
      } else {
        c.fillStyle = "#8a93b8";
        for (let i = 0; i <= 4; i++) { const t = x0 + ((x1 - x0) * i) / 4; c.fillText(fmtDate(t), X(t), H - B + 14); }
        c.fillText("observation date", (L + W - R) / 2, H - 6);
      }
      c.save(); c.translate(12, (T + H - B) / 2); c.rotate(-Math.PI / 2); c.fillStyle = "#8a93b8"; c.fillText("MJy/sr (aperture − background)", 0, 0); c.restore();
      if (y0 < 0 && y1 > 0) { c.strokeStyle = "#3a4270"; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(L, Y(0)); c.lineTo(W - R, Y(0)); c.stroke(); c.setLineDash([]); }
      if (mode === "lightcurve" && markT != null) { c.strokeStyle = "#ffd166aa"; c.beginPath(); c.moveTo(X(markT), T); c.lineTo(X(markT), H - B); c.stroke(); }
      const lay: typeof layout.current = [];
      for (const p of pts) {
        const px = X(xv(p)), py = Y(p.flux);
        if (px < L || px > W - R) continue;
        c.strokeStyle = bandColor(p.det) + "99"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(px, Y(p.flux - p.err)); c.lineTo(px, Y(p.flux + p.err)); c.stroke();
        if (mode === "spectrum") { c.beginPath(); c.moveTo(X(p.wlLo), py); c.lineTo(X(p.wlHi), py); c.stroke(); }
        c.fillStyle = bandColor(p.det); c.beginPath(); c.arc(px, py, 2.6, 0, 7); c.fill();
        lay.push({ p, x: px, y: py });
      }
      layout.current = lay;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wr);
    return () => ro.disconnect();
  }, [points, mode, markT]);

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: (typeof layout.current)[number] | null = null, bd = 14;
    for (const l of layout.current) { const d = Math.hypot(l.x - mx, l.y - my); if (d < bd) { bd = d; best = l; } }
    setHover(best);
  };
  return (
    <div ref={wrap} className="chart" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => hover && onPick?.(hover.p)}>
      <canvas ref={ref} />
      {hover && (
        <div className="tip" style={{ left: Math.min(hover.x + 10, (wrap.current?.clientWidth ?? 300) - 190), top: Math.max(0, hover.y - 54) }}>
          <b style={{ color: bandColor(hover.p.det) }}>Band {hover.p.det}</b> · {hover.p.wl.toFixed(3)} µm<br />
          {fmtDate(hover.p.t)} · {hover.p.flux.toFixed(3)} ± {hover.p.err.toFixed(3)}
        </div>
      )}
    </div>
  );
}
