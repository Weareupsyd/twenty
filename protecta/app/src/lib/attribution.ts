import { kv } from 'twenty-sdk/logic-function';

/**
 * Quote attribution lives in KV because the quote schema intentionally stays
 * small: partner/agent links are operational routing data, not domain data.
 */
export const setQuotePartner = (quoteRef: string, partnerId: string): Promise<void> =>
  kv.set(`quote-partner:${quoteRef}`, partnerId);

export const getQuotePartner = (quoteRef: string): Promise<string | null> =>
  kv.get<string>(`quote-partner:${quoteRef}`);

export const setQuoteAgent = (quoteRef: string, agentPersonId: string): Promise<void> =>
  kv.set(`quote-agent:${quoteRef}`, agentPersonId);

export const getQuoteAgent = (quoteRef: string): Promise<string | null> =>
  kv.get<string>(`quote-agent:${quoteRef}`);

export const appendPartnerQuote = async (
  partnerId: string,
  quoteRef: string,
): Promise<void> => {
  const key = `partner-quotes:${partnerId}`;
  const existing = (await kv.get<string[]>(key)) ?? [];
  if (!existing.includes(quoteRef)) {
    await kv.set(key, [...existing.slice(-5000), quoteRef]);
  }
};

export const getPartnerQuotes = (partnerId: string): Promise<string[]> =>
  kv.get<string[]>(`partner-quotes:${partnerId}`).then((refs) => refs ?? []);

/** One-shot guard so retries and overlapping triggers emit only once. */
export const emitOnce = async (key: string): Promise<boolean> => {
  const existing = await kv.get<string>(`once:${key}`);
  if (existing) {
    return false;
  }
  await kv.set(`once:${key}`, new Date().toISOString());
  return true;
};
