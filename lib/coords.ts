/** Parse an RA or Dec string to degrees.
 *  RA:  "17h57m48.5s" | "17 57 48.5" (hours) | "269.452" (degrees)
 *  Dec: "+04d41m36s" | "-7 14 42.5" | "4.69" (degrees) */
export function parseAngle(input: string, isRa: boolean): number | null {
  const raw = input.trim();
  if (!raw) return null;
  const sign = raw.startsWith("-") ? -1 : 1;
  const tokens = raw.replace(/[hdms°′″'":]/gi, " ").replace(/[+-]/g, " ").trim().split(/\s+/).map(Number);
  if (!tokens.length || tokens.some((t) => !Number.isFinite(t))) return null;
  const [a, b = 0, c = 0] = tokens;
  let v = a + b / 60 + c / 3600;
  const sexagesimal = tokens.length > 1 || /h/i.test(raw);
  if (isRa) {
    if (sexagesimal) v *= 15; // hours -> degrees
    return (((sign * v) % 360) + 360) % 360;
  }
  v *= sign;
  return Math.abs(v) <= 90 ? v : null;
}

export const fmtRa = (deg: number) => {
  const h = deg / 15;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m${ss.toFixed(2).padStart(5, "0")}s`;
};
export const fmtDec = (deg: number) => {
  const a = Math.abs(deg);
  const d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  return `${deg < 0 ? "-" : "+"}${String(d).padStart(2, "0")}°${String(m).padStart(2, "0")}′${s.toFixed(1).padStart(4, "0")}″`;
};
