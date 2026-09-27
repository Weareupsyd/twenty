import { kv } from 'twenty-sdk/logic-function';
import {
  handleBotTurn,
  startSession,
  type BotAction,
  type BotSession,
} from 'src/lib/bot-flow';
import { sha256Hex } from 'src/lib/crypto';
import { publicBaseUrl } from 'src/lib/http';
import { normalizeUgPhone } from 'src/lib/phones';
import { type DbClient } from 'src/lib/records';
import { createClaim } from 'src/lib/service-claims';
import { findPoliciesByPhone, findPolicyByNo } from 'src/lib/service-policies';
import {
  createQuote,
  findQuoteByRef,
  quoteShareUrl,
} from 'src/lib/service-quotes';
import { createTicket } from 'src/lib/service-tickets';
import { type StateStore } from 'src/lib/service-otp';
import {
  sendWhatsAppText,
  whatsappConfigFromEnv,
  type InboundWhatsAppMessage,
} from 'src/lib/whatsapp-api';
import { quoteIssuedMessage } from 'src/lib/whatsapp-text';

export const executeBotAction = async (
  db: DbClient,
  phone: string,
  action: BotAction,
): Promise<string> => {
  switch (action.kind) {
    case 'CREATE_QUOTE': {
      const { quote } = await createQuote(db, {
        phone,
        name: action.name,
        plate: action.plate,
        vehicleValue: action.vehicleValue,
        channel: 'WHATSAPP',
      });
      return quoteIssuedMessage({
        name: action.name,
        quoteRef: String(quote.reference),
        premium: Number(quote.premium),
        validUntil: String(quote.validUntil),
        shareUrl: String(quote.shareUrl),
      });
    }
    case 'LOOKUP_POLICIES': {
      const rows = await findPoliciesByPhone(db, phone);
      return rows.length
        ? rows
            .map(
              (p) =>
                `${p.policyNo}: ${p.plate} — ${p.status}, until ${p.periodEnd}`,
            )
            .join('\n')
        : 'No policies found for your WhatsApp number.';
    }
    case 'LOOKUP_QUOTE': {
      const quote = await findQuoteByRef(db, action.quoteRef);
      if (!quote || quote.policyholderPhone !== phone)
        return 'Quote not found for your WhatsApp number.';
      return `Quote ${quote.reference}: UGX ${quote.premium}. ${quoteShareUrl(publicBaseUrl(), action.quoteRef)}`;
    }
    case 'INITIATE_PAYMENT': {
      const quote = await findQuoteByRef(db, action.quoteRef);
      if (!quote || quote.policyholderPhone !== phone)
        return 'Quote not found for your WhatsApp number.';
      // Ask the user to choose the provider on the quote's payment page; never
      // guess the network from a portable MSISDN or debit a number implicitly.
      return `Choose MTN, Airtel or bank and approve payment here: ${quoteShareUrl(publicBaseUrl(), action.quoteRef)}`;
    }
    case 'CREATE_CLAIM': {
      const policy = await findPolicyByNo(db, action.policyNo);
      const quote = policy
        ? await findQuoteByRef(db, String(policy.quoteRef))
        : null;
      if (!quote || quote.policyholderPhone !== phone)
        return 'Policy not found for your WhatsApp number.';
      const { claim } = await createClaim(db, {
        ...action,
        reporterPhone: phone,
      });
      return `Claim ${claim.claimRef} recorded. Our team will contact you.`;
    }
    case 'CREATE_TICKET': {
      const { ticket } = await createTicket(db, {
        phone,
        subject: action.text.slice(0, 140),
        description: action.text,
        channel: 'WHATSAPP',
      });
      return `Support ticket ${ticket.ticketRef} recorded.`;
    }
  }
};

type Receipt = { reply: string; next: BotSession; sent: boolean };
export const processBotMessage = async (
  db: DbClient,
  message: InboundWhatsAppMessage,
  options: {
    store?: StateStore;
    send?: (phone: string, text: string) => Promise<unknown>;
    now?: number;
  } = {},
) => {
  const phone = normalizeUgPhone(message.from);
  if (!phone || !message.id)
    throw new Error('Invalid inbound WhatsApp message.');
  const store = options.store ?? kv;
  const now = options.now ?? Date.now();
  const receiptKey = `bot:message:${sha256Hex(message.id)}`;
  const sessionKey = `bot:session:${sha256Hex(phone)}`;
  let receipt = await store.get<Receipt>(receiptKey);
  if (receipt?.sent) return;
  const config = whatsappConfigFromEnv();
  const send =
    options.send ??
    (config
      ? (to: string, text: string) => sendWhatsAppText(config, to, text)
      : null);
  if (!send) throw new Error('WhatsApp delivery is not configured.');
  if (!receipt) {
    const saved = await store.get<BotSession>(sessionKey);
    const session =
      saved && now - saved.updatedAt < 24 * 60 * 60 * 1000
        ? saved
        : startSession();
    const turn = handleBotTurn(session, message.text);
    const reply = turn.action
      ? await executeBotAction(db, phone, turn.action)
      : turn.reply;
    receipt = { reply, next: turn.next, sent: false };
    // Save the action result before sending, so delivery retries don't rerun it.
    await store.set(receiptKey, receipt);
  }
  await store.set(sessionKey, receipt.next);
  await send(phone, receipt.reply);
  await store.set(receiptKey, { ...receipt, sent: true });
};
