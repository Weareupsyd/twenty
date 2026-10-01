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
    const texts = ['2', '10000000', 'YES', 'Toyota', 'Premio', '2018', 'UAX 123C', 'Jane Doe', 'YES'];
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
    expect(send).toHaveBeenCalledTimes(9);
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
    expect(result.reply).toContain('not found');
    expect(result.document).toBeUndefined();
    expect(
      (
        await executeBotAction(db, '+256773000000', {
          kind: 'INITIATE_PAYMENT',
          quoteRef: String(quote.reference),
          phone: '+256773000000',
        })
      ).reply,
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
    await say('r4', 'YES');
    await say('r5', 'Toyota');
    await say('r6', 'Premio');
    await say('r7', '2018');
    await say('r8', 'UAX 123D');
    expect(send).toHaveBeenLastCalledWith(
      '+256772000000',
      expect.stringContaining('Name: Sarah Kato'),
    );
    const askedForName = send.mock.calls.some(([, text]) =>
      String(text).includes('What is your full name'),
    );
    expect(askedForName).toBe(false);
    await say('r9', 'YES');
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
      (
        await executeBotAction(db, '+256773000000', {
          kind: 'RENEW_POLICY',
          policyNo,
        })
      ).reply,
    ).toContain('not found');
  });
});

describe('quote and invoice PDFs in the conversation', () => {
  it('marks CREATE_QUOTE and LOOKUP_QUOTE for a quote PDF attachment', async () => {
    const db = new MemoryDbClient();
    const { quote } = await createQuote(db, {
      phone: '0772000000',
      plate: 'UAX 123C',
      vehicleValue: 10000000,
    });
    const created = await executeBotAction(db, '+256772000000', {
      kind: 'CREATE_QUOTE',
      name: 'Jane Doe',
      plate: 'UAX 999Z',
      vehicleValue: 8000000,
      make: 'Toyota',
      model: 'Premio',
      year: 2018,
    });
    expect(created.reply).toContain('Quote');
    expect(created.document).toEqual({
      kind: 'quote-pdf',
      ref: expect.stringMatching(/^\d{6}$/),
    });
    const looked = await executeBotAction(db, '+256772000000', {
      kind: 'LOOKUP_QUOTE',
      quoteRef: String(quote.reference),
    });
    expect(looked.document).toEqual({
      kind: 'quote-pdf',
      ref: String(quote.reference),
    });
  });
  it('marks INITIATE_PAYMENT for a proforma invoice attachment', async () => {
    const db = new MemoryDbClient();
    const { quote } = await createQuote(db, {
      phone: '0772000000',
      plate: 'UAX 123C',
      vehicleValue: 10000000,
    });
    const result = await executeBotAction(db, '+256772000000', {
      kind: 'INITIATE_PAYMENT',
      quoteRef: String(quote.reference),
      phone: '+256772000000',
    });
    expect(result.document).toEqual({
      kind: 'payment-invoice',
      ref: String(quote.reference),
      payerPhone: '+256772000000',
    });
  });
  it('sends the text first, then the PDF, and never duplicates either on replay', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const calls: string[] = [];
    const send = vi.fn(async (_phone: string, text: string) => {
      calls.push(`text:${text.slice(0, 30)}`);
    });
    const sendDocument = vi.fn(
      async (_phone: string, doc: { fileName: string }) => {
        calls.push(`doc:${doc.fileName}`);
      },
    );
    const texts = ['2', '10000000', 'YES', 'Toyota', 'Premio', '2018', 'UAX 123C', 'Jane Doe', 'YES'];
    for (const [i, text] of texts.entries()) {
      await processBotMessage(
        db,
        { from: '0772000000', id: `m-${i}`, text, timestamp: '' },
        { store, send, sendDocument },
      );
    }
    expect(send).toHaveBeenCalledTimes(9);
    expect(sendDocument).toHaveBeenCalledTimes(1);
    const quoteRef = String(db.store.insuranceQuotes[0].reference);
    expect(sendDocument.mock.calls[0][0]).toBe('+256772000000');
    expect(sendDocument.mock.calls[0][1]).toMatchObject({
      fileName: `Protecta-Quote-${quoteRef}.pdf`,
    });
    // Text of the quote reply arrived before the document attachment.
    const docIndex = calls.findIndex((c) => c.startsWith('doc:'));
    expect(docIndex).toBeGreaterThan(0);
    expect(calls[docIndex - 1].startsWith('text:')).toBe(true);
    // Replaying every message must not resend text or documents.
    for (const [i, text] of texts.entries()) {
      await processBotMessage(
        db,
        { from: '0772000000', id: `m-${i}`, text, timestamp: '' },
        { store, send, sendDocument },
      );
    }
    expect(send).toHaveBeenCalledTimes(9);
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });
  it('retries only the attachment when the document send fails', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const send = vi.fn(async (_phone: string, _text: string) => {});
    const failing = vi.fn(async (_phone: string, _doc: unknown) => {
      throw new Error('media down');
    });
    const texts = ['2', '10000000', 'YES', 'Toyota', 'Premio', '2018', 'UAX 123C', 'Jane Doe'];
    for (const [i, text] of texts.entries()) {
      await processBotMessage(
        db,
        { from: '0772000000', id: `m-${i}`, text, timestamp: '' },
        { store, send, sendDocument: failing },
      );
    }
    // The final YES creates the quote; its PDF send fails mid-flight.
    await expect(
      processBotMessage(
        db,
        { from: '0772000000', id: 'm-8', text: 'YES', timestamp: '' },
        { store, send, sendDocument: failing },
      ),
    ).rejects.toThrow('media down');
    // 8 drive-up texts plus the quote reply: 9 texts, all already delivered.
    expect(send).toHaveBeenCalledTimes(9);
    // Text was already delivered: the retry sends only the PDF.
    const ok = vi.fn(async (_phone: string, _doc: unknown) => {});
    await processBotMessage(
      db,
      { from: '0772000000', id: 'm-8', text: 'YES', timestamp: '' },
      { store, send, sendDocument: ok },
    );
    expect(send).toHaveBeenCalledTimes(9);
    expect(ok).toHaveBeenCalledTimes(1);
    // Fully delivered: a third delivery is a no-op.
    await processBotMessage(
      db,
      { from: '0772000000', id: 'm-8', text: 'YES', timestamp: '' },
      { store, send, sendDocument: ok },
    );
    expect(send).toHaveBeenCalledTimes(9);
    expect(ok).toHaveBeenCalledTimes(1);
  });
  it('still delivers the text when no document transport is configured', async () => {
    const db = new MemoryDbClient();
    const store = new MemoryState();
    const send = vi.fn(async (_phone: string, _text: string) => {});
    // No sendDocument override and no Evolution/Meta env: whatsAppDocSender
    // resolves to null, so the PDF is skipped but the text goes out.
    for (const [i, text] of ['2', '10000000', 'YES', 'Toyota', 'Premio', '2018', 'UAX 123C', 'Jane Doe', 'YES'].entries()) {
      await processBotMessage(
        db,
        { from: '0772000000', id: `m-${i}`, text, timestamp: '' },
        { store, send },
      );
    }
    expect(send).toHaveBeenCalledTimes(9);
    expect(db.store.insuranceQuotes).toHaveLength(1);
    // The receipt is complete, so replays stay quiet.
    await processBotMessage(
      db,
      { from: '0772000000', id: 'm-8', text: 'YES', timestamp: '' },
      { store, send },
    );
    expect(send).toHaveBeenCalledTimes(9);
  });
});
