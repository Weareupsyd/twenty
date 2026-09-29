import { kv } from 'twenty-sdk/logic-function';
import {
  handleBotTurn,
  startSession,
  type BotAction,
  type BotSession,
} from 'src/lib/bot-flow';
import {
  paymentInvoiceDocument,
  quotePdfDocument,
} from 'src/lib/conversation-docs';
import { sha256Hex } from 'src/lib/crypto';
import { publicBaseUrl } from 'src/lib/http';
import { normalizeUgPhone } from 'src/lib/phones';
import { type DbClient } from 'src/lib/records';
import { createClaim } from 'src/lib/service-claims';
import {
  findPoliciesByPhone,
  findPolicyByNo,
  renewPolicy,
} from 'src/lib/service-policies';
import {
  createQuote,
  findPersonByPhone,
  findQuoteByRef,
  personDisplayName,
  quoteShareUrl,
} from 'src/lib/service-quotes';
import { createTicket } from 'src/lib/service-tickets';
import { type StateStore } from 'src/lib/service-otp';
import { pricingFromEnv } from 'src/lib/pricing';
import { type InboundWhatsAppMessage } from 'src/lib/whatsapp-api';
import {
  NOT_CONFIGURED,
  whatsAppDocSender,
  whatsAppSender,
  type OutboundWhatsAppDocument,
} from 'src/lib/whatsapp-transport';
import {
  quoteIssuedMessage,
  renewalQuoteMessage,
} from 'src/lib/whatsapp-text';
import { loadStoredWhatsAppSettings } from 'src/lib/whatsapp-settings';

/**
 * Which PDF to attach to the bot's text reply. Only this descriptor goes
 * into the KV receipt; the bytes are rebuilt at send time.
 */
export type BotDocumentRef =
  | { kind: 'quote-pdf'; ref: string }
  | { kind: 'payment-invoice'; ref: string; payerPhone: string };

export type BotActionResult = { reply: string; document?: BotDocumentRef };

export const executeBotAction = async (
  db: DbClient,
  phone: string,
  action: BotAction,
): Promise<BotActionResult> => {
  switch (action.kind) {
    case 'CREATE_QUOTE': {
      const { quote } = await createQuote(db, {
        phone,
        name: action.name,
        plate: action.plate,
        vehicleValue: action.vehicleValue,
        make: action.make,
        model: action.model,
        year: action.year,
        channel: 'WHATSAPP',
      });
      return {
        reply: quoteIssuedMessage({
          name: action.name,
          quoteRef: String(quote.reference),
          premium: Number(quote.premium),
          validUntil: String(quote.validUntil),
          shareUrl: String(quote.shareUrl),
        }),
        // Text plus the quote PDF: the customer sees both in the chat.
        document: { kind: 'quote-pdf', ref: String(quote.reference) },
      };
    }
    case 'LOOKUP_POLICIES': {
      const rows = await findPoliciesByPhone(db, phone);
      return {
        reply: rows.length
          ? [
              rows
                .map(
                  (p) =>
                    `${p.policyNo}: ${p.plate} — ${p.status}, until ${p.periodEnd}`,
                )
                .join('\n'),
              '',
              'Reply MENU for the main menu.',
            ].join('\n')
          : 'No policies found for your WhatsApp number.\n\nReply MENU for the main menu.',
      };
    }
    case 'LIST_RENEWABLE_POLICIES': {
      const rows = await findPoliciesByPhone(db, phone);
      return {
        reply: rows.length
          ? [
              rows
                .map(
                  (p) =>
                    `${p.policyNo}: ${p.plate} — ${p.status}, until ${p.periodEnd}`,
                )
                .join('\n'),
              '',
              'Reply with the policy number you want to renew, or MENU to start over.',
            ].join('\n')
          : 'No policies found for your WhatsApp number.\n\nReply 2 to cover a new car, or MENU for the main menu.',
      };
    }
    case 'RENEW_POLICY': {
      const policy = await findPolicyByNo(db, action.policyNo);
      const quote = policy
        ? await findQuoteByRef(db, String(policy.quoteRef))
        : null;
      if (!policy || !quote || quote.policyholderPhone !== phone)
        return {
          reply:
            'Policy not found for your WhatsApp number.\n\nReply MENU for the main menu.',
        };
      const { quote: renewal } = await renewPolicy(db, action.policyNo, {
        channel: 'WHATSAPP',
      });
      return {
        reply: renewalQuoteMessage({
          policyNo: String(policy.policyNo),
          quoteRef: String(renewal.reference),
          premium: Number(renewal.premium),
          shareUrl: String(renewal.shareUrl),
        }),
      };
    }
    case 'LOOKUP_QUOTE': {
      const quote = await findQuoteByRef(db, action.quoteRef);
      if (!quote || quote.policyholderPhone !== phone)
        return {
          reply:
            'Quote not found for your WhatsApp number.\n\nReply MENU for the main menu.',
        };
      return {
        reply: `Quote ${quote.reference}: UGX ${quote.premium}. ${quoteShareUrl(publicBaseUrl(), action.quoteRef)}\n\nReply MENU for the main menu.`,
        document: { kind: 'quote-pdf', ref: String(quote.reference) },
      };
    }
    case 'INITIATE_PAYMENT': {
      const quote = await findQuoteByRef(db, action.quoteRef);
      if (!quote || quote.policyholderPhone !== phone)
        return {
          reply:
            'Quote not found for your WhatsApp number.\n\nReply MENU for the main menu.',
        };
      // Ask the user to choose the provider on the quote's payment page; never
      // guess the network from a portable MSISDN or debit a number implicitly.
      return {
        reply: `Choose MTN, Airtel or bank and approve payment here: ${quoteShareUrl(publicBaseUrl(), action.quoteRef)}\n\nReply MENU for the main menu.`,
        document: {
          kind: 'payment-invoice',
          ref: String(quote.reference),
          payerPhone: action.phone,
        },
      };
    }
    case 'CREATE_CLAIM': {
      const policy = await findPolicyByNo(db, action.policyNo);
      const quote = policy
        ? await findQuoteByRef(db, String(policy.quoteRef))
        : null;
      if (!quote || quote.policyholderPhone !== phone)
        return {
          reply:
            'Policy not found for your WhatsApp number.\n\nReply MENU for the main menu.',
        };
      const { claim } = await createClaim(db, {
        ...action,
        reporterPhone: phone,
      });
      return {
        reply: `Claim ${claim.claimRef} recorded. Our team will contact you.\n\nReply MENU for the main menu.`,
      };
    }
    case 'CREATE_TICKET': {
      const { ticket } = await createTicket(db, {
        phone,
        subject: action.text.slice(0, 140),
        description: action.text,
        channel: 'WHATSAPP',
      });
      return {
        reply: `Support ticket ${ticket.ticketRef} recorded.\n\nReply MENU for the main menu.`,
      };
    }
  }
};

