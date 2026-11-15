// Tiny float16 pack/unpack so cutouts travel at 2 bytes/pixel.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const expo = (x >>> 23) & 0xff;
  let m = x & 0x7fffff;
  if (expo === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0); // inf / NaN
  let e = expo - 127 + 15;
  if (e >= 31) return sign | 0x7bff; // clamp to max finite
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  let h = sign | (e << 10) | (m >> 13);
  if (m & 0x1000) h++;
  if ((h & 0x7fff) >= 0x7c00) h = sign | 0x7bff;
  return h;
}

export function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

export function packHalf(a: Float32Array): Uint16Array {
  const o = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = toHalf(a[i]);
  return o;
}
export function unpackHalf(u: Uint16Array): Float32Array {
  const o = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) o[i] = fromHalf(u[i]);
  return o;
}
