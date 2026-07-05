<?php

declare(strict_types=1);

namespace Youreve\Showcase\Availability;

/**
 * Timezone-correct bookable-slot generation.
 *
 * A salon reasons about time in its own WALL CLOCK — "an opening at 09:00 in Paris" —
 * while the database stores instants as UTC Unix timestamps. The trap that bites almost
 * every home-grown booking system is doing that conversion by hand: adding a fixed offset,
 * or round-tripping through a naive `toISOString()`. Two failure modes follow:
 *
 *   1. DST. Paris is UTC+1 in winter and UTC+2 in summer. A hard-coded offset produces
 *      slots that are one hour wrong for half the year, and doubly wrong on the two
 *      transition days when the offset changes mid-day.
 *   2. Midnight roll-over. Near 00:00, a naive UTC conversion can push a slot onto the
 *      previous or next calendar day, so "today's" availability silently leaks a day.
 *
 * The fix is to never do offset arithmetic yourself: build every instant from a
 * DateTimeImmutable anchored to the Europe/Paris zone (which knows the DST rules) and let
 * the runtime resolve the UTC instant. This class is pure and dependency-free so the logic
 * can be unit-tested in isolation — including on a real DST-transition day.
 */
final class AvailabilityEngine
{
    public function __construct(
        private readonly string $businessTimezone = 'Europe/Paris',
    ) {
    }

    /**
     * Compute the bookable start slots for a single business day.
     *
     * @param string        $businessDate     'Y-m-d' in the business's wall clock (e.g. '2026-03-29').
     * @param array<array{start:string,end:string}> $openingHours Wall-clock windows, e.g.
     *                                        [['start' => '09:00', 'end' => '19:00']]. Multiple
     *                                        windows model split shifts / lunch breaks.
     * @param int           $serviceDuration  Minutes the chosen service occupies.
     * @param int           $granularity      Slot step in minutes (e.g. 15).
     * @param array<array{start:int,end:int}> $busyIntervals Already-booked intervals as UTC
     *                                        Unix timestamps [start, end).
     *
     * @return list<Slot> Bookable slots, each carrying both its Paris wall-clock label and its
     *                    canonical UTC start/end — ordered chronologically.
     */
    public function slotsForDay(
        string $businessDate,
        array $openingHours,
        int $serviceDuration,
        int $granularity,
        array $busyIntervals = [],
    ): array {
        if ($serviceDuration <= 0 || $granularity <= 0) {
            throw new \InvalidArgumentException('Duration and granularity must be positive.');
        }

        $tz = new \DateTimeZone($this->businessTimezone);
        $durationSec = $serviceDuration * 60;
        $stepSec = $granularity * 60;
        $slots = [];

        foreach ($openingHours as $window) {
            // Anchor both edges to the business date IN the business zone. DateTimeImmutable
            // resolves the correct UTC instant, DST included — no manual offset anywhere.
            $windowOpen = $this->wallClockToInstant($businessDate, $window['start'], $tz);
            $windowClose = $this->wallClockToInstant($businessDate, $window['end'], $tz);

            $openTs = $windowOpen->getTimestamp();
            $closeTs = $windowClose->getTimestamp();

            // A service must FINISH by close, so the last valid start is close - duration.
            for ($startTs = $openTs; $startTs + $durationSec <= $closeTs; $startTs += $stepSec) {
                $endTs = $startTs + $durationSec;

                if ($this->overlapsAny($startTs, $endTs, $busyIntervals)) {
                    continue;
                }

                // Render the wall-clock label FROM the UTC instant, back through the business
                // zone — so the label is always the time a human at the salon would read.
                $label = (new \DateTimeImmutable('@' . $startTs))
                    ->setTimezone($tz)
                    ->format('H:i');

                $slots[] = new Slot($label, $startTs, $endTs);
            }
        }

        usort($slots, static fn (Slot $a, Slot $b): int => $a->startUtc <=> $b->startUtc);

        return $slots;
    }

    /**
     * Build a UTC instant from a wall-clock date + time in a given zone.
     * The single choke point where local time becomes an absolute instant.
     */
    private function wallClockToInstant(string $date, string $time, \DateTimeZone $tz): \DateTimeImmutable
    {
        $instant = \DateTimeImmutable::createFromFormat('Y-m-d H:i', "{$date} {$time}", $tz);

        if ($instant === false) {
            throw new \InvalidArgumentException("Invalid date/time: {$date} {$time}");
        }

        // createFromFormat leaves seconds at "now"; pin them to :00 for stable slot math.
        return $instant->setTime((int) $instant->format('H'), (int) $instant->format('i'), 0);
    }

    /**
     * Half-open overlap test: [aStart, aEnd) intersects [bStart, bEnd) iff
     * aStart < bEnd AND bStart < aEnd. Back-to-back bookings do NOT overlap.
     *
     * @param array<array{start:int,end:int}> $busyIntervals
     */
    private function overlapsAny(int $start, int $end, array $busyIntervals): bool
    {
        foreach ($busyIntervals as $busy) {
            if ($start < $busy['end'] && $busy['start'] < $end) {
                return true;
            }
        }

        return false;
    }
}
