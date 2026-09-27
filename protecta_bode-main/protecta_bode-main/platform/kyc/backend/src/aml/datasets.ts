import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { amlQuery } from './db.js';
import { amlConfig } from './config.js';
import { getYenteDatasetStats, pingYenteUpdate } from './yente.js';

const ENTITIES_URL =
  process.env.OPENSANCTIONS_ENTITIES_URL
  || 'https://data.opensanctions.org/datasets/latest/default/entities.ftm.json';

/** OpenSanctions default-collection export catalogue (mirrors the retired
 *  Python `DATASET_FILES`). Sizes are approximate published plain sizes. */
export const DATASET_FILES = [
  { file_name: 'entities.ftm.json', label: 'FollowTheMoney entities', required_for_yente: true, approx_size_gb: 2.41 },
  { file_name: 'names.txt', label: 'Target names text file', required_for_yente: false, approx_size_gb: 0.1 },
  { file_name: 'senzing.json', label: 'Senzing entity format', required_for_yente: false, approx_size_gb: 1.36 },
  { file_name: 'statements.csv', label: 'Statement-based granular CSV', required_for_yente: false, approx_size_gb: 8.83 },
  { file_name: 'targets.nested.json', label: 'Targets as nested JSON', required_for_yente: false, approx_size_gb: 3.63 },
  { file_name: 'targets.simple.csv', label: 'Targets as simplified CSV', required_for_yente: false, approx_size_gb: 0.44 },
] as const;

export const DATASET_FILES_BY_NAME: Record<string, (typeof DATASET_FILES)[number]> = Object.fromEntries(
  DATASET_FILES.map((entry) => [entry.file_name, entry]),
);

type SyncStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'stale';

type ProgressFile = {
  status: SyncStatus;
  current_file: string | null;
  files_done: number;
  files_total: number | null;
  message: string | null;
  started_at: string | null;
  updated_at: string;
};

const SYNC_STALE_AFTER_MS = 15 * 60_000;
const MANIFEST_TTL_MS = 10 * 60_000;

type PublishedStats = { version: string | null; entity_count: number | null };
let publishedStatsCache: { at: number; stats: PublishedStats } | null = null;

function baseUrl(): string {
  const idx = ENTITIES_URL.lastIndexOf('/');
  return ENTITIES_URL.slice(0, idx + 1);
}

function manifestUrl(): string {
  return process.env.OPENSANCTIONS_MANIFEST_URL || `${baseUrl()}index.json`;
}

