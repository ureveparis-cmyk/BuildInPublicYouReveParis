<?php

declare(strict_types=1);

namespace Youreve\Showcase\Availability;

/**
 * An immutable bookable slot: the human-readable wall-clock label the salon reads,
 * plus the canonical UTC instants persisted to the database.
 */
final class Slot
{
    public function __construct(
        public readonly string $wallClockLabel,
        public readonly int $startUtc,
        public readonly int $endUtc,
    ) {
    }

    /** @return array{label:string,startUtc:int,endUtc:int} */
    public function toArray(): array
    {
        return [
            'label' => $this->wallClockLabel,
            'startUtc' => $this->startUtc,
            'endUtc' => $this->endUtc,
        ];
    }
}