/**
 * Rebuild the PDF a receipt refers to, at send time. Only the descriptor is
 * kept in KV, so redeliveries stay cheap and always attach a fresh document.
 */
export const buildBotDocument = async (
  db: DbClient,
  doc: BotDocumentRef,
): Promise<OutboundWhatsAppDocument> => {
  const quote = await findQuoteByRef(db, doc.ref);
  if (!quote) {
    throw new Error(`Quote ${doc.ref} not found for the attachment.`);
  }
  const person = await findPersonByPhone(
    db,
    String(quote.policyholderPhone ?? ''),
  );
  const name = person ? personDisplayName(person) : '';
  if (doc.kind === 'quote-pdf') {
    return quotePdfDocument(quote, name ? { name } : {});
  }
  return paymentInvoiceDocument(quote, {
    ...(name ? { name } : {}),
    payerPhone: doc.payerPhone,
  });
};

type Receipt = {
  reply: string;
  next: BotSession;
  sent: boolean;
  document?: BotDocumentRef;
  documentSent?: boolean;
};
export const processBotMessage = async (
  db: DbClient,
  message: InboundWhatsAppMessage,
  options: {
    store?: StateStore;
    send?: (phone: string, text: string) => Promise<unknown>;
    sendDocument?: (
      phone: string,
      doc: OutboundWhatsAppDocument,
    ) => Promise<unknown>;
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
  // Fully delivered already? Text sent and (when present) PDF attached.
  if (
    receipt?.sent &&
    (receipt.documentSent || !receipt.document)
  ) {
    return;
  }
  const send = options.send ?? (await whatsAppSender(store));
  if (!send) throw new Error(NOT_CONFIGURED);
  if (!receipt) {
    const saved = await store.get<BotSession>(sessionKey);
    const session =
      saved && now - saved.updatedAt < 24 * 60 * 60 * 1000
        ? saved
        : startSession();
    const pricing = pricingFromEnv();
    // The WhatsApp number is the customer's identity: when it is already
    // registered, the conversation greets them and skips the name question.
    const person = await findPersonByPhone(db, phone);
    const customerName = person ? personDisplayName(person) : '';
    const waSettings = await loadStoredWhatsAppSettings(store).catch(() => null);
    const turn = handleBotTurn(session, message.text, {
      minValue: pricing.minValue,
      maxValue: pricing.maxValue,
      rate: pricing.rate,
      ...(customerName ? { customer: { name: customerName } } : {}),
      ...(waSettings?.botMenu ? { botMenu: waSettings.botMenu } : {}),
      ...(waSettings?.botWelcomeMessage ? { welcomeMessage: waSettings.botWelcomeMessage } : {}),
    });
    const result = turn.action
      ? await executeBotAction(db, phone, turn.action)
      : { reply: turn.reply };
    receipt = {
      reply: result.reply,
      next: turn.next,
      sent: false,
      ...(result.document ? { document: result.document } : {}),
    };
    // Save the action result before sending, so delivery retries don't rerun it.
    await store.set(receiptKey, receipt);
  }
  await store.set(sessionKey, receipt.next);
  if (!receipt.sent) {
    await send(phone, receipt.reply);
    receipt = { ...receipt, sent: true };
    await store.set(receiptKey, receipt);
  }
  if (receipt.document && !receipt.documentSent) {
    // Attach the PDF after the text so the customer sees both. When document
    // sending is not configured at all, skip it — the text already went out.
    const sendDocument =
      options.sendDocument ?? (await whatsAppDocSender(store));
    if (sendDocument) {
      const doc = await buildBotDocument(db, receipt.document);
      await sendDocument(phone, doc);
    }
    receipt = { ...receipt, documentSent: true };
    await store.set(receiptKey, receipt);
  }
};
