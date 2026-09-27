#!/usr/bin/env tsx
/**
 * OCR accuracy benchmark.
 *
 *   npm run benchmark
 *   tsx scripts/benchmark/benchmark-ocr.ts \
 *     --specimens-dir scripts/benchmark/specimens \
 *     --output scripts/benchmark/benchmark-results.json
 *
 * Runs every configured OCR provider over a directory of specimen documents
 * that each carry a hand-written ground truth, and reports per-field accuracy,
 * latency and the specific fields each provider gets wrong.
 *
 * Why this exists
 * ---------------
 * "The OCR works" is not a measurement. Swapping a provider, changing a
 * preprocessing step or bumping a dependency can quietly cost accuracy on
 * exactly the fields that matter - a document number read as `O` instead of
 * `0` is a failed verification for a real person. This harness turns that into
 * a number you can compare before and after a change.
 *
 * A field is scored on normalised comparison (case, spacing and punctuation
 * folded, dates to ISO), because `KAMPALA` vs `Kampala` is not an OCR error,
 * while `1985-03-06` vs `1985-06-03` very much is.
 *
 * Specimens never enter git - see specimens/README.md.
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { OCRProvider, OCRData } from '@kabila/shared';
import { PaddleOCRProvider } from '../../src/providers/ocr/PaddleOCRProvider.js';
import { TesseractProvider } from '../../src/providers/ocr/TesseractProvider.js';

// ───────────────────────── CLI ─────────────────────────

export interface Args {
  specimensDir: string;
  output: string;
  providers: string[];
  documentType?: string;
  failUnder?: number;
  verbose: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    specimensDir: 'scripts/benchmark/specimens',
    output: 'scripts/benchmark/benchmark-results.json',
    providers: ['paddle', 'tesseract'],
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i], undefined];
    const next = () => inlineValue ?? argv[++i];

    switch (flag) {
      case '--specimens-dir': args.specimensDir = next(); break;
      case '--output':        args.output = next(); break;
      case '--providers':     args.providers = next().split(',').map((p) => p.trim()).filter(Boolean); break;
      case '--document-type': args.documentType = next(); break;
      // Lets CI gate a merge on accuracy instead of only on tests passing.
      case '--fail-under':    args.failUnder = Number(next()); break;
      case '--verbose': case '-v': args.verbose = true; break;
      case '--help': case '-h': printHelp(); process.exit(0);
      default:
        if (flag.startsWith('-')) {
          console.error(`Unknown flag: ${flag}\n`);
          printHelp();
          process.exit(2);
        }
    }
  }
  return args;
}

function printHelp() {
  console.log(`
OCR accuracy benchmark

  tsx scripts/benchmark/benchmark-ocr.ts [options]

  --specimens-dir <dir>   Directory of specimens + ground truth
                          (default scripts/benchmark/specimens)
  --output <file>         Where to write JSON results
                          (default scripts/benchmark/benchmark-results.json)
  --providers <list>      Comma-separated: paddle,tesseract (default both)
  --document-type <type>  Only run specimens of this document type
  --fail-under <pct>      Exit non-zero if the best provider scores under this
  --verbose, -v           Print every field mismatch
`);
}

// ───────────────────── Ground truth ─────────────────────

/**
 * An error caused by how the benchmark was invoked, not by a bug in it.
 * These print as a plain message - a stack trace for "that directory does not
 * exist" just buries the sentence the operator needs to read.
 */
class UsageError extends Error {}

export interface Specimen {
  /** Specimen file name, e.g. `ug-nid-front-01.jpg`. */
  file: string;
  documentType: string;
  issuingCountry?: string;
  /** Field -> expected value. Only listed fields are scored. */
  expected: Record<string, string>;
  /** Free-text note, e.g. "glare across the MRZ". */
  note?: string;
}

/**
 * Collect specimens from one directory, in either supported layout.
 *
 * Two conventions exist because two tools grew up around this directory:
 *
 *   flat      `<name>.<ext>` + `<name>.expected.json`
 *   country   `<COUNTRY>/front_<n>.<ext>` + `<COUNTRY>/ground_truth_<n>.json`
 *
 * The second is what src/providers/ocr/__tests__/extraction-accuracy.test.ts
 * already reads. Supporting both means one dataset feeds the accuracy tests
 * and this benchmark, instead of asking anyone to maintain two copies of the
 * same identity documents.
 */
