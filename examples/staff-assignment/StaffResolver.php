<?php

declare(strict_types=1);

namespace Youreve\Showcase\Staff;

require_once __DIR__ . '/types.php';

/**
 * Assigns practitioners to a multi-service booking.
 *
 * A Treatwell appointment often bundles several services — e.g. "gel removal + pedicure +
 * gel refill + baby boomer" — back to back. The scheduling rule the salon actually wants,
 * in priority order:
 *
 *   1. ONE practitioner for the whole appointment: the client stays with the same person.
 *      Requires someone qualified for EVERY service and free for the entire span.
 *   2. If no single practitioner fits, SPLIT the services across several — but only onto
 *      CONTIGUOUS segments (no gap left for the client) and, crucially, minimising the
 *      number of hand-offs. Prefer re-using a practitioner already in the plan before
 *      pulling in a new one.
 *   3. NEVER double-book one practitioner onto two overlapping segments.
 *
 * (2) is a small constraint-satisfaction problem, solved here with depth-first search that
 * orders candidates to (a) reuse already-assigned staff and (b) load-balance — so the first
 * complete solution found is also a good one. Pure and dependency-free.
 */
final class StaffResolver
{
    /**
     * @param list<Service>      $services       In the order they will be performed.
     * @param list<Practitioner> $practitioners
     * @param int                $bookingStartUtc Start instant of the whole appointment.
     *
     * @return AssignmentPlan|null Null when the booking cannot be staffed at all.
     */
    public function resolve(array $services, array $practitioners, int $bookingStartUtc): ?AssignmentPlan
    {
        if ($services === []) {
            return new AssignmentPlan([]);
        }

        // Contiguous segments: each service starts where the previous one ends.
        $segments = [];
        $cursor = $bookingStartUtc;
        foreach ($services as $service) {
            $end = $cursor + $service->durationMin * 60;
            $segments[] = ['service' => $service, 'start' => $cursor, 'end' => $end];
            $cursor = $end;
        }

        $spanStart = $bookingStartUtc;
        $spanEnd = $cursor;

        // --- Priority 1: one practitioner for everything. ---------------------------------
        $single = $this->bestSinglePractitioner($services, $practitioners, $spanStart, $spanEnd);
        if ($single !== null) {
            $resolved = [];
            foreach ($segments as $seg) {
                $resolved[] = new Segment(
                    $seg['service'],
                    $single->id,
                    $single->name,
                    $seg['start'],
                    $seg['end'],
                );
            }

            return new AssignmentPlan($resolved);
        }

        // --- Priority 2: split, minimising hand-offs via DFS. -----------------------------
        $plan = $this->search($segments, $practitioners, 0, []);

        return $plan === null ? null : new AssignmentPlan($plan);
    }

    /**
     * The single practitioner qualified for every service and free for the whole span.
     * Among candidates, pick the least-loaded (load-balancing), tie-broken by id for
     * deterministic output.
     *
     * @param list<Service>      $services
     * @param list<Practitioner> $practitioners
     */
    private function bestSinglePractitioner(
        array $services,
        array $practitioners,
        int $spanStart,
        int $spanEnd,
    ): ?Practitioner {
        $skills = array_unique(array_map(static fn (Service $s): string => $s->requiredSkill, $services));

        $eligible = array_filter($practitioners, static function (Practitioner $p) use ($skills, $spanStart, $spanEnd): bool {
            foreach ($skills as $skill) {
                if (!$p->hasSkill($skill)) {
                    return false;
                }
            }

            return $p->isFree($spanStart, $spanEnd);
        });

        if ($eligible === []) {
            return null;
        }

        usort($eligible, static fn (Practitioner $a, Practitioner $b): int =>
            [$a->loadMinutes(), $a->id] <=> [$b->loadMinutes(), $b->id]);

        return $eligible[0];
    }

    /**
     * DFS over segments. At each step, candidate practitioners are ordered so that ones
     * already in the partial plan come first (fewer hand-offs), then by ascending load.
     * Returns the first complete assignment, or null.
     *
     * @param list<array{service:Service,start:int,end:int}> $segments
     * @param list<Practitioner>                             $practitioners
     * @param list<Segment>                                  $plan Partial plan so far.
     *
     * @return list<Segment>|null
     */
    private function search(array $segments, array $practitioners, int $index, array $plan): ?array
    {
        if ($index === count($segments)) {
            return $plan;
        }

        $seg = $segments[$index];
        $usedIds = array_map(static fn (Segment $s): string => $s->practitionerId, $plan);

        $candidates = array_filter($practitioners, function (Practitioner $p) use ($seg, $plan): bool {
            if (!$p->hasSkill($seg['service']->requiredSkill)) {
                return false;
            }
            if (!$p->isFree($seg['start'], $seg['end'])) {
                return false;
            }

            // Guard against double-booking within THIS plan (overlapping assigned segments).
            foreach ($plan as $assigned) {
                if ($assigned->practitionerId === $p->id
                    && $seg['start'] < $assigned->endUtc && $assigned->startUtc < $seg['end']) {
                    return false;
                }
            }

            return true;
        });

        usort($candidates, static function (Practitioner $a, Practitioner $b) use ($usedIds): array|int {
            $aReuse = in_array($a->id, $usedIds, true) ? 0 : 1;
            $bReuse = in_array($b->id, $usedIds, true) ? 0 : 1;

            return [$aReuse, $a->loadMinutes(), $a->id] <=> [$bReuse, $b->loadMinutes(), $b->id];
        });

        foreach ($candidates as $p) {
            $next = $plan;
            $next[] = new Segment($seg['service'], $p->id, $p->name, $seg['start'], $seg['end']);

            $result = $this->search($segments, $practitioners, $index + 1, $next);
            if ($result !== null) {
                return $result;
            }
        }

        return null;
    }
}
