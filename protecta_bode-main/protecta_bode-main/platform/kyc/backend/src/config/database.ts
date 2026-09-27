/**
 * Database Configuration - Dual-mode adapter
 *
 * Cloud mode:  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY -> real Supabase client
 * Community:   DATABASE_URL -> PgClient adapter (raw Postgres, no Supabase dependency)
 *
 * All 37+ service/route files import `{ supabase }` from this module unchanged.
 * The adapter's API surface matches @supabase/supabase-js.
 */

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { PgClient } from '@/adapters/pg/PgClient.js';

// ─── Mode detection ──────────────────────────────────────────
const USE_SUPABASE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const USE_POSTGRES = !!process.env.DATABASE_URL;

if (!USE_SUPABASE && !USE_POSTGRES) {
  throw new Error(
    'Missing database configuration. Set either:\n' +
    '  • SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Cloud mode)\n' +
    '  • DATABASE_URL (Community/self-hosted mode)\n'
  );
}

// ─── Client initialization ──────────────────────────────────

let supabaseClient: any;

if (USE_SUPABASE) {
  supabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      // @supabase/realtime-js requires native WebSocket on Node 22+ or an
      // Keep an explicit transport so Supabase realtime behaves consistently
      // across the Node 24 runtime and local development versions.
      realtime: {
        transport: ws as any,
      },
    }
  );
} else {
  supabaseClient = new PgClient(process.env.DATABASE_URL!);
}

export const supabase = supabaseClient;

// ─── Health check ────────────────────────────────────────────

export const connectDB = async (): Promise<boolean> => {
  try {
    if (USE_SUPABASE) {
      // An auth call without a user session is not a database probe, and
      // Supabase returns query failures as { error } rather than throwing.
      const { error } = await supabase.from('users').select('id').limit(1);
      if (error) throw error;
      console.log(' Connected to Supabase');
    } else {
      // Community mode: simple Postgres connectivity check
      const client = supabaseClient as PgClient;
      await client.pool.query('SELECT 1');
      console.log(' Connected to PostgreSQL (Community mode)');
    }
    return true;
  } catch (error) {
    const mode = USE_SUPABASE ? 'Supabase' : 'PostgreSQL';
    console.error(
      ` Failed to connect to ${mode}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    return false;
  }
};

export default supabase;