async function collectFrom(dir: string, relativeTo: string): Promise<Specimen[]> {
  const entries = await readdir(dir);
  const specimens: Specimen[] = [];
  const rel = (f: string) => path.relative(relativeTo, path.join(dir, f));

  // Flat layout.
  for (const truthFile of entries.filter((f) => f.endsWith('.expected.json'))) {
    const stem = truthFile.replace(/\.expected\.json$/, '');
    const raw = JSON.parse(await readFile(path.join(dir, truthFile), 'utf8'));
    const documentFile = entries.find((f) => f !== truthFile && f.replace(/\.[^.]+$/, '') === stem);
    if (!documentFile) {
      console.warn(`  ! ${truthFile} has no matching document file - skipped`);
      continue;
    }
    specimens.push({
      file: rel(documentFile),
      documentType: raw.document_type ?? 'national_id',
      issuingCountry: raw.issuing_country,
      expected: raw.expected ?? {},
      note: raw.note,
    });
  }

  // Country layout, as used by the extraction-accuracy tests.
  for (const truthFile of entries.filter((f) => /^ground_truth_\d+\.json$/i.test(f))) {
    const id = truthFile.match(/(\d+)/)![1];
    const documentFile = entries.find((f) => new RegExp(`front_${id}\\.(jpe?g|png)$`, 'i').test(f));
    if (!documentFile) continue;

    const raw = JSON.parse(await readFile(path.join(dir, truthFile), 'utf8'));
    // That format keeps the fields at the top level rather than under
    // `expected`, so lift the ones that name a document field.
    const { document_type, issuing_country, note, expected, ...fields } = raw;
    specimens.push({
      file: rel(documentFile),
      documentType: document_type ?? 'drivers_license',
      issuingCountry: issuing_country,
      expected: expected ?? Object.fromEntries(
        Object.entries(fields).filter(([, v]) => typeof v === 'string' && v !== ''),
      ) as Record<string, string>,
      note,
    });
  }

  return specimens;
}

export async function loadSpecimens(dir: string, filterType?: string): Promise<Specimen[]> {
  if (!existsSync(dir)) {
    throw new UsageError(
      `Specimens directory not found: ${dir}\n` +
      `Create it and add specimen documents with ground truth - see scripts/benchmark/specimens/README.md`,
    );
  }

  const specimens = await collectFrom(dir, dir);

  // Recurse one or two levels for the country layout (US/, or US_states/CA/).
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_raw') continue;
    const sub = path.join(dir, entry.name);
    specimens.push(...await collectFrom(sub, dir));
    for (const nested of await readdir(sub, { withFileTypes: true })) {
      if (!nested.isDirectory() || nested.name === '_raw') continue;
      specimens.push(...await collectFrom(path.join(sub, nested.name), dir));
    }
  }

  return specimens
    .filter((s) => !filterType || s.documentType === filterType)
    .sort((a, b) => a.file.localeCompare(b.file));
}

// ───────────────────── Comparison ─────────────────────

/**
 * Fold away differences that are not OCR errors: case, punctuation, repeated
 * whitespace. `O'BRIEN` and `O Brien` are the same name read two ways.
 */
export function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Dates are compared as dates - `06/03/1985` and `1985-03-06` agree. */
export function normalizeDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // Day-first: the convention across the documents this system reads.
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const parsed = Date.parse(v);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

const DATE_FIELD = /(date|dob|expiry|issue)/i;

/**
 * Character-level similarity (normalised Levenshtein).
 *
 * Reported alongside exact match because the two answer different questions:
 * exact match is "would this verification pass", similarity is "how close was
 * it" - one wrong character and thirty wrong characters are different bugs.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

export interface FieldResult {
  field: string;
  expected: string;
  actual: string;
  exact: boolean;
  similarity: number;
  /** The field was expected but the provider returned nothing at all. */
  missing: boolean;
}

export function compareFields(expected: Record<string, string>, actual: OCRData): FieldResult[] {
  return Object.entries(expected).map(([field, expectedValue]) => {
    const actualRaw = (actual as Record<string, unknown>)[field];
    const missing = actualRaw === null || actualRaw === undefined || String(actualRaw).trim() === '';

    let exact: boolean;
    if (DATE_FIELD.test(field)) {
      const e = normalizeDate(String(expectedValue));
      const a = missing ? null : normalizeDate(String(actualRaw));
      exact = e !== null && a !== null && e === a;
    } else {
      exact = normalizeValue(expectedValue) === normalizeValue(actualRaw) && !missing;
    }

    return {
      field,
      expected: String(expectedValue),
      actual: missing ? '' : String(actualRaw),
      exact,
      similarity: Number(similarity(normalizeValue(expectedValue), normalizeValue(actualRaw)).toFixed(4)),
      missing,
    };
  });
}

// ───────────────────── Running ─────────────────────

export interface SpecimenRun {
  specimen: string;
  document_type: string;
  note?: string;
  duration_ms: number;
  error?: string;
  fields_total: number;
  fields_exact: number;
  accuracy: number;
  mean_similarity: number;
  mismatches: FieldResult[];
}

