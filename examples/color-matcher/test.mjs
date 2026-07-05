// Self-contained test runner — no framework required.
//
//   node examples/color-matcher/test.mjs

import { srgbToLab, deltaE2000, ita, classifyIta } from './color-science.mjs';
import { reduceFrame, aggregateFrames, luma } from './capture.mjs';
import { estimateIlluminant, correct, classifyLighting } from './white-balance.mjs';
import { analyzeSkin } from './analyze.mjs';
import { recommend, shadeTemperature } from './recommend.mjs';

let tests = 0;
let failures = 0;
function check(name, ok) {
  tests++;
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name}`);
  if (!ok) failures++;
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

/** Deterministic frame of `n` pixels around `center` with a fixed jitter pattern. */
function makeFrame(center, n, jitter = 6) {
  const px = [];
  for (let i = 0; i < n; i++) {
    const d = ((i % 5) - 2) * (jitter / 2); // −jitter..+jitter, deterministic
    px.push([center[0] + d, center[1] - d, center[2] + (i % 3) - 1]);
  }
  return px;
}

// ===========================================================================
// Colour science
// ===========================================================================
console.log('color-science');

// CIEDE2000 vs Sharma, Wu & Dalal (2005) reference data.
const sharma = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
];
let sharmaOk = true;
for (const [l1, l2, exp] of sharma) {
  const got = deltaE2000({ L: l1[0], a: l1[1], b: l1[2] }, { L: l2[0], a: l2[1], b: l2[2] });
  if (!near(got, exp, 1e-4)) sharmaOk = false;
}
check('deltaE2000 matches all Sharma 2005 reference pairs (<1e-4)', sharmaOk);

const white = srgbToLab(255, 255, 255);
check('srgbToLab(white) ≈ L100 a0 b0', near(white.L, 100, 1e-3) && near(white.a, 0, 1e-2) && near(white.b, 0, 1e-2));
const red = srgbToLab(255, 0, 0);
check('srgbToLab(red) ≈ L53.24 a80.09 b67.20', near(red.L, 53.24, 0.01) && near(red.a, 80.09, 0.01) && near(red.b, 67.2, 0.01));

const lightCool = srgbToLab(232, 205, 190);
check('ITA° classifies a fair complexion as very_light/light', ['very_light', 'light'].includes(classifyIta(ita(lightCool))));
const deep = srgbToLab(92, 66, 52);
check('ITA° classifies a deep complexion as brown/dark', ['brown', 'dark'].includes(classifyIta(ita(deep))));
// Regression: a non-physical b*<0 reading (an aggressive white-balance correction can
// produce one) must band by the canonical scalar ITA — not wrap past ±90° into 'very_light'.
check('ITA° bands a b*<0 reading canonically, not as very_light',
  classifyIta(ita({ L: 50.01, a: 0, b: -3.56 })) === 'brown');

// ===========================================================================
// Capture — multi-frame robustness
// ===========================================================================
console.log('capture');

check('luma is a weighted brightness', near(luma([255, 255, 255]), 255, 1e-6) && luma([0, 0, 0]) === 0);

// A frame whose core is [200,180,165] but with a few blown-out & shadow stragglers.
const noisy = [...makeFrame([200, 180, 165], 40, 8), [255, 255, 255], [250, 250, 250], [10, 10, 10], [5, 5, 5]];
const reduced = reduceFrame(noisy);
check('reduceFrame trims highlight/shadow stragglers toward the core',
  Math.abs(reduced.rgb[0] - 200) < 12 && Math.abs(reduced.rgb[1] - 180) < 12);

// Five consistent frames + one outlier (subject moved / colour flickered).
const goodFrames = [
  makeFrame([210, 180, 165], 30),
  makeFrame([208, 182, 163], 30),
  makeFrame([212, 178, 167], 30),
  makeFrame([209, 181, 164], 30),
  makeFrame([211, 179, 166], 30),
];
const outlier = makeFrame([120, 60, 60], 30); // dropped hand / harsh shadow
const agg = aggregateFrames([...goodFrames, outlier]);
check('aggregateFrames rejects the outlier frame', agg.framesRejected === 1 && agg.framesUsed === 5);
check('aggregated colour tracks the consistent frames, not the outlier',
  Math.abs(agg.rgb[0] - 210) < 6 && Math.abs(agg.rgb[1] - 180) < 6);
check('reports confidence when a majority of frames agree', agg.confident === true);

// Small sample (n=6): the fractional trim rounds to zero, so the median fallback must
// stop a single bright straggler from dragging the estimate.
const tiny = [[198, 178, 164], [200, 180, 165], [202, 181, 166], [199, 179, 164], [201, 180, 165], [235, 235, 235]];
const tinyReduced = reduceFrame(tiny);
check('reduceFrame stays robust on tiny samples (median fallback)',
  Math.abs(tinyReduced.rgb[0] - 200) < 6 && Math.abs(tinyReduced.rgb[2] - 165) < 6);

// ===========================================================================
// White balance — reference-card-free
// ===========================================================================
console.log('white-balance');

// Neutral greys seen under a warm (reddish) light: multiply by [1.2, 1.0, 0.85].
const cast = [1.2, 1.0, 0.85];
const litGreys = [80, 120, 160, 200].map((v) => [v * cast[0], v * cast[1], v * cast[2]]);
const illum = estimateIlluminant(litGreys);
check('estimateIlluminant recovers the colour cast direction',
  illum[0] > illum[1] && illum[1] > illum[2]); // red-heavy, blue-light — matches the cast
const fixed = litGreys.map((p) => correct(p, illum));
const avg = fixed.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((s) => s / fixed.length);
check('grey-world correction returns neutral surfaces to neutral',
  Math.abs(avg[0] - avg[1]) < 3 && Math.abs(avg[1] - avg[2]) < 3);

check('classifyLighting flags warm light', classifyLighting([200, 150, 120]) === 'warm');
check('classifyLighting flags cool light', classifyLighting([150, 190, 180]) === 'cool');
check('classifyLighting flags neutral light', classifyLighting([180, 178, 176]) === 'neutral');
check('classifyLighting treats a near-black reading as neutral', classifyLighting([0, 0, 0]) === 'neutral');

// Regression: large Minkowski p must not overflow to NaN (the docstring advertises p→∞).
const brightScene = [[250, 240, 230], [255, 250, 245], [248, 238, 228]];
const illumHiP = estimateIlluminant(brightScene, 256);
check('estimateIlluminant stays finite for large p (no NaN overflow)',
  illumHiP.every((c) => Number.isFinite(c)) && illumHiP[0] >= illumHiP[2]);

// ===========================================================================
// Analysis — end-to-end profile
// ===========================================================================
console.log('analyze');

const warmSkinFrames = Array.from({ length: 5 }, () => makeFrame([225, 180, 150], 30));
const profile = analyzeSkin(warmSkinFrames);
check('analyzeSkin returns a full profile', typeof profile.lab.L === 'number' && Number.isFinite(profile.ita));
check('analyzeSkin bands the ITA°', ['very_light', 'light', 'intermediate', 'tan', 'brown', 'dark'].includes(profile.itaBand));
check('analyzeSkin derives an undertone', ['warm', 'cool', 'neutral'].includes(profile.undertone));
check('analyzeSkin surfaces capture stats', profile.capture.framesUsed === 5 && profile.capture.confident);

// With wider scene pixels carrying a blue cast, white balance actually corrects the skin.
const blueCastScene = [60, 100, 140, 180].map((v) => [v * 0.85, v * 1.0, v * 1.2]);
const corrected = analyzeSkin(warmSkinFrames, { scenePixels: blueCastScene });
check('scene-based white balance changes the measured skin RGB',
  corrected.rgb[0] !== corrected.rgbRaw[0] || corrected.rgb[2] !== corrected.rgbRaw[2]);

// ===========================================================================
// Rendu — ranked, explained recommendations
// ===========================================================================
console.log('recommend');

const warmProfile = { lab: srgbToLab(225, 180, 150), undertone: 'warm' };
const palette = [
  { name: 'Coral Sunset', hex: '#ff6f50', finish: 'glossy' }, // warm, distinct
  { name: 'Sapphire', hex: '#2a4fb0', finish: 'glossy' },     // cool, distinct
  { name: 'Ghost Nude', hex: '#dfb395', finish: 'sheer' },    // ~invisible on warm skin (ΔE≈1)
];
const ranked = recommend(warmProfile, palette, { topN: 3 });
const rankOf = (name) => ranked.findIndex((r) => r.name === name);
check('shadeTemperature reads a coral as warm', shadeTemperature(srgbToLab(255, 111, 80)) === 'warm');
check('a matching-undertone shade outranks a near-invisible one', rankOf('Coral Sunset') < rankOf('Ghost Nude'));
check('the near-invisible nude scores low on distinctiveness',
  ranked.find((r) => r.name === 'Ghost Nude').breakdown.distinct < 0.5);
check('every recommendation carries a human-readable reason',
  ranked.every((r) => typeof r.reason === 'string' && r.reason.length > 0));
check('recommendations are deterministic',
  JSON.stringify(recommend(warmProfile, palette)) === JSON.stringify(recommend(warmProfile, palette)));
check('the near-invisible nude is flagged "barely-there" in its reason (warning not truncated)',
  ranked.find((r) => r.name === 'Ghost Nude').reason.includes('barely-there'));

// Score ties break by code unit, not host locale: 'z' (U+007A) sorts before 'ä' (U+00E4)
// everywhere — under Swedish collation localeCompare would flip this.
const tied = [
  { name: 'z-shade', hex: '#ff6f50' },
  { name: 'ä-shade', hex: '#ff6f50' },
];
check('score ties break deterministically by code unit', recommend(warmProfile, tied)[0].name === 'z-shade');

// Preferred finish breaks a tie between otherwise-identical shades.
const twins = [
  { name: 'Twin A', hex: '#ff6f50', finish: 'matte' },
  { name: 'Twin B', hex: '#ff6f50', finish: 'glossy' },
];
const withPref = recommend(warmProfile, twins, { preferredFinish: 'glossy' });
check('preferred finish lifts the matching shade to the top', withPref[0].name === 'Twin B');

console.log(`\n${tests} checks, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
