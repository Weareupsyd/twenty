import { describe, expect, it, vi } from 'vitest';
import { processBotMessage, executeBotAction } from 'src/lib/service-bot';
import { MemoryDbClient } from 'src/lib/records';
import { MemoryState } from 'src/test-utils/memory-state';
import { createQuote } from 'src/lib/service-quotes';

describe('WhatsApp orchestration', () => {
  it('persists a conversation, creates a real quote, and ignores delivered duplicates', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const send = vi.fn(async () => {});
    const texts = ['1', '10000000', 'UAX 123C', 'Jane Doe', 'YES'];
    for (const [i, text] of texts.entries()) {
      await processBotMessage(
        db,
        { from: '0772000000', id: `m-${i}`, text, timestamp: '' },
        { store, send },
      );
    }
    expect(db.store.insuranceQuotes).toHaveLength(1);
    expect(db.store.insuranceQuotes[0]).toMatchObject({
      premium: 150000,
      channel: 'WHATSAPP',
      policyholderPhone: '+256772000000',
    });
    await processBotMessage(
      db,
      { from: '0772000000', id: 'm-4', text: 'YES', timestamp: '' },
      { store, send },
    );
    expect(send).toHaveBeenCalledTimes(5);
    expect(db.store.insuranceQuotes).toHaveLength(1);
  });
  it('retries a failed reply without creating a second support ticket', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const send = vi.fn(async () => {});
    await processBotMessage(
      db,
      { from: '0772000000', id: 'first', text: '5', timestamp: '' },
      { store, send },
    );
    const message = {
      from: '0772000000',
      id: 'second',
      text: 'Please help with my payment',
      timestamp: '',
    };
    send.mockRejectedValueOnce(new Error('network'));
    await expect(
      processBotMessage(db, message, { store, send }),
    ).rejects.toThrow('network');
    await processBotMessage(db, message, { store, send });
    expect(db.store.supportTickets).toHaveLength(1);
  });
  it('does not expose another phone’s quote or initiate its payment', async () => {
    const db = new MemoryDbClient();
    const { quote } = await createQuote(db, {
      phone: '0772000000',
      plate: 'UAX 123C',
      vehicleValue: 10000000,
    });
    const result = await executeBotAction(db, '+256773000000', {
      kind: 'LOOKUP_QUOTE',
      quoteRef: String(quote.reference),
    });
    expect(result).toContain('not found');
    expect(
      await executeBotAction(db, '+256773000000', {
        kind: 'INITIATE_PAYMENT',
        quoteRef: String(quote.reference),
        phone: '+256773000000',
      }),
    ).toContain('not found');
  });
});