function extractVersion(manifest: Record<string, unknown>): string {
  for (const key of ['version', 'dataset_version', 'revision'] as const) {
    const value = manifest[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 64);
  }
  for (const key of ['updated_at', 'last_change'] as const) {
    const value = manifest[key];
    if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function extractEntityCount(manifest: Record<string, unknown>): number | null {
  if (typeof manifest.entity_count === 'number' && Number.isFinite(manifest.entity_count)) {
    return manifest.entity_count;
  }
  const stats = manifest.statistics && typeof manifest.statistics === 'object'
    ? manifest.statistics as Record<string, unknown>
    : null;
  if (stats && typeof stats.entity_count === 'number' && Number.isFinite(stats.entity_count)) {
    return stats.entity_count;
  }
  if (typeof manifest.target_count === 'number' && Number.isFinite(manifest.target_count)) {
    return manifest.target_count;
  }
  return null;
}

function localManifestPath(): string {
  return path.join(amlConfig.dataDir, 'current', 'manifest.json');
}

async function writeLocalManifest(stats: PublishedStats): Promise<void> {
  try {
    await mkdir(path.join(amlConfig.dataDir, 'current'), { recursive: true });
    await writeFile(localManifestPath(), JSON.stringify({
      version: stats.version,
      entity_count: stats.entity_count,
      updated_at: new Date().toISOString(),
    }), 'utf8');
  } catch {
    // cache file is best-effort
  }
}

async function readLocalManifest(): Promise<PublishedStats> {
  try {
    const parsed = JSON.parse(await readFile(localManifestPath(), 'utf8')) as Record<string, unknown>;
    const version = typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null;
    const entity_count = typeof parsed.entity_count === 'number' && Number.isFinite(parsed.entity_count)
      ? parsed.entity_count
      : null;
    return { version, entity_count };
  } catch {
    return { version: null, entity_count: null };
  }
}

async function fetchRemoteManifest(): Promise<PublishedStats> {
  const fallback: PublishedStats = { version: new Date().toISOString().slice(0, 10), entity_count: null };
  try {
    const resp = await fetch(manifestUrl(), { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok || typeof resp.json !== 'function') return fallback;
    const manifest = await resp.json() as Record<string, unknown>;
    const stats = { version: extractVersion(manifest), entity_count: extractEntityCount(manifest) };
    publishedStatsCache = { at: Date.now(), stats };
    await writeLocalManifest(stats);
    return stats;
  } catch {
    return fallback;
  }
}

/** Version + entity count from local cache, yente, or the published OpenSanctions index. */
async function resolvePublishedStats(): Promise<PublishedStats> {
  if (publishedStatsCache && Date.now() - publishedStatsCache.at < MANIFEST_TTL_MS) {
    return publishedStatsCache.stats;
  }
  const local = await readLocalManifest();
  if (local.version && local.entity_count) {
    publishedStatsCache = { at: Date.now(), stats: local };
    return local;
  }
  const yente = await getYenteDatasetStats();
  if (yente.version || yente.entity_count) {
    const stats = {
      version: yente.version || local.version,
      entity_count: yente.entity_count ?? local.entity_count,
    };
    publishedStatsCache = { at: Date.now(), stats };
    return stats;
  }
  const remote = await fetchRemoteManifest();
  return {
    version: remote.version || local.version,
    entity_count: remote.entity_count ?? local.entity_count,
  };
}

function applyPublishedStats<T extends { dataset_version?: string | null; entity_count?: number | null }>(
  row: T,
  stats: PublishedStats,
): T {
  if (!row.dataset_version && stats.version) row.dataset_version = stats.version;
  if (!row.entity_count && stats.entity_count) row.entity_count = stats.entity_count;
  return row;
}

function remoteUrl(fileName: string): string {
  return `${baseUrl()}${fileName}`;
}

function progressPath(): string {
  return path.join(amlConfig.dataDir, 'sync_progress.json');
}

async function writeProgress(patch: Partial<ProgressFile>): Promise<void> {
  try {
    await mkdir(amlConfig.dataDir, { recursive: true });
    const current = await readProgressRaw();
    const next: ProgressFile = {
      status: current.status,
      current_file: current.current_file,
      files_done: current.files_done,
      files_total: current.files_total,
      message: current.message,
      started_at: current.started_at,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    await writeFile(progressPath(), JSON.stringify(next), 'utf8');
  } catch {
    // progress reporting must never break a sync
  }
}

async function readProgressRaw(): Promise<ProgressFile> {
  try {
    const parsed = JSON.parse(await readFile(progressPath(), 'utf8')) as Partial<ProgressFile>;
    return {
      status: parsed.status ?? 'idle',
      current_file: parsed.current_file ?? null,
      files_done: parsed.files_done ?? 0,
      files_total: parsed.files_total ?? null,
      message: parsed.message ?? null,
      started_at: parsed.started_at ?? null,
      updated_at: parsed.updated_at ?? new Date(0).toISOString(),
    };
  } catch {
    return {
      status: 'idle',
      current_file: null,
      files_done: 0,
      files_total: null,
      message: null,
      started_at: null,
      updated_at: new Date(0).toISOString(),
    };
  }
}

export async function syncProgress(): Promise<Record<string, unknown>> {
  const current = await readProgressRaw();
  if (current.status === 'running' && current.updated_at) {
    const updated = Date.parse(current.updated_at);
    if (Number.isNaN(updated) || Date.now() - updated > SYNC_STALE_AFTER_MS) {
      current.status = 'stale';
    }
  }
  return { ...current, running: current.status === 'running' };
}

async function latestSnapshotDir(): Promise<string | null> {
  const snapshots = path.join(amlConfig.dataDir, 'snapshots');
  try {
    const entries = await readdir(snapshots, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
    return dirs[0] ? path.join(snapshots, dirs[0]) : null;
  } catch {
    return null;
  }
}

async function storedFileInfo(fileName: string): Promise<{ stored: boolean; path: string | null; size: number | null; compressed: boolean }> {
  const candidates = [fileName, `${fileName}.gz`];
  const dirs = [path.join(amlConfig.dataDir, 'current')];
  const snap = await latestSnapshotDir();
  if (snap) dirs.push(snap);
  for (const dir of dirs) {
    for (const name of candidates) {
      const candidate = path.join(dir, name);
      try {
        const info = await stat(candidate);
        if (info.isFile()) return { stored: true, path: candidate, size: info.size, compressed: candidate.endsWith('.gz') };
      } catch {
        // keep looking
      }
    }
  }
  return { stored: false, path: null, size: null, compressed: false };
}

export async function listDatasets(): Promise<Array<Record<string, unknown>>> {
  const stats = await resolvePublishedStats();
  const placeholder = applyPublishedStats({
    dataset_name: 'opensanctions_default',
    dataset_version: null as string | null,
    entity_count: 0,
    last_sync_status: 'never_synced',
    last_sync_at: null as Date | string | null,
    stale: true,
  }, stats);
  try {
    const { rows } = await amlQuery<{
      dataset_name: string;
      dataset_version: string | null;
      entity_count: number;
      status: string;
      completed_at: Date | null;
    }>(
      `SELECT dataset_name, dataset_version, entity_count, status, completed_at
       FROM aml.dataset_syncs
       WHERE dataset_name NOT LIKE 'opensanctions_default/%'
       ORDER BY started_at DESC LIMIT 10`,
    );
    const seen = new Set<string>();
    const out: Array<Record<string, unknown>> = [];
    const now = Date.now();
    for (const row of rows) {
      if (seen.has(row.dataset_name)) continue;
      seen.add(row.dataset_name);
      let stale = true;
      if (row.completed_at) {
        stale = now - new Date(row.completed_at).getTime() > amlConfig.staleHours * 3600_000;
      }
      out.push(applyPublishedStats({
        dataset_name: row.dataset_name,
        dataset_version: row.dataset_version,
        entity_count: row.entity_count,
        last_sync_status: row.status,
        last_sync_at: row.completed_at,
        stale,
      }, stats));
    }
    if (!out.length) out.push(placeholder);
    return out;
  } catch {
    return [placeholder];
  }
}

/** Per-file download status for every OpenSanctions export in the catalogue. */
export async function listDatasetFiles(): Promise<Array<Record<string, unknown>>> {
  let rows: Array<{
    dataset_name: string;
    dataset_version: string | null;
    status: string;
    source_url: string | null;
    checksum_sha256: string | null;
    entity_count: number;
    completed_at: Date | null;
  }> = [];
  try {
    const result = await amlQuery<typeof rows[number]>(
      `SELECT dataset_name, dataset_version, status, source_url, checksum_sha256,
              entity_count, completed_at
       FROM aml.dataset_syncs
       WHERE dataset_name LIKE 'opensanctions_default/%'
          OR dataset_name = 'opensanctions_default'
       ORDER BY started_at DESC`,
    );
    rows = result.rows;
  } catch {
    rows = [];
  }

  const latestByFile = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const fileName = row.dataset_name === 'opensanctions_default'
      ? 'entities.ftm.json'
      : row.dataset_name.slice('opensanctions_default/'.length);
    if (!latestByFile.has(fileName)) latestByFile.set(fileName, row);
  }

  const stats = await resolvePublishedStats();
  const out: Array<Record<string, unknown>> = [];
  for (const entry of DATASET_FILES) {
    const row = latestByFile.get(entry.file_name);
    const stored = await storedFileInfo(entry.file_name);
    out.push({
      file_name: entry.file_name,
      label: entry.label,
      required_for_yente: entry.required_for_yente,
      approx_size_gb: entry.approx_size_gb,
      remote_url: remoteUrl(entry.file_name),
      stored: stored.stored,
      compressed: stored.compressed,
      size_bytes: stored.size,
      status: row?.status ?? 'never',
      dataset_version: row?.dataset_version || stats.version,
      checksum_sha256: row?.checksum_sha256 ?? null,
      last_sync_at: row?.completed_at ?? null,
    });
  }
  return out;
}

async function recordSync(args: {
  datasetName: string;
  status: string;
  sourceUrl: string;
  message: string;
  datasetVersion?: string | null;
  entityCount?: number | null;
}): Promise<number> {
  const version = args.datasetVersion || new Date().toISOString().slice(0, 10);
  const count = args.entityCount ?? 0;
  try {
    const { rows } = await amlQuery<{ id: number }>(
      `INSERT INTO aml.dataset_syncs
         (dataset_name, dataset_version, status, entity_count, source_url, started_at, completed_at, error_message)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6)
       ON CONFLICT (dataset_name, dataset_version) DO UPDATE SET
         status = EXCLUDED.status,
         entity_count = EXCLUDED.entity_count,
         source_url = EXCLUDED.source_url,
         error_message = EXCLUDED.error_message,
         started_at = NOW(),
         completed_at = NOW()
       RETURNING id`,
      [args.datasetName, version, args.status, count, args.sourceUrl, args.status === 'succeeded' ? null : args.message],
    );
    return rows[0]?.id || 0;
  } catch {
    return 0;
  }
}

/** Stream a remote URL to `dest`. Never throws; reports ok/detail. */
async function downloadTo(url: string, dest: string, timeoutMs = 30 * 60_000): Promise<{ ok: boolean; detail: string }> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok || !resp.body) {
      return { ok: false, detail: `download HTTP ${resp.status}` };
    }
    const file = createWriteStream(dest);
    await pipeline(Readable.fromWeb(resp.body as import('node:stream/web').ReadableStream), file);
    return { ok: true, detail: '' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** gzip `source` in place: source -> source.gz, removing the original. */
async function gzipFile(source: string): Promise<void> {
  await pipeline(createReadStream(source), createGzip({ level: 6 }), createWriteStream(`${source}.gz`));
  await unlink(source).catch(() => undefined);
}

/** Decompress a .gz file into `dest` (plain). */
async function gunzipFile(source: string, dest: string): Promise<void> {
  await pipeline(createReadStream(source), createGunzip(), createWriteStream(dest));
}

/** Stream entities.ftm.json into the yente data volume, then atomically swap.
 *  Prefers the published `.gz` variant and decompresses it, because yente
 *  reads the plain file directly from current/. */
export async function downloadEntitiesFile(): Promise<{ ok: boolean; bytes: number; detail: string }> {
  const dir = path.join(amlConfig.dataDir, 'current');
  const dest = path.join(dir, 'entities.ftm.json');
  const part = `${dest}.part`;
  const gzPart = `${part}.gz`;
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    return { ok: false, bytes: 0, detail: `cannot create ${dir}: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Prefer the gzip variant, then decompress so yente reads plain JSON.
  const gz = await downloadTo(`${ENTITIES_URL}.gz`, gzPart);
  if (gz.ok) {
    try {
      await gunzipFile(gzPart, part);
      await rename(part, dest);
      await unlink(gzPart).catch(() => undefined);
      const info = await stat(dest);
      return { ok: true, bytes: info.size, detail: dest };
    } catch (err) {
      try { await unlink(gzPart); } catch { /* ignore */ }
      try { await unlink(part); } catch { /* ignore */ }
      return { ok: false, bytes: 0, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  // Fall back to the plain export.
  const plain = await downloadTo(ENTITIES_URL, part);
  if (!plain.ok) {
    try { await unlink(gzPart); } catch { /* ignore */ }
    try { await unlink(part); } catch { /* ignore */ }
    return { ok: false, bytes: 0, detail: plain.detail };
  }
  try {
    await rename(part, dest);
    const info = await stat(dest);
    return { ok: true, bytes: info.size, detail: dest };
  } catch (err) {
    try { await unlink(part); } catch { /* ignore */ }
    return { ok: false, bytes: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Download one catalogue file. Non-entities files are stored gzip-compressed
 *  to save disk (the old behaviour); entities.ftm.json stays plain for yente. */
export async function downloadDatasetFile(fileName: string): Promise<{ ok: boolean; bytes: number; detail: string }> {
  if (!DATASET_FILES_BY_NAME[fileName]) {
    return { ok: false, bytes: 0, detail: `Unknown dataset file: ${fileName}` };
  }
  if (fileName === 'entities.ftm.json') return downloadEntitiesFile();

  const dir = path.join(amlConfig.dataDir, 'current');
  const dest = path.join(dir, fileName);
  const gzDest = `${dest}.gz`;
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    return { ok: false, bytes: 0, detail: `cannot create ${dir}: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 1. Prefer the published .gz variant - no local compression needed.
  const gz = await downloadTo(`${remoteUrl(fileName)}.gz`, gzDest);
  if (gz.ok) {
    const info = await stat(gzDest).catch(() => null);
    return { ok: true, bytes: info?.size ?? 0, detail: gzDest };
  }

  // 2. Fall back to the plain export, then compress in place to save space.
  const plain = await downloadTo(remoteUrl(fileName), dest);
  if (!plain.ok) {
    try { await unlink(gzDest); } catch { /* ignore */ }
    return { ok: false, bytes: 0, detail: plain.detail };
  }
  try {
    await gzipFile(dest);
    const info = await stat(gzDest).catch(() => null);
    return { ok: true, bytes: info?.size ?? 0, detail: gzDest };
  } catch (err) {
    try { await unlink(dest); } catch { /* ignore */ }
    try { await unlink(gzDest); } catch { /* ignore */ }
    return { ok: false, bytes: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Phase 5: download the yente input file (kyc-api has egress) then /updatez. */
export async function triggerReindex(): Promise<{ sync_id: number; status: string; message: string; bytes?: number }> {
  await writeProgress({
    status: 'running',
    current_file: 'entities.ftm.json',
    files_done: 0,
    files_total: 1,
    message: 'downloading entities.ftm.json',
    started_at: new Date().toISOString(),
  });

  const download = await downloadEntitiesFile();

  // Never ask yente to reindex when the atomic replacement did not complete.
  // Reindexing after a permission/network failure silently keeps indexing the
  // stale file (or the zero-byte first-run placeholder) while reporting that
  // the update was triggered.
  const ping = download.ok
    ? await pingYenteUpdate()
    : { ok: false, detail: 'skipped because dataset download failed' };
  const status = download.ok && ping.ok ? 'succeeded' : 'failed';
  const message = [
    download.ok
      ? `downloaded entities.ftm.json (${download.bytes} bytes)`
      : `file download failed: ${download.detail}`,
    ping.ok
      ? 'yente reindex triggered'
      : download.ok
        ? `yente reindex failed: ${ping.detail}`
        : `yente reindex ${ping.detail}`,
  ].join('; ');
  const stats = await resolvePublishedStats();
  const syncId = await recordSync({
    datasetName: 'opensanctions_default',
    status,
    sourceUrl: ENTITIES_URL,
    message,
    datasetVersion: stats.version,
    entityCount: stats.entity_count,
  });
  await writeProgress({
    status: status === 'succeeded' ? 'succeeded' : 'failed',
    files_done: 1,
    message,
  });
  return { sync_id: syncId, status, message, bytes: download.bytes };
}

/** Admin "Sync all datasets": download every file in the OpenSanctions export
 *  catalogue sequentially (reporting per-file progress), reindex yente after
 *  entities.ftm.json, and record one aml.dataset_syncs row per file. */
export async function triggerSyncAll(): Promise<{ sync_id: number; status: string; message: string; bytes?: number }> {
  const files = [...DATASET_FILES];
  const stats = await resolvePublishedStats();
  await writeProgress({
    status: 'running',
    current_file: files[0].file_name,
    files_done: 0,
    files_total: files.length,
    message: `syncing all ${files.length} OpenSanctions datasets`,
    started_at: new Date().toISOString(),
  });

  let totalBytes = 0;
  let syncId = 0;
  let allOk = true;
  const perFile: string[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const entry = files[i];
    await writeProgress({
      current_file: entry.file_name,
      files_done: i,
      message: `downloading ${entry.file_name} (${i + 1}/${files.length})`,
    });

    const download = await downloadDatasetFile(entry.file_name);
    const ping = entry.file_name === 'entities.ftm.json'
      ? (download.ok
        ? await pingYenteUpdate()
        : { ok: false, detail: 'skipped because dataset download failed' })
      : null;
    const ok = download.ok && (!ping || ping.ok);
    if (!ok) allOk = false;
    totalBytes += download.bytes;
    perFile.push(download.ok
      ? `${entry.file_name} (${download.bytes} bytes)`
      : `${entry.file_name} FAILED: ${download.detail}`);

    const datasetName = entry.file_name === 'entities.ftm.json'
      ? 'opensanctions_default'
      : `opensanctions_default/${entry.file_name}`;
    const id = await recordSync({
      datasetName,
      status: ok ? 'succeeded' : 'failed',
      sourceUrl: remoteUrl(entry.file_name),
      message: perFile[perFile.length - 1],
      datasetVersion: stats.version,
      entityCount: entry.file_name === 'entities.ftm.json' ? stats.entity_count : 0,
    });
    if (i === 0) syncId = id;

    await writeProgress({
      files_done: i + 1,
      message: `${i + 1}/${files.length} datasets processed`,
    });
  }

  const status = allOk ? 'succeeded' : 'failed';
  const message = `synced ${files.length} OpenSanctions datasets: ${perFile.join('; ')}`;
  await writeProgress({ status, files_done: files.length, message });
  return { sync_id: syncId, status, message, bytes: totalBytes };
}

/** Admin-only: download + (re)index a single catalogue file in one action.
 *  entities.ftm.json also pings yente /updatez, exactly like a full sync. */
export async function triggerFileSync(fileName: string): Promise<{ sync_id: number; status: string; message: string; bytes?: number }> {
  if (!DATASET_FILES_BY_NAME[fileName]) {
    const err = new Error(`Unknown dataset file: ${fileName}`) as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  await writeProgress({
    status: 'running',
    current_file: fileName,
    files_done: 0,
    files_total: 1,
    message: `downloading ${fileName}`,
    started_at: new Date().toISOString(),
  });

  const download = await downloadDatasetFile(fileName);
  const ping = fileName === 'entities.ftm.json'
    ? (download.ok
      ? await pingYenteUpdate()
      : { ok: false, detail: 'skipped because dataset download failed' })
    : null;
  const status = download.ok && (!ping || ping.ok) ? 'succeeded' : 'failed';
  const message = [
    download.ok
      ? `downloaded ${fileName} (${download.bytes} bytes)`
      : `file download failed: ${download.detail}`,
    ping
      ? (ping.ok ? 'yente reindex triggered' : (download.ok ? `yente reindex failed: ${ping.detail}` : `yente reindex ${ping.detail}`))
      : 'no reindex required',
  ].join('; ');

  const datasetName = fileName === 'entities.ftm.json' ? 'opensanctions_default' : `opensanctions_default/${fileName}`;
  const stats = await resolvePublishedStats();
  const syncId = await recordSync({
    datasetName,
    status,
    sourceUrl: remoteUrl(fileName),
    message,
    datasetVersion: stats.version,
    entityCount: fileName === 'entities.ftm.json' ? stats.entity_count : 0,
  });
  await writeProgress({ status: status === 'succeeded' ? 'succeeded' : 'failed', files_done: 1, message });
  return { sync_id: syncId, status, message, bytes: download.bytes };
}

/** Resolve a stored catalogue file for the local download endpoint. */
export async function storedDatasetFile(fileName: string): Promise<{ path: string; name: string } | null> {
  if (!DATASET_FILES_BY_NAME[fileName]) return null;
  const info = await storedFileInfo(fileName);
  if (!info.stored || !info.path) return null;
  return { path: info.path, name: path.basename(info.path) };
}
