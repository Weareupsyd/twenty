import type { UnifiedScreeningResult } from '@kabila/shared';
import { getScreen, runScreen } from '@/aml/screen.js';
import { generateReference, getDataFreshness, logScreening } from '@/aml/audit.js';
import { optionalQuery } from '@/compliance/query.js';
import { createAMLProviders } from '@/providers/aml/index.js';
import { screenAll } from '@/providers/aml/multiScreen.js';
import type { AMLMatch, AMLRiskLevel, AMLScreeningResult } from '@/providers/aml/types.js';
import { linkSubject } from '@/compliance/dualWrite.js';
import { logger } from '@/utils/logger.js';

export interface UnifiedScreeningInput {
  verificationId?: string | null;
  userId?: string | null;
  name: string;
  dateOfBirth?: string | null;
  nationality?: string | null;
  country?: string | null;
  idNumber?: string | null;
  gender?: string | null;
  address?: string | null;
  requestedBy?: string | null;
}

export type UnifiedAMLResult = AMLScreeningResult & {
  unified_screening: UnifiedScreeningResult;
};

type FullMatch = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value) return [value];
  return [];
}

function matchCategories(match: FullMatch): string[] {
  return strings(match.risk_categories ?? match.topics).map((item) => item.toLowerCase());
}

function matchDatasets(match: FullMatch): string[] {
  const values = strings(match.datasets ?? match.dataset);
  return values.length ? values : ['OpenSanctions'];
}

function matchCaption(match: FullMatch): string {
  return String(match.caption || match.name || match.entity_id || match.id || 'Unknown match');
}

function fullRiskToAML(summary: Record<string, unknown>, matches: FullMatch[]): AMLRiskLevel {
  const sanctions = Number(summary.sanctions_matches || 0);
  const level = String(summary.risk_level || '').toLowerCase();
  const matchFound = Boolean(summary.match_found) || matches.length > 0;

  if (sanctions > 0 && (level === 'high' || level === 'critical')) return 'confirmed_match';
  if (matchFound) return 'potential_match';
  return 'clear';
}

/** Convert the full Yente result into the compact Gate-6 result. */
export function compactAMLResult(
  full: UnifiedScreeningResult,
  input: Pick<UnifiedScreeningInput, 'name' | 'dateOfBirth'>,
): AMLScreeningResult {
  const summary = record(full.summary);
  const matches = full.matches || [];
  const compactMatches: AMLMatch[] = matches.map((match) => {
    const categories = matchCategories(match);
    const matchType: AMLMatch['match_type'] = categories.some((category) => category.includes('pep'))
      ? 'pep'
      : input.dateOfBirth
        ? 'name_dob'
        : 'name';
    return {
      listed_name: matchCaption(match),
      list_source: matchDatasets(match)[0],
      score: Number(match.score || 0),
      match_type: matchType,
    };
  });

  const lists = new Set<string>();
  for (const match of matches) {
    for (const dataset of matchDatasets(match)) lists.add(dataset);
  }

  return {
    risk_level: fullRiskToAML(summary, matches),
    match_found: Boolean(summary.match_found) || compactMatches.length > 0,
    matches: compactMatches,
    lists_checked: [...lists],
    screened_name: input.name,
    screened_dob: input.dateOfBirth ?? null,
    screened_at: full.timestamp,
  };
}

function fallbackMatch(match: AMLMatch, index: number): FullMatch {
  const category = match.match_type === 'pep' ? 'pep' : 'sanction';
  return {
    entity_id: `fallback-${index + 1}`,
    entity_type: 'Person',
    caption: match.listed_name,
    score: match.score,
    risk_categories: [category],
    topics: [category],
    datasets: [match.list_source],
    countries: [],
    addresses: [],
    source_links: [],
    sanctions: [],
    relationships: [],
    match_explanation: match.match_type,
  };
}

