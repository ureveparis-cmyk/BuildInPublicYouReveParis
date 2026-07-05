// WHITE BALANCE — neutralising the light source WITHOUT a reference card.
//
// Skin colour is meaningless until you know what light it was lit by: the same
// cheek reads orange under tungsten and blue under an overcast sky. Studios fix
// this with a grey card in frame. A selfie has no grey card — so we estimate the
// illuminant from the image itself.
//
//   • estimateIlluminant() — the Grey-World assumption: averaged over a whole
//     scene, real-world reflectances are roughly neutral, so the average colour
//     of the frame IS the colour of the light. Generalised here to the Shades-of-
//     Grey / Minkowski-norm family (p=1 is classic grey-world, larger p leans
//     toward the brightest pixels, which is more robust to large flat colours).
//   • correct() — von-Kries-style per-channel scaling that removes the estimated
//     cast, bringing a neutral surface back to neutral.
//   • classifyLighting() — a coarse warm / cool / neutral label from the residual
//     channel ratios, used to flag "your lighting is very warm, results may vary".

/**
 * Estimate the scene illuminant (as an RGB colour) from a set of pixels, using the
 * Shades-of-Grey method. p=1 → grey-world (mean); p→∞ → white-patch (max).
 *
 * @param {Array<[number,number,number]>} pixels
 * @param {number} [p=6] Minkowski norm order
 * @returns {[number,number,number]} illuminant RGB, normalised so its max channel = 1
 */
export function estimateIlluminant(pixels, p = 6) {
  if (pixels.length === 0) throw new Error('estimateIlluminant: no pixels');

  // Accumulate on channel values normalised to [0,1] so the p-th power can never
  // overflow to Infinity for large p (Math.pow(255, 128) is already near MAX_VALUE,
  // which would poison the whole profile with NaN). The final max-normalisation
  // cancels the 1/255 scaling, so the estimate is identical for any finite p while
  // the documented p→∞ white-patch limit stays reachable.
  const acc = [0, 0, 0];
  for (const px of pixels) {
    for (let c = 0; c < 3; c++) acc[c] += Math.pow(px[c] / 255, p);
  }
  const norm = acc.map((s) => Math.pow(s / pixels.length, 1 / p));

  const max = Math.max(...norm) || 1;
  return [norm[0] / max, norm[1] / max, norm[2] / max];
}

/**
 * Remove an estimated illuminant cast from a colour (von Kries diagonal model).
 * Each channel is scaled by the grey target divided by the illuminant, so a
 * surface that reflected the illuminant neutrally becomes neutral grey.
 *
 * @param {[number,number,number]} rgb
 * @param {[number,number,number]} illuminant  (as returned by estimateIlluminant)
 * @returns {[number,number,number]} corrected rgb, clamped to 0–255
 */
export function correct(rgb, illuminant) {
  const grey = (illuminant[0] + illuminant[1] + illuminant[2]) / 3;
  return rgb.map((c, i) => {
    const gain = grey / (illuminant[i] || grey || 1);
    return Math.max(0, Math.min(255, c * gain));
  });
}

/**
 * Coarse colour-temperature label from a skin patch's own channel ratios.
 * Warm light (tungsten) pushes skin yellow/red; cool light (daylight) pushes blue.
 *
 * @param {[number,number,number]} rgb
 * @returns {'warm'|'cool'|'neutral'}
 */
export function classifyLighting([r, g, b]) {
  if (Math.max(r, g, b) < 1) return 'neutral'; // near-black: channel ratios are meaningless
  const greenRed = g / (r || 1);
  const blueGreen = b / (g || 1);
  if (greenRed > 1.08 && blueGreen > 0.92) return 'cool';
  if (greenRed < 0.95 && blueGreen < 0.88) return 'warm';
  return 'neutral';
}
