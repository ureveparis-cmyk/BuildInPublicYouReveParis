<?php

declare(strict_types=1);

/**
 * Self-contained test runner — no framework required.
 *
 *   php examples/staff-assignment/test.php
 */

require __DIR__ . '/StaffResolver.php';

use Youreve\Showcase\Staff\AssignmentPlan;
use Youreve\Showcase\Staff\Practitioner;
use Youreve\Showcase\Staff\Segment;
use Youreve\Showcase\Staff\Service;
use Youreve\Showcase\Staff\StaffResolver;

$tests = 0;
$failures = 0;

function check(string $name, bool $ok): void
{
    global $tests, $failures;
    $tests++;
    echo $ok ? "  \u{2713} {$name}\n" : "  \u{2717} {$name}\n";
    if (!$ok) {
        $failures++;
    }
}

/** @param list<Segment> $segments */
function segmentFor(array $segments, string $serviceName): ?Segment
{
    foreach ($segments as $s) {
        if ($s->service->name === $serviceName) {
            return $s;
        }
    }

    return null;
}

$resolver = new StaffResolver();
$start = 1_700_000_000; // arbitrary fixed instant

$services = [
    new Service('Dépose', 'depose', 20),
    new Service('Beauté des pieds', 'pedicure', 45),
    new Service('Remplissage gel', 'gel', 30),
    new Service('Baby boomer', 'babyboomer', 40),
];

echo "StaffResolver\n";

// ---------------------------------------------------------------------------
// 1. One practitioner qualified for everything and free → single-practitioner plan.
// ---------------------------------------------------------------------------
$alice = new Practitioner('p1', 'Alice', ['depose', 'pedicure', 'gel', 'babyboomer']);
$plan = $resolver->resolve($services, [$alice], $start);
check('resolves a plan', $plan instanceof AssignmentPlan);
check('prefers a single practitioner for the whole appointment', $plan->isSinglePractitioner());
check('segments are contiguous (no gap for the client)', segmentsContiguous($plan->segments));
check('the whole appointment goes to Alice', $plan->practitionerIds() === ['p1']);

// ---------------------------------------------------------------------------
// 2. No single practitioner covers all four skills → split, contiguous, no double-book.
// ---------------------------------------------------------------------------
$aliceHalf = new Practitioner('p1', 'Alice', ['depose', 'gel']);
$bobHalf = new Practitioner('p2', 'Bob', ['pedicure', 'babyboomer']);
$plan = $resolver->resolve($services, [$aliceHalf, $bobHalf], $start);
check('splits when no single practitioner is qualified', $plan !== null && !$plan->isSinglePractitioner());
check('uses exactly two practitioners', $plan !== null && count($plan->practitionerIds()) === 2);
check('each segment is done by a qualified practitioner', $plan !== null && allSegmentsQualified($plan->segments, [$aliceHalf, $bobHalf]));
check('split segments stay contiguous', $plan !== null && segmentsContiguous($plan->segments));
check('no practitioner is double-booked', $plan !== null && noDoubleBooking($plan->segments));

// ---------------------------------------------------------------------------
// 3. A fully-qualified practitioner who is BUSY for the span is skipped; others cover.
// ---------------------------------------------------------------------------
$busyAlice = new Practitioner('p1', 'Alice', ['depose', 'pedicure', 'gel', 'babyboomer'], [
    ['start' => $start - 3600, 'end' => $start + 100000], // busy across the whole appointment
]);
$plan = $resolver->resolve($services, [$busyAlice, $aliceHalf, $bobHalf], $start);
// Rename the two coverers so ids are distinct from busy Alice.
$coverA = new Practitioner('p3', 'Chloé', ['depose', 'gel']);
$coverB = new Practitioner('p4', 'Dora', ['pedicure', 'babyboomer']);
$plan = $resolver->resolve($services, [$busyAlice, $coverA, $coverB], $start);
check('a busy fully-qualified practitioner is not chosen', $plan !== null && !in_array('p1', $plan->practitionerIds(), true));
check('the booking is still staffed by the free practitioners', $plan !== null && count($plan->practitionerIds()) === 2);