export interface ProviderReport {
  provider: string;
  specimens_run: number;
  specimens_errored: number;
  fields_total: number;
  fields_exact: number;
  /** Share of expected fields read exactly right. The headline number. */
  accuracy: number;
  mean_similarity: number;
  /** Share of expected fields the provider returned nothing for. */
  miss_rate: number;
  median_duration_ms: number;
  p95_duration_ms: number;
  /** Fields ranked by how often they are wrong - where to spend effort. */
  worst_fields: Array<{ field: string; accuracy: number; errors: number; of: number }>;
  runs: SpecimenRun[];
}

function makeProvider(name: string): OCRProvider {
  switch (name) {
    case 'paddle':    return new PaddleOCRProvider();
    case 'tesseract': return new TesseractProvider();
    default: throw new UsageError(`Unknown provider "${name}". Known: paddle, tesseract`);
  }
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[idx].toFixed(1));
}

export async function benchmarkProvider(
  providerName: string,
  specimens: Specimen[],
  dir: string,
  verbose: boolean,
  /** Injectable for tests; production always builds the real provider. */
  providerFactory: (name: string) => OCRProvider = makeProvider,
): Promise<ProviderReport> {
  const provider = providerFactory(providerName);
  const runs: SpecimenRun[] = [];
  const durations: number[] = [];
  const perField = new Map<string, { errors: number; of: number }>();
  let fieldsTotal = 0, fieldsExact = 0, missing = 0, similaritySum = 0, errored = 0;

  console.log(`\n▸ ${providerName}`);

  for (const specimen of specimens) {
    const buffer = await readFile(path.join(dir, specimen.file));
    const started = performance.now();

    let ocr: OCRData | null = null;
    let error: string | undefined;
    try {
      ocr = await provider.processDocument(buffer, specimen.documentType, specimen.issuingCountry);
    } catch (err) {
      // One unreadable specimen must not abort the whole run - a provider that
      // throws on a hard document is itself a result worth recording.
      error = err instanceof Error ? err.message : String(err);
      errored++;
    }
    const duration = performance.now() - started;
    durations.push(duration);

    const results = ocr ? compareFields(specimen.expected, ocr) : [];
    const exactCount = results.filter((r) => r.exact).length;
    const expectedCount = Object.keys(specimen.expected).length;

    fieldsTotal += expectedCount;
    fieldsExact += exactCount;
    missing += results.filter((r) => r.missing).length;
    similaritySum += results.reduce((sum, r) => sum + r.similarity, 0);

    for (const r of results) {
      const stat = perField.get(r.field) ?? { errors: 0, of: 0 };
      stat.of++;
      if (!r.exact) stat.errors++;
      perField.set(r.field, stat);
    }

    const mismatches = results.filter((r) => !r.exact);
    runs.push({
      specimen: specimen.file,
      document_type: specimen.documentType,
      note: specimen.note,
      duration_ms: Number(duration.toFixed(1)),
      error,
      fields_total: expectedCount,
      fields_exact: exactCount,
      accuracy: expectedCount ? Number((exactCount / expectedCount).toFixed(4)) : 0,
      mean_similarity: results.length
        ? Number((results.reduce((s, r) => s + r.similarity, 0) / results.length).toFixed(4))
        : 0,
      mismatches,
    });

    const pct = expectedCount ? Math.round((exactCount / expectedCount) * 100) : 0;
    const mark = error ? '' : pct === 100 ? '' : '·';
    console.log(
      `  ${mark} ${specimen.file.padEnd(34)} ${String(pct).padStart(3)}%  ` +
      `${exactCount}/${expectedCount} fields  ${duration.toFixed(0)}ms` +
      (error ? `  ERROR: ${error}` : ''),
    );
    if (verbose) {
      for (const m of mismatches) {
        console.log(`      ${m.field}: expected "${m.expected}" got "${m.actual || '(nothing)'}"`);
      }
    }
  }

  const sortedDurations = [...durations].sort((a, b) => a - b);
  const worstFields = [...perField.entries()]
    .map(([field, s]) => ({ field, accuracy: Number(((s.of - s.errors) / s.of).toFixed(4)), errors: s.errors, of: s.of }))
    .filter((f) => f.errors > 0)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 10);

  return {
    provider: providerName,
    specimens_run: specimens.length,
    specimens_errored: errored,
    fields_total: fieldsTotal,
    fields_exact: fieldsExact,
    accuracy: fieldsTotal ? Number((fieldsExact / fieldsTotal).toFixed(4)) : 0,
    mean_similarity: fieldsTotal ? Number((similaritySum / fieldsTotal).toFixed(4)) : 0,
    miss_rate: fieldsTotal ? Number((missing / fieldsTotal).toFixed(4)) : 0,
    median_duration_ms: percentile(sortedDurations, 50),
    p95_duration_ms: percentile(sortedDurations, 95),
    worst_fields: worstFields,
    runs,
  };
}