async function runProviderFallback(
  input: UnifiedScreeningInput,
  originalError: unknown,
): Promise<UnifiedScreeningResult> {
  const providers = createAMLProviders();
  if (providers.length === 0) throw originalError;

  const started = Date.now();
  const fallback = await screenAll(providers, {
    full_name: input.name,
    date_of_birth: input.dateOfBirth ?? null,
    nationality: input.nationality ?? null,
  });
  const reference = generateReference('SCR');
  const matches = fallback.matches.map(fallbackMatch);
  const sanctionsMatches = matches.filter((match) => matchCategories(match).includes('sanction')).length;
  const pepMatches = matches.filter((match) => matchCategories(match).includes('pep')).length;
  const riskLevel = fallback.risk_level === 'confirmed_match'
    ? 'High'
    : fallback.risk_level === 'potential_match'
      ? 'Medium'
      : 'Clear';
  const maxScore = fallback.matches.reduce((max, match) => Math.max(max, match.score), 0);
  const timestamp = fallback.screened_at || new Date().toISOString();

  await logScreening({
    reference,
    requestType: 'person',
    inputName: input.name,
    inputPayload: {
      entity_type: 'person',
      name: input.name,
      date_of_birth: input.dateOfBirth ?? null,
      nationality: input.nationality ?? null,
      country: input.country ?? null,
      id_number: input.idNumber ?? null,
      source: 'verification-auto-fallback',
    },
    yenteResult: { matches, relationships: [] },
    riskLevel,
    matchClassification: {
      sanctions: sanctionsMatches > 0,
      pep_related: pepMatches > 0,
    },
    matchFound: fallback.match_found,
    maxScore,
    processingMs: Date.now() - started,
    requestedBy: input.requestedBy || 'verification-pipeline',
  });

  return {
    reference,
    status: 'completed',
    query: {
      entity_type: 'person',
      name: input.name,
      country: input.country ?? null,
      date_of_birth: input.dateOfBirth ?? null,
      nationality: input.nationality ?? null,
      id_number: input.idNumber ?? null,
    },
    summary: {
      risk_level: riskLevel,
      match_found: fallback.match_found,
      requires_human_review: fallback.match_found,
      total_matches: matches.length,
      sanctions_matches: sanctionsMatches,
      pep_related_matches: pepMatches,
    },
    matches,
    relationships: [],
    data_freshness: await getDataFreshness(),
    analyst_note: 'Fallback provider result. Identity findings require analyst verification.',
    timestamp,
  };
}

/**
 * Run one full sanctions/PEP screen and link it to the exact verification.
 *
 * Yente is the primary source because it returns enriched entities,
 * relationships, sanctions programs and source links. Configured KYC providers
 * are only a fallback. Both paths return the same result shape and create one
 * aml.screening_requests record.
 */
export async function runUnifiedScreening(input: UnifiedScreeningInput): Promise<UnifiedAMLResult> {
  const cleanName = input.name.trim();
  if (cleanName.length < 2) throw new Error('A valid name is required for screening');

  // A network retry after Yente logged the result but before session state was
  // saved must reuse the linked screen rather than create a second record.
  if (input.verificationId) {
    const existing = await findUnifiedScreening(input.verificationId);
    if (existing) {
      const compact = compactAMLResult(existing, { name: cleanName, dateOfBirth: input.dateOfBirth });
      return { ...compact, unified_screening: existing };
    }
  }

  let full: UnifiedScreeningResult;
  try {
    full = await runScreen({
      entity_type: 'person',
      name: cleanName,
      country: input.country || input.nationality || null,
      date_of_birth: input.dateOfBirth ?? null,
      nationality: input.nationality ?? null,
      gender: input.gender ?? null,
      id_number: input.idNumber ?? null,
      address: input.address ?? null,
      aliases: [],
      threshold: 0.82,
      include_relationships: true,
      include_source_documents: true,
      requested_by: input.requestedBy || 'verification-pipeline',
    }) as unknown as UnifiedScreeningResult;
  } catch (error) {
    logger.warn('Full Yente screening failed; trying configured AML providers', {
      verificationId: input.verificationId || undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    full = await runProviderFallback({ ...input, name: cleanName }, error);
  }

  if (input.verificationId) {
    await linkSubject({
      verificationId: input.verificationId,
      kycUserId: input.userId,
      screeningRef: full.reference,
      fullName: cleanName,
      dateOfBirth: input.dateOfBirth ?? null,
      country: input.country || input.nationality || null,
    });
  }

  const compact = compactAMLResult(full, { name: cleanName, dateOfBirth: input.dateOfBirth });
  return { ...compact, unified_screening: full };
}

/** Load the newest full (non-legacy-mirror) screen linked to a verification. */
export async function findUnifiedScreening(
  verificationId: string,
): Promise<UnifiedScreeningResult | null> {
  try {
    const links = await optionalQuery<{ screening_ref: string }>(
      `SELECT screening_ref
         FROM compliance.subject_links
        WHERE verification_id = $1
          AND screening_ref IS NOT NULL
        ORDER BY created_at DESC`,
      [verificationId],
    );
    const reference = links.find((link) => !/^SCR-(?:KAB|KYB)-/i.test(link.screening_ref))?.screening_ref;
    if (!reference) return null;
    return getScreen(reference) as Promise<UnifiedScreeningResult | null>;
  } catch (error) {
    // Cloud/Supabase-only installations do not expose the raw Postgres pool
    // used by the combined console. Status reads must remain available there.
    logger.debug('Unified screening lookup unavailable', {
      verificationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
