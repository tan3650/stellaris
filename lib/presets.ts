export interface Preset {
  key: string;
  name: string;
  blurb: string;
  ra: number; // deg
  dec: number; // deg
  pmra?: number; // mas/yr (incl. cos dec)
  pmdec?: number; // mas/yr
  epoch?: number; // epoch of ra/dec (decimal year)
  fov: number; // deg
}

/** Challenge test targets. Coordinates are catalogue positions at `epoch`; the app can propagate
 *  them with proper motion to the SPHEREx epoch (~2026) so high-proper-motion targets stay centred. */
export const PRESETS: Preset[] = [
  { key: "wise0855", name: "WISE 0855−0714", blurb: "Fast-moving brown dwarf (~8″/yr)", ra: 133.795129, dec: -7.245147, pmra: -8153, pmdec: 668, epoch: 2010.5, fov: 0.2 },
  { key: "barnard", name: "Barnard's Star", blurb: "Highest proper motion star (10.3″/yr)", ra: 269.452082, dec: 4.693365, pmra: -798.6, pmdec: 10328, epoch: 2000, fov: 0.15 },
  { key: "epsindib", name: "ε Indi B (Ba/Bb)", blurb: "Brown-dwarf pair orbiting ε Indi", ra: 331.0438, dec: -56.7828, pmra: 3966, pmdec: -2536, epoch: 2000, fov: 0.15 },
  { key: "rwaur", name: "RW Aurigae", blurb: "Variable T Tauri star", ra: 76.9482, dec: 30.4014, fov: 0.1 },
  { key: "rdra", name: "R Draconis", blurb: "Mira-type variable star", ra: 248.1787, dec: 66.7549, fov: 0.1 },
  { key: "m101", name: "M101 (Pinwheel)", blurb: "IRSA cutout tutorial target: 84 D2 images", ra: 210.80227, dec: 54.34895, fov: 0.1 },
  { key: "cosmos", name: "COSMOS field", blurb: "IRSA Source Discovery tutorial field", ra: 150.7817877, dec: 3.3502204, fov: 0.1 },
  { key: "pah", name: "PAH-bright cloud", blurb: "IRSA HiPS tutorial: strong 3.3 µm PAH", ra: 60.8109955, dec: 51.3404038, fov: 0.1 },
];

/** Propagate (ra,dec) from `epoch` to `toEpoch` with proper motion. */
export function propagate(p: { ra: number; dec: number; pmra?: number; pmdec?: number; epoch?: number }, toEpoch: number): [number, number] {
  const dt = toEpoch - (p.epoch ?? toEpoch);
  const cd = Math.cos((p.dec * Math.PI) / 180);
  return [p.ra + ((p.pmra ?? 0) * dt) / 3.6e6 / cd, p.dec + ((p.pmdec ?? 0) * dt) / 3.6e6];
}
export const SPHEREX_EPOCH = 2026.0;
