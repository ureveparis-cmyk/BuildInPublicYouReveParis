<?php

declare(strict_types=1);

/**
 * Self-contained test runner — no framework required.
 *
 *   php examples/availability-engine/test.php
 */

require __DIR__ . '/Slot.php';
require __DIR__ . '/AvailabilityEngine.php';

use Youreve\Showcase\Availability\AvailabilityEngine;
use Youreve\Showcase\Availability\Slot;

$tests = 0;
$failures = 0;

function check(string $name, bool $ok): void
{
    global $tests, $failures;
    $tests++;
    if ($ok) {
        echo "  \u{2713} {$name}\n";
    } else {
        $failures++;
        echo "  \u{2717} {$name}\n";
    }
}

/** Format a UTC timestamp as an H:i label in a given zone. */
function labelIn(int $ts, string $zone): string
{
    return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone($zone))->format('H:i');
}

$engine = new AvailabilityEngine('Europe/Paris');

echo "AvailabilityEngine\n";

// ---------------------------------------------------------------------------
// 1. Basic generation: 09:00–11:00, 60-min service, 30-min step → 3 starts.
//    (09:00, 09:30, 10:00 — 10:30 would finish at 11:30 > close.)
// ---------------------------------------------------------------------------
$slots = $engine->slotsForDay('2026-01-15', [['start' => '09:00', 'end' => '11:00']], 60, 30);
check('generates the right number of slots', count($slots) === 3);
check('first slot label is 09:00', $slots[0]->wallClockLabel === '09:00');
check('last slot label is 10:00 (service must finish by close)', $slots[2]->wallClockLabel === '10:00');
check('slot end is start + duration', $slots[0]->endUtc - $slots[0]->startUtc === 3600);

// ---------------------------------------------------------------------------
// 2. DST-awareness. 2026-01-15 is winter (UTC+1); 2026-07-15 is summer (UTC+2).
//    The SAME wall-clock 09:00 must resolve to DIFFERENT UTC instants — exactly
//    one hour apart — and both must read back as "09:00" in Paris.
// ---------------------------------------------------------------------------
$winter = $engine->slotsForDay('2026-01-15', [['start' => '09:00', 'end' => '10:00']], 60, 60)[0];
$summer = $engine->slotsForDay('2026-07-15', [['start' => '09:00', 'end' => '10:00']], 60, 60)[0];

check('winter 09:00 Paris stores as 08:00 UTC', labelIn($winter->startUtc, 'UTC') === '08:00');
check('summer 09:00 Paris stores as 07:00 UTC', labelIn($summer->startUtc, 'UTC') === '07:00');
check('both read back as 09:00 in Paris', labelIn($winter->startUtc, 'Europe/Paris') === '09:00'
    && labelIn($summer->startUtc, 'Europe/Paris') === '09:00');
check('DST shifts the stored instant by exactly one hour',
    ($winter->startUtc % 86400) - ($summer->startUtc % 86400) === 3600);

// ---------------------------------------------------------------------------
// 3. On the spring-forward day (2026-03-29, clocks jump 02:00→03:00) an
//    afternoon window is unaffected and still generates valid slots.
// ---------------------------------------------------------------------------
$dstDay = $engine->slotsForDay('2026-03-29', [['start' => '14:00', 'end' => '15:00']], 60, 60);
check('handles the DST-transition day without crashing', count($dstDay) === 1);
check('post-transition slot uses summer offset (14:00 Paris = 12:00 UTC)',
    labelIn($dstDay[0]->startUtc, 'UTC') === '12:00');

// ---------------------------------------------------------------------------
// 4. Busy intervals remove overlapping slots (half-open: back-to-back is free).
//    Window 09:00–12:00, 60-min service, 60-min step → 09:00/10:00/11:00.
//    Book 10:00–11:00 → only 09:00 and 11:00 remain.
// ---------------------------------------------------------------------------
$all = $engine->slotsForDay('2026-01-15', [['start' => '09:00', 'end' => '12:00']], 60, 60);
$busy = [['start' => $all[1]->startUtc, 'end' => $all[1]->endUtc]]; // the 10:00 slot
$free = $engine->slotsForDay('2026-01-15', [['start' => '09:00', 'end' => '12:00']], 60, 60, $busy);
$labels = array_map(static fn (Slot $s): string => $s->wallClockLabel, $free);
check('booked slot is removed', !in_array('10:00', $labels, true));
check('back-to-back slots stay bookable', $labels === ['09:00', '11:00']);

// ---------------------------------------------------------------------------
// 5. Split shift (two windows) merges and sorts chronologically.
// ---------------------------------------------------------------------------
$split = $engine->slotsForDay(
    '2026-01-15',
    [['start' => '09:00', 'end' => '10:00'], ['start' => '14:00', 'end' => '15:00']],
    60,
    60,
);
$splitLabels = array_map(static fn (Slot $s): string => $s->wallClockLabel, $split);
check('split shift merges both windows in order', $splitLabels === ['09:00', '14:00']);

echo "\n{$tests} checks, {$failures} failure(s)\n";
exit($failures === 0 ? 0 : 1);
