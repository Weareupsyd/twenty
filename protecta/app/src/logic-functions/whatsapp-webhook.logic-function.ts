import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { WHATSAPP_WEBHOOK } from 'src/constants/universal-identifiers';
import { nextBotStep } from 'src/lib/bot';
import { WELCOME } from 'src/lib/bot-templates';
import { createEventRecord } from 'src/lib/events';
import { flushWhatsAppQueue } from 'src/lib/fanout';
import { escapeHtml } from 'src/lib/pages';
import { normalizeUgPhone, toLocalUg } from 'src/lib/phones';
import { CoreDbClient } from 'src/lib/records';
import { upsertSubscriber } from 'src/lib/service-subscriptions';
import { findPoliciesByPhone } from 'src/lib/service-policies';
import {
  botMenuMessage,
  buttonReplyIds,
  claimAckMessage,
  helpMessage,
  policiesListMessage,
  renewalQuoteMessage,
  unknownMessage,
} from 'src/lib/whatsapp-text';
import { fromCloudRecord, whatsAppConfigFromEnv, sendWhatsApp } from 'src/lib/whatsapp';

type Incoming = {
  from: string;
  text: string;
  buttonId?: string;
  messageId?: string;
  contactName?: string;
};

const extractIncoming = (body: Record<string, unknown>): Incoming[] => {
  const out: Incoming[] = [];
  const entries = (body.entry as Array<Record<string, unknown>> | undefined) ?? [];
  for (const entry of entries) {
    const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
    for (const change of changes) {
      const value = (change.value as Record<string, unknown> | undefined) ?? {};
      if (value.statuses) {
        continue;
      }
      const contacts = (value.contacts as Array<Record<string, unknown>> | undefined) ?? [];
      const messages = (value.messages as Array<Record<string, unknown>> | undefined) ?? [];
      const name = contacts[0] ? String(contacts[0].profile?.name ?? contacts[0].wa_id ?? '') : '';
      for (const message of messages) {
        const from = String(message.from ?? '');
        if (!from) {
          continue;
        }
        const text = String(message.text?.body ?? '');
        const buttonId = message.interactive?.button_reply
          ? String(message.interactive.button_reply.id ?? '')
          : message.button
            ? String(message.button.text ?? '')
            : undefined;
        out.push({ from, text: text || buttonId || '', buttonId, messageId: String(message.id ?? ''), contactName: name });
      }
    }
  }
  return out;
};

const keyOf = (phone: string): string => `whatsapp:${phone}`;

const readSession = async (db: CoreDbClient, phone: string) => {
  const row = await db.findFirst('botSessions', { sessionKey: { eq: keyOf(phone) } }, [
    'id',
    'stateJson',
    'lastStep',
  ]);
  if (!row) {
    return { id: undefined as string | undefined, state: {} as Record<string, unknown> };
  }
  let state: Record<string, unknown> = {};
  try {
    state = JSON.parse(String(row.stateJson ?? '{}')) as Record<string, unknown>;
  } catch {
    state = {};
  }
  return { id: String(row.id), state };
};

const writeSession = async (
  db: CoreDbClient,
  phone: string,
  id: string | undefined,
  lastStep: string,
  state: Record<string, unknown>,
) => {
  const payload = {
    stateJson: JSON.stringify(state),
    lastStep,
    lastMessageAt: new Date().toISOString(),
  };
  if (id) {
    await db.update('botSession', id, payload);
    return;
  }
  await db.create('botSession', {
    channel: 'WHATSAPP',
    contactPhone: phone,
    sessionKey: keyOf(phone),
    startedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    lastStep,
    ...payload,
  });
};

const menuFor = (step: 'welcome' | 'main'): string =>
  step === 'welcome' ? WELCOME : botMenuMessage();

