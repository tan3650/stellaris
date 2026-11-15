// REAL values copied from the IRSA SPHEREx tutorials (https://caltech-ipac.github.io/irsa-tutorials/spherex/).
// Nothing here is simulated.

/** First 10 of 102 rows of the SPECTRAL_CHANNELS table (HiPS cube tutorial). */
export const CHANNELS: [number, number, number, number, number, number, number, number][] = [
  // det, subchan, λ, λmin, λmax, R, R_std, bandwidth (µm)
  [1, 1, 0.753, 0.743, 0.762, 42, 1.1, 0.018], [1, 2, 0.771, 0.761, 0.781, 42, 1.0, 0.019],
  [1, 3, 0.790, 0.780, 0.800, 41, 0.9, 0.019], [1, 4, 0.809, 0.798, 0.819, 40, 0.9, 0.020],
  [1, 5, 0.828, 0.817, 0.839, 40, 0.8, 0.020], [1, 6, 0.848, 0.837, 0.859, 40, 0.8, 0.021],
  [1, 7, 0.868, 0.857, 0.879, 40, 0.7, 0.022], [1, 8, 0.889, 0.877, 0.900, 39, 0.7, 0.023],
  [1, 9, 0.910, 0.898, 0.922, 39, 0.6, 0.023], [1, 10, 0.932, 0.920, 0.944, 39, 0.6, 0.024],
];

/** First 10 planes of the quick-look aperture photometry at RA 60.8109955, Dec 51.3404038
 *  (SPHEREx DR1 HiPS cube, Npix445, 5-pixel aperture, annulus background-subtracted). */
export const PHOT: [number, number, number, number][] = [
  // plane, λ µm, flux mJy, flux (background-subtracted) mJy
  [0, 0.753, 128.798, 93.180], [1, 0.771, 154.859, 117.921], [2, 0.790, 153.256, 115.310],
  [3, 0.809, 163.001, 123.911], [4, 0.828, 160.764, 121.108], [5, 0.848, 166.316, 126.168],
  [6, 0.868, 162.978, 122.184], [7, 0.889, 188.318, 143.035], [8, 0.910, 565.960, 511.427],
  [9, 0.932, 221.699, 170.785],
];

/** Spectral features marked in the IRSA tutorial plots. */
export const LINES: [number, string][] = [
  [1.282, "Paβ"], [1.60, "H⁻ 1.6 µm"], [1.875, "Paα"], [2.166, "Brγ"], [2.626, "Brβ"], [3.30, "PAH 3.3 µm"], [4.052, "Brα"], [4.67, "CO"],
];

/** Positions used in the IRSA tutorials, with the counts the tutorials printed. */
export const TARGETS = [
  { name: "M101 (Pinwheel galaxy)", ra: 210.80227, dec: 54.34895, fov: 0.1, note: "84 Detector-2 images found (cutout size 0.1°)" },
  { name: "COSMOS-like field", ra: 150.7817877, dec: 3.3502204, fov: 0.1, note: "Source Discovery tutorial; 50″ search radius" },
  { name: "Cygnus-region position", ra: 305.59875, dec: 41.14888889, fov: 0.05, note: "454 spectral images cover this point (all bands)" },
  { name: "PAH-bright cloud", ra: 60.8109955, dec: 51.3404038, fov: 0.1, note: "HiPS tutorial; HEALPix order 5, pixel 445" },
];

export const TAP_QUERY = `SELECT
  'https://irsa.ipac.caltech.edu/' || a.uri || '?center=RA,DECd&size=DEG' AS uri,
  p.time_bounds_lower, p.energy_bandpassname,
  p.time_bounds_upper, p.provenance_version
FROM spherex.artifact a
JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', RA, DEC), p.poly)
ORDER BY p.time_bounds_lower`;

export const EXAMPLE_CUTOUT =
  "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W18_1B/l2b-v27-2026-196/4/level2_2025W18_1B_0023_2D4_spx_l2b-v27-2026-196.fits?center=305.59875,41.14888889d&size=0.01";

export const HIPS = {
  viewer: "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube",
  data: "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/hips5_cube/hips_20261026",
};

export const RELEASES: [string, string][] = [
  ["July 2025", "First Quick Release products available at IRSA"],
  ["October 2025", "First reprocessed Quick Release products (QR2)"],
  ["April 10, 2026", "QR2 headers updated to correct PSF extension header error"],
  ["September 2026", "First Quick Release 3 (QR3) products"],
  ["November 2026", "Data Release 1 (DR1) products"],
];

export const TOOLS: [string, string][] = [
  ["SPHEREx Data Release 1", "Access DR1 data"], ["SPHEREx Quick Releases", "Access QR2 and QR3 data"],
  ["SPLICES", "SPHEREx Target List of Ice Sources catalog"], ["Comet 3I/ATLAS", "SPHEREx spectral images of the comet"],
  ["Cloud Data Access", "SPHEREx data on AWS S3"], ["Moving Object Search Tool (MOST)", "Find images covering a solar-system object's predicted positions"],
  ["Spectrophotometry Tool", "Extract spectra by forced photometry"], ["Mosaic Tool", "Custom multiwavelength mosaics"],
  ["Cutout Tool", "Spatial subsets of Spectral Image FITS files"], ["Source Discovery Tool", "Find significant sources without positional priors"],
];
