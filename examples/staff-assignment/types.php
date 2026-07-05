<?php

declare(strict_types=1);

namespace Youreve\Showcase\Staff;

/** A single service line in a booking: what skill it needs and how long it takes. */
final class Service
{
    public function __construct(
        public readonly string $name,
        public readonly string $requiredSkill,
        public readonly int $durationMin,
    ) {
    }
}

/** A practitioner: the skills she is qualified for and the intervals she is already busy. */
final class Practitioner
{
    /**
     * @param list<string> $skills
     * @param list<array{start:int,end:int}> $busy UTC intervals already booked that day.
     */
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly array $skills,
        public readonly array $busy = [],
    ) {
    }

    public function hasSkill(string $skill): bool
    {
        return in_array($skill, $this->skills, true);
    }

    /** Free across [start, end) — half-open, so back-to-back appointments do not clash. */
    public function isFree(int $start, int $end): bool
    {
        foreach ($this->busy as $b) {
            if ($start < $b['end'] && $b['start'] < $end) {
                return false;
            }
        }

        return true;
    }

    /** Total booked minutes that day — used to load-balance between equally-qualified staff. */
    public function loadMinutes(): int
    {
        $sum = 0;
        foreach ($this->busy as $b) {
            $sum += (int) (($b['end'] - $b['start']) / 60);
        }

        return $sum;
    }
}

/** One resolved segment: a service, the practitioner doing it, and its UTC interval. */
final class Segment
{
    public function __construct(
        public readonly Service $service,
        public readonly string $practitionerId,
        public readonly string $practitionerName,
        public readonly int $startUtc,
        public readonly int $endUtc,
    ) {
    }
}

/** The full resolved plan for a multi-service booking. */
final class AssignmentPlan
{
    /** @param list<Segment> $segments */
    public function __construct(public readonly array $segments)
    {
    }

    /** @return list<string> distinct practitioner ids, in first-seen order. */
    public function practitionerIds(): array
    {
        $ids = [];
        foreach ($this->segments as $s) {
            if (!in_array($s->practitionerId, $ids, true)) {
                $ids[] = $s->practitionerId;
            }
        }

        return $ids;
    }

    public function isSinglePractitioner(): bool
    {
        return count($this->practitionerIds()) === 1;
    }
}
