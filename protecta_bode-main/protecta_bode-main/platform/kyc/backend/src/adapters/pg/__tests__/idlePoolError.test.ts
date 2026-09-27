/**
 * Regression: idle pooled connections that receive Postgres FATAL 57P01
 * ("terminating connection due to administrator command") must not crash
 * the API process.
 *
 * node-pg re-emits idle-client errors on the Pool. With no listener, Node
 * treats them as uncaughtException. The pool already drops the dead client;
 * the next query reconnects if the process stays up.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PgClient } from '../PgClient.js';

describe('PgClient idle pool errors', () => {
  const clients: PgClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.end().catch(() => undefined)));
  });

  it('registers a pool error listener so idle disconnects are not uncaught', () => {
    const client = new PgClient('postgres://kabila:kabila@127.0.0.1:1/kabila');
    clients.push(client);
    expect(client.pool.listenerCount('error')).toBeGreaterThan(0);
  });

  it('does not throw when an idle-client FATAL 57P01 is emitted on the pool', () => {
    const client = new PgClient('postgres://kabila:kabila@127.0.0.1:1/kabila');
    clients.push(client);
    const err = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
      severity: 'FATAL',
      client: { _ending: true, _activeQuery: null, _poolUseCount: 253 },
    });
    expect(() => client.pool.emit('error', err)).not.toThrow();
  });
});
