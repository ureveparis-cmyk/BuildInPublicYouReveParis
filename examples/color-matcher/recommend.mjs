// RENDU — turning a skin profile into a ranked, explained set of nail shades.
//
// Given the analysed skin (CIELAB + undertone) and a catalogue of polish shades,
// score every shade on a few interpretable axes and return the best ones with a
// human-readable reason. Nothing here is a black box: each recommendation exposes
// its per-axis breakdown, so the UI can explain *why* a colour was suggested.
//
// Axes (weighted into a 0–100 flatter-score):
//   • undertone harmony  — shades that share the skin's undertone flatter most.
//   • distinctiveness    — a polish must be perceptually distinct (ΔE2000) from
//                          the nail bed, or it simply disappears on the hand.
//   • hue harmony        — analogous OR complementary hues please; the awkward
//                          ~90° in-between does not.
//   • finish fit         — a small nudge toward the client's preferred finish.

import { srgbToLab, hexToRgb, chroma, hueDeg, deltaE2000 } from './color-science.mjs';

const WEIGHTS = { undertone: 0.4, distinct: 0.3, hue: 0.3 };
const FINISH_BONUS = 6; // added on top of the weighted 0–100 base, then re-capped

/** Warm / cool / neutral temperature of a polish shade from its hue & chroma. */
export function shadeTemperature(lab) {
  if (chroma(lab) < 8) return 'neutral'; // nudes, greys, near-axis
  const h = hueDeg(lab);
  const warmth = Math.cos(((h - 40) * Math.PI) / 180); // +1 near orange, −1 near blue
  if (warmth > 0.3) return 'warm';
  if (warmth < -0.3) return 'cool';
  return 'neutral';
}

function undertoneScore(skinUndertone, shadeTemp) {
  if (skinUndertone === shadeTemp) return 1;
  if (skinUndertone === 'neutral' || shadeTemp === 'neutral') return 0.7;
  return 0.4; // warm skin ↔ cool shade (still wearable, just not the top pick)
}

/** ΔE2000 distinctiveness, saturating: invisible-on-skin shades score near 0. */
function distinctScore(dE) {
  return Math.max(0, Math.min(1, dE / 25));
}

/** 1 at analogous (0°) and complementary (180°), 0 at the awkward 90°. */
function hueHarmonyScore(hSkin, hShade) {
  let dh = Math.abs(hShade - hSkin) % 360;
  if (dh > 180) dh = 360 - dh;
  return 0.5 * (1 + Math.cos((2 * dh * Math.PI) / 180));
}

/**
 * Rank a palette for a given skin profile.
 *
 * @param {{lab:{L:number,a:number,b:number}, undertone:'warm'|'cool'|'neutral'}} profile
 * @param {Array<{name:string, hex:string, finish?:string}>} palette
 * @param {{topN?:number, preferredFinish?:string}} [opts]
 * @returns {Array<{name:string,hex:string,finish?:string,score:number,deltaE:number,breakdown:object,reason:string}>}
 */
export function recommend(profile, palette, opts = {}) {
  const { topN = 5, preferredFinish } = opts;
  const skinHue = hueDeg(profile.lab);

  const scored = palette.map((shade) => {
    const [r, g, b] = hexToRgb(shade.hex);
    const lab = srgbToLab(r, g, b);
    const temp = shadeTemperature(lab);
    const dE = deltaE2000(profile.lab, lab);

    const breakdown = {
      undertone: undertoneScore(profile.undertone, temp),
      distinct: distinctScore(dE),
      hue: hueHarmonyScore(skinHue, hueDeg(lab)),
    };

    let score =
      100 *
      (WEIGHTS.undertone * breakdown.undertone +
        WEIGHTS.distinct * breakdown.distinct +
        WEIGHTS.hue * breakdown.hue);

    if (preferredFinish && shade.finish === preferredFinish) {
      score = Math.min(100, score + FINISH_BONUS);
    }

    return {
      name: shade.name,
      hex: shade.hex,
      finish: shade.finish,
      score: Math.round(score * 10) / 10,
      deltaE: Math.round(dE * 10) / 10,
      temperature: temp,
      breakdown,
      reason: reasonFor(breakdown, profile.undertone, temp, dE, skinHue, hueDeg(lab)),
    };
  });

  // Sort by score; break ties by a locale-INDEPENDENT code-unit comparison so the
  // ordering is identical on every runtime/locale (localeCompare is not — it depends
  // on the host's ICU collation, which would make "deterministic" false).
  scored.sort((x, y) => y.score - x.score || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return scored.slice(0, topN);
}

function reasonFor(breakdown, skinUndertone, shadeTemp, dE, hSkin, hShade) {
  const positives = [];
  if (breakdown.undertone >= 1) {
    positives.push(`flatters your ${skinUndertone} undertone`);
  } else if (breakdown.undertone >= 0.7) {
    // Only call it a "neutral pairing" when the SHADE itself is neutral; if the
    // skin undertone is neutral but the shade is visibly warm/cool, don't mislabel it.
    positives.push(
      shadeTemp === 'neutral'
        ? 'a versatile, neutral pairing'
        : 'a versatile match for your neutral undertone',
    );
  }

  let dh = Math.abs(hShade - hSkin) % 360;
  if (dh > 180) dh = 360 - dh;
  if (breakdown.hue >= 0.8) {
    positives.push(dh < 45 ? 'harmonises with your natural tones' : 'a striking complementary contrast');
  }

  // Distinctiveness is the only axis that can WARN ("barely-there"). Never let that
  // warning be truncated away behind two positives — it's the whole point of the axis.
  let distinctNote = null;
  if (breakdown.distinct >= 0.8) distinctNote = 'pops on the nail';
  else if (breakdown.distinct < 0.35) distinctNote = 'a subtle, barely-there tint';

  const bits = positives.slice(0, distinctNote ? 1 : 2);
  if (distinctNote) bits.push(distinctNote);
  return bits.join('; ') || 'a balanced, wearable choice';
}
