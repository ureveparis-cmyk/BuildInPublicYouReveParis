# Timezone-correct availability engine

Compute the bookable start slots for a business day — correctly.

## The problem

A salon reasons about time in its **wall clock**: "we open at 09:00 in Paris." The database, on the
other hand, stores instants as UTC Unix timestamps. Converting between the two by hand is where
almost every home-grown booking system quietly breaks:

1. **DST.** Paris is UTC+1 in winter and UTC+2 in summer. A hard-coded offset makes every slot one
   hour wrong for half the year — and doubly wrong on the two transition days.
2. **Midnight roll-over.** Near 00:00, a naive UTC conversion can push a slot onto the previous or
   next calendar day, so "today's" availability silently leaks a day.

## The approach

Never do offset arithmetic yourself. Anchor every instant to a `DateTimeImmutable` in the
`Europe/Paris` zone — which knows the DST rules — and let the runtime resolve the UTC instant. The
conversion happens in exactly one place ([`wallClockToInstant()`](AvailabilityEngine.php)), and the
human-readable label is always rendered back *from* the stored UTC instant, so it matches what a
person at the salon would read.

Slots respect: opening windows (including split shifts), a "service must finish by closing time"
rule, a configurable granularity, and half-open overlap against already-booked intervals
(back-to-back bookings don't clash).

## Files

- [`AvailabilityEngine.php`](AvailabilityEngine.php) — the engine (pure, dependency-free).
- [`Slot.php`](Slot.php) — an immutable slot: wall-clock label + UTC start/end.
- [`test.php`](test.php) — 13 self-contained checks, including a DST-transition day.

## Run

```bash
php examples/availability-engine/test.php
```
