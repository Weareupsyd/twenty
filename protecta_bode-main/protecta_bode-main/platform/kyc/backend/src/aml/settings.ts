import { amlQuery } from './db.js';

export const KEY_THRESHOLDS = 'screening.thresholds';
export const KEY_CORRIDORS = 'corridors.overrides';

export function defaultSettings(): Record<string, Record<string, unknown>> {
  return {
    [KEY_THRESHOLDS]: { global_threshold: 0.82 },
    [KEY_CORRIDORS]: { overrides: [] },
  };
}

export async function loadSettings(): Promise<Record<string, Record<string, unknown>>> {
  const merged = defaultSettings();
  try {
    const { rows } = await amlQuery<{ key: string; value: Record<string, unknown> }>(
      'SELECT key, value FROM aml.system_settings',
    );
    for (const row of rows) {
      if (row.value && typeof row.value === 'object') {
        merged[row.key] = { ...(merged[row.key] || {}), ...row.value };
      }
    }
  } catch {
    // table may not exist yet
  }
  return merged;
}

export async function saveSettings(input: {
  global_threshold?: number;
  overrides?: Array<{ country?: string; threshold?: number }>;
}): Promise<Record<string, Record<string, unknown>>> {
  const current = await loadSettings();
  const thresholds = { ...(current[KEY_THRESHOLDS] || {}) };
  if (input.global_threshold !== undefined) {
    const t = Number(input.global_threshold);
    if (!Number.isFinite(t) || t < 0.5 || t > 1) {
      const err = new Error('global_threshold must be between 0.5 and 1') as Error & { status?: number };
      err.status = 422;
      throw err;
    }
    thresholds.global_threshold = t;
  }
  const corridors = { ...(current[KEY_CORRIDORS] || {}) };
  if (input.overrides) {
    corridors.overrides = input.overrides
      .filter((o) => o.country && Number.isFinite(Number(o.threshold)))
      .map((o) => ({ country: String(o.country).toUpperCase(), threshold: Number(o.threshold) }));
  }
  await upsertSetting(KEY_THRESHOLDS, thresholds);
  await upsertSetting(KEY_CORRIDORS, corridors);
  return loadSettings();
}

async function upsertSetting(key: string, value: Record<string, unknown>): Promise<void> {
  await amlQuery(
    `INSERT INTO aml.system_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}

export function effectiveThreshold(
  settings: Record<string, Record<string, unknown>>,
  country?: string | null,
  globalDefault = 0.82,
): number {
  const thresholds = settings[KEY_THRESHOLDS] || {};
  let global = Number(thresholds.global_threshold ?? globalDefault);
  if (!Number.isFinite(global)) global = globalDefault;
  if (!country) return global;
  const corridors = settings[KEY_CORRIDORS]?.overrides;
  if (Array.isArray(corridors)) {
    const code = String(country).trim().toUpperCase();
    for (const c of corridors) {
      if (c && typeof c === 'object' && String((c as { country?: string }).country || '').toUpperCase() === code) {
        const t = Number((c as { threshold?: number }).threshold);
        if (Number.isFinite(t)) return t;
      }
    }
  }
  return global;
}
