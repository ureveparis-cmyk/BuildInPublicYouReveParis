<?php

declare(strict_types=1);

namespace Youreve\Showcase\Ingestion;

/** One parsed service line: a clean name, plus duration/price when they were embedded. */
final class ServiceLine
{
    public function __construct(
        public readonly string $name,
        public readonly ?int $durationMin = null,
        public readonly ?float $priceEur = null,
    ) {
    }
}

/**
 * Normalises the messy service data that third-party marketplaces (Treatwell, ClassPass, …)
 * hand over. None of it is clean:
 *
 *   - Treatwell concatenates multi-service bookings with NO separator, relying only on the
 *     camel-case boundary: "Dépose gelBeauté des piedsRemplissage gel".
 *   - ClassPass sprinkles NARROW NO-BREAK SPACES (U+202F) and non-breaking spaces (U+00A0)
 *     between the number and its unit, so "45 min" is really "45\u{202F}min" — which every
 *     naive `\s`-free or byte-based parser misses.
 *   - Prices are glued to durations, use comma decimals ("39,50 €"), and repeat across lines.
 *   - Critically, some sources ship NO stable booking id, so a reschedule looks like a brand
 *     new booking. Reconciling them needs a deterministic content signature.
 *
 * This class is pure and Unicode-aware (all regex run in /u mode).
 */
final class BookingNormalizer
{
    /** Whitespace variants that must all collapse to a plain space before parsing. */
    private const EXOTIC_SPACES = [
        "\u{00A0}", // no-break space
        "\u{202F}", // narrow no-break space
        "\u{2009}", // thin space
        "\u{200A}", // hair space
        "\u{2007}", // figure space
    ];

    /** Replace exotic Unicode spaces, collapse runs, trim. */
    public function normalizeWhitespace(string $raw): string
    {
        $s = str_replace(self::EXOTIC_SPACES, ' ', $raw);
        $s = preg_replace('/\s+/u', ' ', $s) ?? $s;

        return trim($s);
    }

    /**
     * Split a concatenated multi-service string on lost word boundaries.
     *
     * Heuristic: a lowercase letter immediately followed by an uppercase letter marks a
     * boundary the source dropped (a real space would still be there otherwise). Runs in
     * Unicode mode so accented capitals (É, À, Ç) are recognised as uppercase.
     *
     * @return list<string>
     */
    public function splitConcatenatedServices(string $raw): array
    {
        $clean = $this->normalizeWhitespace($raw);
        if ($clean === '') {
            return [];
        }

        $parts = preg_split('/(?<=\p{Ll})(?=\p{Lu})/u', $clean) ?: [$clean];

        return array_values(array_filter(array_map('trim', $parts), static fn (string $p): bool => $p !== ''));
    }

    /**
     * Parse a single line into name + optional duration + optional price, stripping the
     * numeric tokens out of the returned name.
     */
    public function parseServiceLine(string $line): ServiceLine
    {
        $clean = $this->normalizeWhitespace($line);

        $duration = null;
        if (preg_match('/(\d+)\s*min\b/u', $clean, $m) === 1) {
            $duration = (int) $m[1];
        }

        $price = null;
        if (preg_match('/(\d+(?:[.,]\d+)?)\s*€/u', $clean, $m) === 1) {
            $price = (float) str_replace(',', '.', $m[1]);
        }

        // Remove the duration/price tokens from the name.
        $name = preg_replace('/\d+\s*min\b/u', '', $clean) ?? $clean;
        $name = preg_replace('/\d+(?:[.,]\d+)?\s*€/u', '', $name) ?? $name;

        // Decorative bullets/pipes are never part of a service name — drop them everywhere.
        // (Hyphens and dashes are left alone: "semi-permanent", "baby-boomer".)
        $name = preg_replace('/[·•|]+/u', ' ', $name) ?? $name;
        $name = $this->normalizeWhitespace($name);

        // Finally trim orphaned separators left dangling at either end.
        $name = preg_replace('/^[\s,\-–—:]+|[\s,\-–—:]+$/u', '', $name) ?? $name;

        return new ServiceLine($this->normalizeWhitespace($name), $duration, $price);
    }

    /**
     * Full parse of a raw services blob: split, parse each line, and deduplicate lines that
     * normalise to the same name (marketplaces frequently repeat a line).
     *
     * @return list<ServiceLine>
     */
    public function parse(string $rawBlob): array
    {
        $lines = $this->splitConcatenatedServices($rawBlob);

        $seen = [];
        $result = [];
        foreach ($lines as $line) {
            $parsed = $this->parseServiceLine($line);
            $key = mb_strtolower($parsed->name);
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $result[] = $parsed;
        }

        return $result;
    }

    /**
     * A deterministic content signature for reconciling bookings across sources and across
     * reschedules, when no stable id exists. Order-independent (services are sorted), and
     * insensitive to whitespace/case. Two ingests of "the same appointment moved by an hour"
     * collapse to the same key, so the reschedule updates in place instead of duplicating.
     *
     * @param list<string> $serviceNames
     */
    public function reconciliationKey(array $serviceNames, string $practitioner, int $totalDurationMin): string
    {
        $normalized = array_map(
            fn (string $n): string => mb_strtolower($this->normalizeWhitespace($n)),
            $serviceNames,
        );
        sort($normalized, SORT_STRING);

        $signature = implode('|', $normalized)
            . '#' . mb_strtolower($this->normalizeWhitespace($practitioner))
            . '#' . $totalDurationMin;

        return hash('sha256', $signature);
    }
}
