import { describe, expect, it, vi } from 'vitest';
import { processBotMessage, executeBotAction } from 'src/lib/service-bot';
import { MemoryDbClient } from 'src/lib/records';
import { MemoryState } from 'src/test-utils/memory-state';
import { createQuote } from 'src/lib/service-quotes';
import { issuePolicy } from 'src/lib/service-policies';

describe('WhatsApp orchestration', () => {
  it('persists a conversation, creates a real quote, and ignores delivered duplicates', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const send = vi.fn(async (_phone: string, _text: string) => {});
    const texts = ['2', '10000000', 'Toyota', 'Premio', '2018', 'UAX 123C', 'Jane Doe', 'YES'];
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
    expect(send).toHaveBeenCalledTimes(8);
    expect(db.store.insuranceQuotes).toHaveLength(1);
  });
  it('retries a failed reply without creating a second support ticket', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const send = vi.fn(async (_phone: string, _text: string) => {});
    await processBotMessage(
      db,
      { from: '0772000000', id: 'first', text: '6', timestamp: '' },
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
  it('recognises a registered number and never asks for the name again', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const send = vi.fn(async (_phone: string, _text: string) => {});
    await createQuote(db, {
      phone: '0772000000',
      name: 'Sarah Kato',
      plate: 'UAX 123C',
      vehicleValue: 10000000,
    });
    const say = (id: string, text: string) =>
      processBotMessage(
        db,
        { from: '0772000000', id, text, timestamp: '' },
        { store, send },
      );
    await say('r1', '2');
    expect(send).toHaveBeenLastCalledWith(
      '+256772000000',
      expect.stringContaining('Welcome back, Sarah.'),
    );
    await say('r2', '1');
    await say('r3', '5000000');
    await say('r4', 'Toyota');
    await say('r5', 'Premio');
    await say('r6', '2018');
    await say('r7', 'UAX 123D');
    expect(send).toHaveBeenLastCalledWith(
      '+256772000000',
      expect.stringContaining('Name: Sarah Kato'),
    );
    const askedForName = send.mock.calls.some(([, text]) =>
      String(text).includes('What is your full name'),
    );
    expect(askedForName).toBe(false);
    await say('r8', 'YES');
    // The new quote reuses the same person — no duplicate is created.
    expect(db.store.insuranceQuotes).toHaveLength(2);
    expect(db.store.people).toHaveLength(1);
    expect(db.store.insuranceQuotes[1]).toMatchObject({
      policyholderPhone: '+256772000000',
    });
  });
  it('lets the registered number renew a policy and refuses other numbers', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const send = vi.fn(async (_phone: string, _text: string) => {});
    const { quote } = await createQuote(db, {
      phone: '0772000000',
      name: 'Sarah Kato',
      plate: 'UAX 123C',
      vehicleValue: 10000000,
    });
    const { policy } = await issuePolicy(db, {
      quoteRef: String(quote.reference),
      rng: () => 0.5,
    });
    const policyNo = String(policy.policyNo);
    const say = (id: string, text: string) =>
      processBotMessage(
        db,
        { from: '0772000000', id, text, timestamp: '' },
        { store, send },
      );
    await say('n1', '2');
    await say('n2', '2');
    expect(send).toHaveBeenLastCalledWith(
      '+256772000000',
      expect.stringContaining(policyNo),
    );
    await say('n3', policyNo);
    expect(send).toHaveBeenLastCalledWith(
      '+256772000000',
      expect.stringContaining('renewal quote'),
    );
    // One renewal quote, created for the registered number.
    expect(db.store.insuranceQuotes).toHaveLength(2);
    expect(db.store.insuranceQuotes[1]).toMatchObject({
      channel: 'WHATSAPP',
      policyholderPhone: '+256772000000',
    });
    // Another number cannot renew someone else's policy.
    expect(
      await executeBotAction(db, '+256773000000', {
        kind: 'RENEW_POLICY',
        policyNo,
      }),
    ).toContain('not found');
  });
});
