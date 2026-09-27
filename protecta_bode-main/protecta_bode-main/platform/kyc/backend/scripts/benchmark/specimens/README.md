# Benchmark specimens

**Nothing in this directory is committed except this README and `.gitignore`.**

Specimens are identity documents. Even the sample ones tend to be real cards
belonging to real people, and a benchmark corpus is exactly the kind of thing
that gets copied into a bug report without thinking. Keep them local, or in
whatever storage your team already uses for sensitive test fixtures.

This directory is shared with
`src/providers/ocr/__tests__/extraction-accuracy.test.ts`, which skips itself
unless a country subdirectory is present. Both layouts below are understood by
the benchmark, so one dataset serves both.

## Adding a specimen

### Flat layout

Two files sharing a stem:

```
ug-nid-front-01.jpg
ug-nid-front-01.expected.json
```

The JSON is the ground truth - what a careful human reads off the document:

```json
{
  "document_type": "national_id",
  "issuing_country": "UG",
  "note": "glare across the lower third",
  "expected": {
    "surname": "NAKATO",
    "given_names": "SARAH MIRIAM",
    "nin": "CF85012345PEXD",
    "card_number": "000123456",
    "date_of_birth": "1985-01-06",
    "sex": "F"
  }
}
```

Only the fields listed in `expected` are scored, so start with the ones that
actually gate a verification and add more as you care about them. Field names
must match `OCRData` in `shared/src/types/index.ts`.

Dates are compared as dates, so `06/01/1985` and `1985-01-06` agree. Everything
else is compared with case, punctuation and repeated spaces folded away -
`O'BRIEN` and `O Brien` count as the same read.

### Country layout

What the extraction-accuracy tests already read, and what the bundled
54-specimen dataset uses:

```
specimens/US/front_01.jpg
specimens/US/ground_truth_01.json
specimens/US_states/CA/front_02.jpg
specimens/US_states/CA/ground_truth_02.json
```

Here the ground-truth fields sit at the top level rather than under `expected`;
`document_type` and `issuing_country` are treated as metadata, and every other
string field is scored.

## Choosing specimens

A corpus of clean, flat, well-lit documents will tell you the OCR is excellent
and teach you nothing. Aim for the ones support tickets are made of:

- glare, shadow, and a hand covering a corner
- photographed at an angle, or off a screen
- worn and creased cards, faded thermal print
- each document type and issuing country you actually accept
- at least a couple you expect to fail, so a regression that "fixes" them by
  hallucinating plausible values shows up as a wrong answer rather than a win

## Running

```bash
npm run benchmark                                  # both providers, default paths
tsx scripts/benchmark/benchmark-ocr.ts --verbose   # print every field mismatch
tsx scripts/benchmark/benchmark-ocr.ts --providers paddle
tsx scripts/benchmark/benchmark-ocr.ts --document-type passport
tsx scripts/benchmark/benchmark-ocr.ts --fail-under 90   # non-zero exit for CI
```

Results land in `scripts/benchmark/benchmark-results.json` (also ignored).
Keep a copy of the run from before a provider or preprocessing change; the
number on its own means much less than the difference between two numbers.