const handleText = async (
  db: CoreDbClient,
  phone: string,
  raw: string,
  buttonId: string | undefined,
  session: Record<string, unknown>,
): Promise<{ reply: string; state: Record<string, unknown> }> => {
  const saved = session.step ? String(session.step) : 'main';
  const text = (buttonId === buttonReplyIds.quote ? 'quote' : raw).trim();
  const lowered = text.toLowerCase();

  // Free-form numeric value input while quoting.
  if (saved === 'awaiting_value') {
    const digits = text.replace(/\D/g, '');
    if (!digits || Number(digits) < 1_000_000) {
      return {
        reply: 'Please send your car’s market value as a number (minimum UGX 1,000,000).',
        state: { ...session, step: 'awaiting_value' },
      };
    }
    if (digits.length > 11) {
      return {
        reply: 'That looks too high — send your car’s market value (UGX 1,000,000 – 300,000,000).',
        state: { ...session, step: 'awaiting_value' },
      };
    }
    const value = Number(digits);
    return {
      reply: renewalQuoteMessage({ plate: toLocalUg(phone), vehicleValue: value, channel: 'whatsapp' })
        .replace(/WhatsApp/i, 'WhatsApp')
        .replace(
          'Reply YES to pay and activate, or NO to cancel.',
          'Reply with your number plate (e.g. UAX 123B) to continue.',
        ),
      state: { ...session, step: 'awaiting_plate', vehicleValue: value },
    };
  }

  if (saved === 'awaiting_plate') {
    const plate = text.replace(/[^a-z0-9 ]/gi, '').trim().toUpperCase();
    if (!plate || plate.length < 4) {
      return {
        reply: 'Please send your number plate (e.g. UAX 123B).',
        state: { ...session, step: 'awaiting_plate' },
      };
    }
    return {
      reply:
        `Thanks ${escapeHtml(phone)} — plate *${escapeHtml(plate)}* received.\n\n` +
        'Tap below to review your quote and pay securely.',
      state: { ...session, step: 'main', plate },
    };
  }

  const step = nextBotStep(saved === 'main' ? 'start' : saved, { text, buttonId });
  const state: Record<string, unknown> = { ...session, step: step === 'start' ? 'main' : step };

  switch (step) {
    case 'quote_start':
      state.step = 'awaiting_value';
      return {
        reply:
          'Let’s get you covered! What is your car’s current market value in UGX?\n(e.g. 25,000,000)',
        state,
      };
    case 'policies_list': {
      const policies = await findPoliciesByPhone(db, phone).catch(() => []);
      return { reply: policiesListMessage(policies), state };
    }
    case 'claim_start':
      state.step = 'awaiting_claim';
      return {
        reply:
          'I’m sorry to hear that. Please describe what happened in one message, including the date and location.',
        state,
      };
    case 'help':
      return { reply: helpMessage(), state };
    case 'human_handoff':
      return {
        reply:
          'Connecting you to a human agent… Meanwhile type HELP to see what I can do, or call 0312246500.',
        state,
      };
    case 'menu':
      return { reply: menuFor('main'), state };
    default:
      if (['hi', 'hello', 'hey', 'start', 'menu'].includes(lowered)) {
        return { reply: menuFor('welcome'), state };
      }
      if (lowered === 'yes' && session.step === 'awaiting_claim') {
        return { reply: claimAckMessage(''), state: { ...state, step: 'main' } };
      }
      return { reply: unknownMessage(), state };
  }
};

const handler = async (event: RoutePayload): Promise<Response> => {
  // GET hits this route only if the verify function is not installed; fail closed.
  if (event.httpMethod === 'GET') {
    return Response.json({ ok: false, error: 'Use the webhook verification endpoint.' }, { status: 405 });
  }

  const body = (event.body ?? {}) as Record<string, unknown>;
  const incoming = extractIncoming(body);
  const db = new CoreDbClient();
  const config = whatsAppConfigFromEnv();

  for (const message of incoming) {
    const phone = normalizeUgPhone(message.from);
    if (!phone) {
      continue;
    }
    if (message.contactName) {
      await upsertSubscriber(db, { phone, name: message.contactName });
    } else {
      await upsertSubscriber(db, { phone });
    }
    const { id, state } = await readSession(db, phone);
    const { reply, state: next } = await handleText(db, phone, message.text, message.buttonId, state);
    await writeSession(db, phone, id, String(next.step ?? 'main'), next);
    await createEventRecord(
      db,
      'WHATSAPP_INBOUND',
      message.messageId ?? `wa-${Date.now()}`,
      { phone, text: message.text.slice(0, 500), buttonId: message.buttonId },
    ).catch(() => undefined);
    if (config && reply) {
      await sendWhatsApp(fromCloudRecord(config), phone, reply).catch((error: unknown) =>
        console.error('whatsapp reply failed', error),
      );
    }
  }

  await flushWhatsAppQueue().catch((error: unknown) => console.error('wa queue failed', error));
  return Response.json({ ok: true, received: incoming.length });
};

export default defineLogicFunction({
  universalIdentifier: WHATSAPP_WEBHOOK,
  name: 'whatsapp-webhook',
  timeoutSeconds: 60,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/whatsapp/webhook',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
