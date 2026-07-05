// CAPTURE — turning many noisy camera frames into one trustworthy skin colour.
//
// A single webcam frame is a bad estimator of skin tone: JPEG noise, auto-exposure
// hunting, a hand moving through frame, a specular highlight on the cheek. The tool
// captures a BURST of frames and reduces them robustly, in two stages:
//
//   1. Within a frame  — gate out non-skin pixels (blown highlights, deep shadows)
//                        and take a trimmed mean over the interquartile core, so a
//                        few bright/dark stragglers can't drag the estimate.
//   2. Across frames   — drop outlier frames entirely (a frame where the subject
//                        moved or the light flickered), then average what survives.
//
// The result is a stable RGB triplet plus a quality report (how many frames/pixels
// were kept) that the UI can use to ask for a re-scan when conditions were poor.

/** Rec. 601 luma — cheap perceptual brightness for gating/sorting. */
export function luma([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Reduce ONE frame's sampled pixels to a robust mean RGB.
 * Gates by brightness, then averages the interquartile core (default 15–85%). For
 * samples too small to trim by fraction, falls back to the per-channel median.
 *
 * @param {Array<[number,number,number]>} pixels sampled from the face region
 * @param {{gateLo?:number, gateHi?:number, trim?:number}} [opts]
 * @returns {{rgb:[number,number,number], kept:number} | null} null if too few usable pixels
 */
export function reduceFrame(pixels, opts = {}) {
  const { gateLo = 70, gateHi = 235, trim = 0.15 } = opts;

  let usable = pixels.filter((p) => {
    const y = luma(p);
    return y >= gateLo && y <= gateHi;
  });

  // If the gate was too aggressive (very dark or very light skin / lighting),
  // fall back to all pixels rather than returning nothing.
  if (usable.length < 20) usable = pixels.slice();
  if (usable.length === 0) return null;

  const sorted = usable.slice().sort((p, q) => luma(p) - luma(q));

  // Symmetric trim of the top/bottom `trim` fraction. When the sample is small
  // enough that the fraction rounds to zero (n ≤ 6 at trim=0.15), a plain mean
  // would leave stragglers untrimmed — so fall back to the per-channel median,
  // which is inherently robust to a single bright/shadow outlier.
  const k = Math.floor(sorted.length * trim);
  let pool;
  if (k >= 1) {
    pool = sorted.slice(k, sorted.length - k);
  } else if (sorted.length >= 3) {
    return { rgb: medianRgb(sorted), kept: sorted.length };
  } else {
    pool = sorted;
  }

  const sum = pool.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0]);
  return {
    rgb: [sum[0] / pool.length, sum[1] / pool.length, sum[2] / pool.length],
    kept: pool.length,
  };
}

/** Euclidean distance between two RGB triplets. */
function rgbDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Per-channel median of a list of RGB triplets. */
function medianRgb(list) {
  const at = (i) => {
    const xs = list.map((p) => p[i]).sort((a, b) => a - b);
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };
  return [at(0), at(1), at(2)];
}

/**
 * Aggregate a burst of frames into one robust skin colour.
 * Each frame is first reduced (reduceFrame); then frames whose reduced colour is
 * an outlier (> `maxFrameDistance` from the per-frame median) are rejected, and
 * the survivors are averaged.
 *
 * @param {Array<Array<[number,number,number]>>} frames burst of sampled-pixel arrays
 * @param {{maxFrameDistance?:number} & Parameters<typeof reduceFrame>[1]} [opts]
 * @returns {{
 *   rgb:[number,number,number],
 *   framesUsed:number, framesRejected:number, framesTotal:number,
 *   confident:boolean
 * }}
 */
export function aggregateFrames(frames, opts = {}) {
  const { maxFrameDistance = 18 } = opts;

  const reduced = frames.map((f) => reduceFrame(f, opts)).filter((r) => r !== null);
  if (reduced.length === 0) {
    throw new Error('No usable frames: every frame was empty after gating.');
  }

  const perFrameRgb = reduced.map((r) => r.rgb);
  const median = medianRgb(perFrameRgb);

  const survivors = reduced.filter((r) => rgbDistance(r.rgb, median) <= maxFrameDistance);
  const pool = survivors.length > 0 ? survivors : reduced; // never reject everything

  const sum = pool.reduce((acc, r) => [acc[0] + r.rgb[0], acc[1] + r.rgb[1], acc[2] + r.rgb[2]], [0, 0, 0]);
  const rgb = [sum[0] / pool.length, sum[1] / pool.length, sum[2] / pool.length];

  return {
    rgb,
    framesUsed: pool.length,
    framesRejected: reduced.length - pool.length,
    framesTotal: frames.length,
    // We trust the reading when a solid majority of frames agreed.
    confident: pool.length >= 3 && pool.length >= Math.ceil(frames.length / 2),
  };
}
