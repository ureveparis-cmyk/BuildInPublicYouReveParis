# Messy multi-source booking ingestion

Normalize the hostile service data that marketplaces hand over — and reconcile bookings that ship
no stable id.

## The problem

Every booking channel exports data differently, and none of it is clean:

- **Treatwell concatenates** multi-service names with *no separator*, relying only on the camel-case
  boundary: `Dépose gelBeauté des piedsRemplissage gel`.
- **ClassPass sprinkles narrow no-break spaces** (U+202F) and non-breaking spaces (U+00A0) between a
  number and its unit, so `45 min` is really `45␟min` — which byte-based or `\s`-naive parsers miss.
- **Prices are glued to durations**, use comma decimals (`39,50 €`), and repeat across lines.
- **Some sources ship no stable booking id**, so a *rescheduled* booking looks like a brand-new one.

## The approach

A pure, Unicode-aware (`/u`) normalizer that:

- **Splits** concatenated names on lost word boundaries (a lowercase letter immediately followed by
  an uppercase one — accented capitals included).
- **Neutralizes** exotic Unicode whitespace to a plain space before any parsing.
- **Extracts** embedded duration and price, then returns a clean stripped name (dropping decorative
  bullets/pipes while preserving real hyphens like `semi-permanent`).
- **De-duplicates** repeated lines.
- **Builds a deterministic reconciliation key** — a sorted, whitespace/case-insensitive content
  signature (services + practitioner + total duration) — so a booking that was merely *moved* hashes
  to the same key and reconciles **in place** instead of duplicating.

## Files

- [`BookingNormalizer.php`](BookingNormalizer.php) — the normalizer + `ServiceLine` value object.
- [`test.php`](test.php) — 13 self-contained checks (splitting, U+202F, price/duration extraction, dedup, reconciliation key).

## Run

```bash
php examples/booking-ingestion/test.php
```
