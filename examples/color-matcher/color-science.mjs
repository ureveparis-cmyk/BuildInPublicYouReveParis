// Pure color-science primitives — no dependencies, no DOM.
//
// Everything the colorimetry tool needs to reason about colour perceptually:
// sRGB → CIELAB conversion, the Individual Typology Angle (ITA°) used in
// dermatology to classify skin tone, and CIEDE2000 — the perceptual colour
// distance that drives shade matching.

/** Parse "#rrggbb" (or "rrggbb") to [r, g, b] in 0–255. */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Format [r, g, b] (0–255, rounded & clamped) as "#rrggbb". */
export function rgbToHex([r, g, b]) {
  const clamp = (c) => Math.max(0, Math.min(255, Math.round(c)));
  return '#' + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('');
}

/**
 * sRGB (0–255) → CIELAB, D65 white point.
 * The standard pipeline: gamma-expand to linear light, apply the sRGB→XYZ
 * matrix, normalise by the D65 illuminant, then the CIELAB f() transform.
 */
export function srgbToLab(r, g, b) {
  const toLinear = (c) => {
    c /= 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  };
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  // Linear sRGB → CIE XYZ (D65).
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

  // Normalise by the D65 reference white.
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / 0.95047);
  const fy = f(y / 1.0);
  const fz = f(z / 1.08883);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Chroma C* = √(a² + b²). */
export function chroma({ a, b }) {
  return Math.sqrt(a * a + b * b);
}

/** Hue angle h° = atan2(b, a), normalised to 0–360. */
export function hueDeg({ a, b }) {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/**
 * Individual Typology Angle (ITA°) — a dermatology metric that classifies skin
 * tone on a single axis from lightness (L*) and yellowness (b*):
 *
 *     ITA° = arctan((L* − 50) / b*) × 180/π      (range ±90°)
 *
 * Higher = lighter/less yellow. Skin b* is > 0 in practice; we use the scalar
 * arctan (NOT atan2) so the angle stays within ±90°. That way a non-physical
 * b* ≤ 0 reading — which an aggressive white-balance correction can produce — is
 * still banded sanely, instead of wrapping past ±90° and being mis-labelled as
 * the lightest/darkest extreme.
 */
export function ita({ L, b }) {
  const bb = b === 0 ? 1e-8 : b; // ITA is undefined at b*=0; nudge off the singularity
  return (Math.atan((L - 50) / bb) * 180) / Math.PI;
}

/** Six standard ITA° bands, light → dark (dermatology convention). */
export function classifyIta(itaDeg) {
  if (itaDeg > 55) return 'very_light';
  if (itaDeg > 41) return 'light';
  if (itaDeg > 28) return 'intermediate';
  if (itaDeg > 10) return 'tan';
  if (itaDeg > -30) return 'brown';
  return 'dark';
}

/**
 * CIEDE2000 perceptual colour difference (Sharma, Wu & Dalal 2005).
 * The improvement over plain Euclidean ΔE that a shade-matcher needs: it
 * weights lightness, chroma and hue the way the human eye actually does,
 * including the blue-region rotation term. Validated against the paper's
 * reference test data in test.mjs.
 *
 * @param {{L:number,a:number,b:number}} lab1
 * @param {{L:number,a:number,b:number}} lab2
 * @returns {number}
 */
export function deltaE2000(lab1, lab2) {
  const kL = 1, kC = 1, kH = 1;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const h1p = huePrime(b1, a1p);
  const h2p = huePrime(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;

  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
  else hbp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.20 * Math.cos((4 * hbp - 63) * rad);

  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;

  return Math.sqrt(
    Math.pow(dLp / (kL * Sl), 2) +
      Math.pow(dCp / (kC * Sc), 2) +
      Math.pow(dHp / (kH * Sh), 2) +
      Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  );

  function huePrime(bComp, aComp) {
    if (bComp === 0 && aComp === 0) return 0;
    const h = Math.atan2(bComp, aComp) * deg;
    return h < 0 ? h + 360 : h;
  }
}