// ---------------------------------------------------------------------------
// 4. Two equally-qualified & free practitioners → the least-loaded one is chosen.
// ---------------------------------------------------------------------------
$fresh = new Practitioner('p5', 'Eva', ['depose', 'pedicure', 'gel', 'babyboomer']); // 0 min load
$loaded = new Practitioner('p6', 'Faye', ['depose', 'pedicure', 'gel', 'babyboomer'], [
    ['start' => $start - 20000, 'end' => $start - 10000], // 166 min already booked elsewhere
]);
$plan = $resolver->resolve($services, [$loaded, $fresh], $start);
check('load-balances onto the least-busy practitioner', $plan !== null && $plan->practitionerIds() === ['p5']);

// ---------------------------------------------------------------------------
// 5. A required skill nobody has → unstaffable → null.
// ---------------------------------------------------------------------------
$withMassage = [...$services, new Service('Massage', 'massage', 30)];
$plan = $resolver->resolve($withMassage, [$alice], $start);
check('returns null when a service cannot be staffed', $plan === null);

// ---------------------------------------------------------------------------
// 6. Hand-off minimisation: reuse a practitioner already in the plan before adding a new one.
//    Services: Dépose (Alice/Carol), Beauté pieds (Bob only), Remplissage (Alice/Carol).
//    Optimal: Dépose→Alice, pieds→Bob, remplissage→REUSE Alice (not Carol).
// ---------------------------------------------------------------------------
$threeSvc = [
    new Service('Dépose', 'depose', 20),
    new Service('Beauté des pieds', 'pedicure', 45),
    new Service('Remplissage gel', 'gel', 30),
];
$aliceDG = new Practitioner('p1', 'Alice', ['depose', 'gel']);
$bobP = new Practitioner('p2', 'Bob', ['pedicure']);
$carolDG = new Practitioner('p3', 'Carol', ['depose', 'gel']);
$plan = $resolver->resolve($threeSvc, [$aliceDG, $bobP, $carolDG], $start);
check('minimises hand-offs (Carol is not pulled in unnecessarily)', $plan !== null && !in_array('p3', $plan->practitionerIds(), true));
check('re-uses the same practitioner for both nail segments',
    $plan !== null
    && segmentFor($plan->segments, 'Dépose')?->practitionerId === segmentFor($plan->segments, 'Remplissage gel')?->practitionerId);

echo "\n{$tests} checks, {$failures} failure(s)\n";
exit($failures === 0 ? 0 : 1);

// --- assertion helpers -----------------------------------------------------

/** @param list<Segment> $segments */
function segmentsContiguous(array $segments): bool
{
    for ($i = 1, $n = count($segments); $i < $n; $i++) {
        if ($segments[$i]->startUtc !== $segments[$i - 1]->endUtc) {
            return false;
        }
    }

    return true;
}

/**
 * @param list<Segment>      $segments
 * @param list<Practitioner> $practitioners
 */
function allSegmentsQualified(array $segments, array $practitioners): bool
{
    $byId = [];
    foreach ($practitioners as $p) {
        $byId[$p->id] = $p;
    }

    foreach ($segments as $s) {
        if (!$byId[$s->practitionerId]->hasSkill($s->service->requiredSkill)) {
            return false;
        }
    }

    return true;
}

/** @param list<Segment> $segments */
function noDoubleBooking(array $segments): bool
{
    foreach ($segments as $i => $a) {
        foreach ($segments as $j => $b) {
            if ($i >= $j || $a->practitionerId !== $b->practitionerId) {
                continue;
            }
            if ($a->startUtc < $b->endUtc && $b->startUtc < $a->endUtc) {
                return false; // same practitioner, overlapping intervals
            }
        }
    }

    return true;
}
