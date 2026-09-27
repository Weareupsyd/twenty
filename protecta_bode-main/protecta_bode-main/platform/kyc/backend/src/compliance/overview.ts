import { optionalQuery } from './query.js';
import { getDataFreshness } from '../aml/audit.js';
import { coverageAttestation } from '../aml/coverage.js';
import { listSubjects } from './subjects.js';

function startOfTodayEat(): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = fmt.format(new Date()); // YYYY-MM-DD
  return new Date(`${day}T00:00:00+03:00`);
}

export async function getOverview(): Promise<Record<string, unknown>> {
  const since = startOfTodayEat();
  const [subjects, freshness, coverage, cases, screenToday] = await Promise.all([
    listSubjects({ limit: 200 }),
    getDataFreshness().catch(() => ({ dataset_version: null, last_successful_sync: null })),
    coverageAttestation().catch(() => null),
    optionalQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM aml.cases WHERE status IS NULL OR status NOT IN ('closed', 'resolved')`),
    optionalQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM aml.screening_requests WHERE created_at >= $1`, [since]),
  ]);

  const today = subjects.items.filter((s) => s.submitted_at && new Date(s.submitted_at) >= since);
  const pool = today.length ? today : subjects.items;
  const submitted = pool.length;
  const autoCleared = pool.filter((s) => s.decision === 'approved' && s.screening === 'clear').length;
  const inReview = pool.filter((s) => s.decision === 'in review').length;
  const hits = pool.filter((s) => ['sanctions', 'PEP match', 'hit', 'review'].includes(s.screening)).length;
  const rejected = pool.filter((s) => s.decision === 'rejected').length;

  const funnelStages = [
    { stage: 'Session started', handler: 'verify', count: submitted },
    { stage: 'Document captured', handler: 'verify', count: pool.filter((s) => s.verification !== 'pending' || s.kind === 'business').length },
    { stage: 'Liveness passed', handler: 'verify', count: pool.filter((s) => s.verification === 'passed' || s.kind === 'business').length },
    { stage: 'Cross-validated', handler: 'verify', count: pool.filter((s) => s.verification === 'passed').length },
    { stage: 'Screened', handler: 'screen', count: pool.filter((s) => s.screening !== 'not run').length },
    { stage: 'Cleared', handler: 'screen', count: pool.filter((s) => s.screening === 'clear').length },
    { stage: 'Escalated', handler: 'screen', count: pool.filter((s) => s.decision === 'escalated' || s.screening === 'sanctions').length },
  ].map((row, i, arr) => ({
    ...row,
    share: submitted ? Math.round((row.count / submitted) * 100) : 0,
    drop_off: i === 0 ? 0 : Math.max(0, arr[i - 1].count - row.count),
  }));

  const attention = {
    sanctions: pool.filter((s) => s.screening === 'sanctions').length,
    pep: pool.filter((s) => s.screening === 'PEP match').length,
    doc_mismatch: pool.filter((s) => s.verification === 'failed' || s.verification === 'review').length,
    open_cases: Number(cases[0]?.n || 0),
  };

  return {
    generated_at: new Date().toISOString(),
    timezone: 'Africa/Nairobi',
    today: {
      submitted,
      auto_cleared: autoCleared,
      auto_cleared_pct: submitted ? Math.round((autoCleared / submitted) * 100) : 0,
      in_review: inReview,
      screening_hits: hits,
      rejected,
      rejected_pct: submitted ? Math.round((rejected / submitted) * 100) : 0,
      screens_run: Number(screenToday[0]?.n || pool.filter((s) => s.screening !== 'not run').length),
    },
    funnel: funnelStages,
    attention,
    freshness,
    coverage,
    recent: subjects.items.slice(0, 8),
    totals: { subjects: subjects.total },
  };
}