// ───────────────────── Reporting ─────────────────────

function printSummary(reports: ProviderReport[]) {
  console.log('\n' + '─'.repeat(72));
  console.log('SUMMARY');
  console.log('─'.repeat(72));
  console.log(
    'provider'.padEnd(14) + 'accuracy'.padStart(10) + 'similarity'.padStart(12) +
    'missed'.padStart(9) + 'errors'.padStart(9) + 'median'.padStart(10) + 'p95'.padStart(10),
  );

  const ranked = [...reports].sort((a, b) => b.accuracy - a.accuracy);
  for (const r of ranked) {
    console.log(
      r.provider.padEnd(14) +
      `${(r.accuracy * 100).toFixed(1)}%`.padStart(10) +
      `${(r.mean_similarity * 100).toFixed(1)}%`.padStart(12) +
      `${(r.miss_rate * 100).toFixed(1)}%`.padStart(9) +
      `${r.specimens_errored}/${r.specimens_run}`.padStart(9) +
      `${r.median_duration_ms}ms`.padStart(10) +
      `${r.p95_duration_ms}ms`.padStart(10),
    );
  }

  // A provider that threw on every specimen scores 0% - which reads exactly
  // like terrible OCR. It usually means a missing dependency or model, so say
  // so rather than letting someone conclude the engine is bad.
  for (const r of reports) {
    if (r.specimens_errored === r.specimens_run && r.specimens_run > 0) {
      const firstError = r.runs.find((run) => run.error)?.error;
      console.log(
        `\n! ${r.provider} failed on every specimen - its 0% is not an accuracy result.` +
        (firstError ? `\n  First error: ${firstError}` : ''),
      );
    }
  }

  const best = ranked[0];
  if (best?.worst_fields.length) {
    console.log(`\nWeakest fields for ${best.provider}:`);
    for (const f of best.worst_fields) {
      console.log(`  ${f.field.padEnd(24)} ${(f.accuracy * 100).toFixed(0)}%  (${f.errors} wrong of ${f.of})`);
    }
  }
}

// ───────────────────── Entrypoint ─────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(process.cwd(), args.specimensDir);

  console.log(`OCR benchmark`);
  console.log(`  specimens: ${dir}`);
  console.log(`  providers: ${args.providers.join(', ')}`);

  const specimens = await loadSpecimens(dir, args.documentType);
  if (specimens.length === 0) {
    // Distinguish "you have no specimens" from "your filter matched none of
    // them" - the fix is completely different.
    if (args.documentType) {
      const all = await loadSpecimens(dir);
      throw new UsageError(
        `No specimens of type "${args.documentType}" in ${dir}.\n` +
        (all.length
          ? `Types present: ${[...new Set(all.map((s) => s.documentType))].join(', ')}`
          : 'That directory contains no specimens with ground truth at all.'),
      );
    }
    throw new UsageError(
      `No specimens with ground truth found in ${dir}.\n` +
      `Each specimen needs <name>.<ext> plus <name>.expected.json - see the README there.`,
    );
  }
  console.log(`  specimens found: ${specimens.length}`);

  const reports: ProviderReport[] = [];
  for (const name of args.providers) {
    try {
      reports.push(await benchmarkProvider(name, specimens, dir, args.verbose));
    } catch (err) {
      // A provider that cannot start at all shouldn't take the others' results
      // with it - you still want the comparison you can get.
      console.error(`\n! provider "${name}" failed to run: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (reports.length === 0) {
    console.error('\nNo provider produced results.');
    process.exit(1);
  }

  printSummary(reports);

  const anyProviderRan = reports.some((r) => r.specimens_errored < r.specimens_run);

  const outputPath = path.resolve(process.cwd(), args.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        specimens_dir: args.specimensDir,
        specimen_count: specimens.length,
        providers: reports,
      },
      null,
      2,
    ),
  );
  console.log(`\nResults written to ${args.output}`);

  if (!anyProviderRan) {
    console.error('\nNo provider processed a single specimen - nothing was measured.');
    process.exit(1);
  }

  if (args.failUnder !== undefined) {
    const best = Math.max(...reports.map((r) => r.accuracy)) * 100;
    if (best < args.failUnder) {
      console.error(`\nFAIL: best accuracy ${best.toFixed(1)}% is under the --fail-under threshold of ${args.failUnder}%`);
      process.exit(1);
    }
    console.log(`PASS: best accuracy ${best.toFixed(1)}% meets the ${args.failUnder}% threshold`);
  }
}

// Only run when invoked directly, so the scoring logic above can be imported
// and tested without kicking off a benchmark.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    if (err instanceof UsageError) {
      console.error(`\n${err.message}`);
    } else {
      console.error(`\nBenchmark failed: ${err instanceof Error ? err.stack : err}`);
    }
    process.exit(1);
  });
}
