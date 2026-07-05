# Multi-service staff assignment

Assign practitioners to a booking that bundles several services back-to-back.

## The problem

A Treatwell appointment often looks like *"gel removal + pedicure + gel refill + baby boomer"* — one
booking, several services, one continuous block of time. Who does what? The rule the salon actually
wants, in priority order:

1. **One practitioner for the whole appointment.** The client stays with the same person. Requires
   someone qualified for *every* service and free for the entire span.
2. **If that's impossible, split** the services across several practitioners — but only onto
   **contiguous** segments (no gap left for the client), and **minimize the number of hand-offs**
   (reuse a practitioner already in the plan before pulling in a new one).
3. **Never double-book** one practitioner onto two overlapping segments.

## The approach

Priority (1) is a direct filter: the least-loaded practitioner qualified for all services and free
for the whole span (load-balanced, deterministic tie-break).

Priority (2) is a small **constraint-satisfaction problem**, solved with depth-first search. At each
segment, candidates are ordered so that (a) practitioners already in the partial plan come first —
which greedily minimizes hand-offs — and (b) less-loaded staff come next. Because of that ordering,
the *first* complete assignment the search returns is already a good one, so no scoring pass over all
solutions is needed. The search also enforces the no-double-booking guard, so the result is always
feasible or explicitly `null`.

## Files

- [`StaffResolver.php`](StaffResolver.php) — the resolver (single-practitioner fast path + DFS split).
- [`types.php`](types.php) — `Service`, `Practitioner`, `Segment`, `AssignmentPlan` value objects.
- [`test.php`](test.php) — 15 self-contained checks (single, split, busy fallback, load-balancing, infeasible, hand-off minimization).

## Run

```bash
php examples/staff-assignment/test.php
```
