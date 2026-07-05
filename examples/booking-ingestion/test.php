<?php

declare(strict_types=1);

/**
 * Self-contained test runner — no framework required.
 *
 *   php examples/booking-ingestion/test.php
 */

require __DIR__ . '/BookingNormalizer.php';

use Youreve\Showcase\Ingestion\BookingNormalizer;
use Youreve\Showcase\Ingestion\ServiceLine;

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

$n = new BookingNormalizer();

echo "BookingNormalizer\n";

// ---------------------------------------------------------------------------
// 1. Treatwell-style concatenation split on the camel-case boundary, accents included.
// ---------------------------------------------------------------------------
$parts = $n->splitConcatenatedServices('Dépose gelBeauté des piedsRemplissage gel');
check('splits concatenated services on the lost word boundary',
    $parts === ['Dépose gel', 'Beauté des pieds', 'Remplissage gel']);

$single = $n->splitConcatenatedServices('Vernis semi-permanent mains');
check('leaves a single well-formed service untouched', $single === ['Vernis semi-permanent mains']);

check('recognises accented capitals as boundaries',
    $n->splitConcatenatedServices('poseÉclat du regard') === ['pose', 'Éclat du regard']);

// ---------------------------------------------------------------------------
// 2. Exotic Unicode whitespace (narrow no-break space U+202F, nbsp U+00A0) is normalised.
// ---------------------------------------------------------------------------
$narrow = "45\u{202F}min"; // ClassPass-style narrow no-break space
check('narrow no-break space does not break duration parsing',
    $n->parseServiceLine("Remplissage gel {$narrow}")->durationMin === 45);

$nbsp = "Beauté\u{00A0}des\u{00A0}pieds";
check('non-breaking spaces collapse to a plain space',
    $n->normalizeWhitespace($nbsp) === 'Beauté des pieds');

// ---------------------------------------------------------------------------
// 3. Duration + price extraction, comma decimals, and a clean stripped name.
// ---------------------------------------------------------------------------
$line = $n->parseServiceLine("Remplissage gel · 45 min · 39,50 €");
check('extracts duration', $line->durationMin === 45);
check('extracts price with comma decimals', $line->priceEur === 39.5);
check('strips numeric tokens and separators from the name', $line->name === 'Remplissage gel');

$bare = $n->parseServiceLine('Baby boomer');
check('a name with no numbers yields null duration/price',
    $bare->name === 'Baby boomer' && $bare->durationMin === null && $bare->priceEur === null);

// ---------------------------------------------------------------------------
// 4. Full parse deduplicates repeated lines.
// ---------------------------------------------------------------------------
$parsed = $n->parse('Dépose gelDépose gelBaby boomer');
$names = array_map(static fn (ServiceLine $l): string => $l->name, $parsed);
check('deduplicates repeated service lines', $names === ['Dépose gel', 'Baby boomer']);

// ---------------------------------------------------------------------------
// 5. Reconciliation key: order-independent, whitespace/case-insensitive, id-free matching.
// ---------------------------------------------------------------------------
$a = $n->reconciliationKey(['Dépose gel', 'Baby boomer'], 'Nadia', 60);
$b = $n->reconciliationKey(['Baby boomer', 'dépose  gel'], 'nadia', 60); // reordered, messy spacing/case
check('reconciliation key is order- and whitespace-insensitive', $a === $b);

$different = $n->reconciliationKey(['Dépose gel', 'Baby boomer'], 'Sonia', 60); // different practitioner
check('a different practitioner yields a different key', $a !== $different);

$longer = $n->reconciliationKey(['Dépose gel', 'Baby boomer'], 'Nadia', 90); // different duration
check('a different total duration yields a different key', $a !== $longer);

echo "\n{$tests} checks, {$failures} failure(s)\n";
exit($failures === 0 ? 0 : 1);
