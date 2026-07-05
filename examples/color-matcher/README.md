# On-device colorimetry — capture · analysis · rendu

Recommend flattering nail-polish shades from a selfie, entirely **on the client** — no photo
ever leaves the browser. This example reproduces the algorithmic core of that feature: how a
burst of noisy camera frames becomes a trustworthy skin profile, and how that profile becomes a
ranked, *explained* set of shades.

> **Why JavaScript here?** The real feature runs in the browser (camera + face detection via
> `face-api.js`, on-device for privacy). These modules are the pure, headless core of that
> pipeline — runnable under Node with **zero dependencies**, so the science can be unit-tested in
> isolation, including against published reference data.

## The pipeline

```
 burst of frames ─▶ CAPTURE ─▶ WHITE BALANCE ─▶ CIELAB ─▶ ITA° band + undertone ─▶ RENDU (ranked shades)
```

### 1. Capture — many noisy frames → one trustworthy colour  ([`capture.mjs`](capture.mjs))

A single frame is a poor estimator: sensor noise, auto-exposure hunting, a specular highlight, a
moving hand. Reduction happens in two robust stages: **within** a frame, gate out non-skin pixels
(blown highlights, deep shadows) and take a **trimmed mean over the interquartile core**;
**across** frames, reject whole outlier frames (subject moved / light flickered) before averaging.
The output includes a confidence flag so the UI can ask for a re-scan when conditions were poor.

### 2. White balance — neutralise the light *without a grey card*  ([`white-balance.mjs`](white-balance.mjs))

Skin colour is meaningless until you know the light it was under. A selfie has no reference card,
so the illuminant is estimated from the image itself via the **Shades-of-Grey** method (a
generalised Grey-World), then removed with a **von-Kries** per-channel correction. A coarse
warm/cool/neutral classifier flags difficult lighting. *(Note the deliberate subtlety in
[`analyze.mjs`](analyze.mjs): full Grey-World is applied only when wider scene pixels are available
— never to a skin-only crop, which would erase the very undertone we're measuring.)*

### 3. Analysis — CIELAB, ITA° and undertone  ([`color-science.mjs`](color-science.mjs), [`analyze.mjs`](analyze.mjs))

The corrected colour is converted to **CIELAB** and summarised by the **Individual Typology Angle
(ITA°)** — the dermatology metric that classifies skin tone on one axis (very light → dark) — plus
a warm/cool/neutral **undertone** derived from a\* and b\*.

### 4. Rendu — ranked, explained recommendations  ([`recommend.mjs`](recommend.mjs))

Each catalogue shade is scored on interpretable axes — **undertone harmony**, **distinctiveness**
(a polish must be perceptually distinct from the nail bed, measured with **CIEDE2000**, or it
disappears on the hand), **hue harmony** (analogous *or* complementary, not the awkward in-between),
and a **finish** nudge. Every recommendation exposes its per-axis breakdown and a human-readable
reason, so the result is explainable rather than a black box.

## Why CIEDE2000 (and how it's verified)

Plain Euclidean distance in RGB — or even in Lab — doesn't match human perception. **CIEDE2000**
(Sharma, Wu & Dalal, 2005) weights lightness, chroma and hue the way the eye does. It's notoriously
easy to implement subtly wrong, so [`test.mjs`](test.mjs) validates it against the **paper's
published reference pairs** to < 1e-4.

## Files

- [`color-science.mjs`](color-science.mjs) — sRGB→CIELAB, ITA°, CIEDE2000, hue/chroma (pure).
- [`capture.mjs`](capture.mjs) — multi-frame robust aggregation.
- [`white-balance.mjs`](white-balance.mjs) — reference-card-free white balance.
- [`analyze.mjs`](analyze.mjs) — the end-to-end skin profile.
- [`recommend.mjs`](recommend.mjs) — the ranked, explained shade recommender.
- [`test.mjs`](test.mjs) — 32 self-contained checks (incl. Sharma reference data).

## Run

```bash
node examples/color-matcher/test.mjs
```
