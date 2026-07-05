// ANALYSIS — capture + white-balance + colour-science into one skin profile.
//
// This is the pipeline the "analyse" step runs after the burst is captured:
//   frames ──▶ aggregate (robust skin RGB) ──▶ white-balance ──▶ CIELAB
//          ──▶ ITA° band + undertone + lighting label
//
// A deliberate subtlety lives here. Full Grey-World white balance assumes the
// scene averages to neutral — true for a whole photo, but NOT for a crop of skin,
// which is the very (non-neutral) thing we're measuring. So:
//   • if the caller passes wider `scenePixels`, we estimate the illuminant from
//     THOSE and von-Kries-correct the skin — a proper reference-free correction;
//   • otherwise we fall back to a light, bounded Lab nudge driven only by a
//     warm/cool classification of the skin patch — enough to counter obvious
//     colour casts without erasing the undertone we're trying to read.

import { aggregateFrames } from './capture.mjs';
import { estimateIlluminant, correct, classifyLighting } from './white-balance.mjs';
import { srgbToLab, chroma, hueDeg, ita, classifyIta } from './color-science.mjs';

/**
 * @param {Array<Array<[number,number,number]>>} frames burst of face-region samples
 * @param {{
 *   scenePixels?: Array<[number,number,number]>,
 *   captureOpts?: object,
 * }} [opts]
 */
export function analyzeSkin(frames, opts = {}) {
  const { scenePixels, captureOpts } = opts;

  // 1. CAPTURE — robust skin RGB from the burst.
  const capture = aggregateFrames(frames, captureOpts ?? {});
  const rawRgb = capture.rgb;

  // 2. WHITE BALANCE — neutralise the light source without a reference card.
  const lighting = classifyLighting(rawRgb);
  let correctedRgb = rawRgb;
  let labNudge = { a: 0, b: 0 };

  if (scenePixels && scenePixels.length > 0) {
    // Proper reference-free correction from the wider scene.
    const illuminant = estimateIlluminant(scenePixels);
    correctedRgb = correct(rawRgb, illuminant);
  } else {
    // Conservative fallback: bounded Lab nudge from the lighting class only.
    if (lighting === 'warm') labNudge = { a: -3, b: -4 };
    else if (lighting === 'cool') labNudge = { a: 1, b: 3 };
  }

  // 3. CIELAB + derived descriptors.
  const lab0 = srgbToLab(correctedRgb[0], correctedRgb[1], correctedRgb[2]);
  const lab = { L: lab0.L, a: lab0.a + labNudge.a, b: lab0.b + labNudge.b };

  const itaDeg = ita(lab);
  const undertone = deriveUndertone(lab);

  return {
    rgb: correctedRgb.map((c) => Math.round(c)),
    rgbRaw: rawRgb.map((c) => Math.round(c)),
    lab,
    chroma: chroma(lab),
    hueDeg: hueDeg(lab),
    ita: itaDeg,
    itaBand: classifyIta(itaDeg),
    undertone,
    lighting,
    capture: {
      framesUsed: capture.framesUsed,
      framesRejected: capture.framesRejected,
      framesTotal: capture.framesTotal,
      confident: capture.confident,
    },
  };
}

/**
 * Undertone from CIELAB a* and b* (thresholds tuned for skin):
 * genuinely warm skin carries both red (a*) and yellow (b*); cool skin is low on
 * both; everything between reads neutral.
 *
 * @param {{a:number,b:number}} lab
 * @returns {'warm'|'cool'|'neutral'}
 */
export function deriveUndertone({ a, b }) {
  if (a > 8 && b > 10) return 'warm';
  if (a < 2 && b < 8) return 'cool';
  return 'neutral';
}
