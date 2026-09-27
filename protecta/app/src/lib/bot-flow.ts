import { isValidPlate, normalizePlate, normalizeUgPhone } from 'src/lib/phones';

export type BotState =
  | 'IDLE'
  | 'BUY_VALUE'
  | 'BUY_PLATE'
  | 'BUY_NAME'
  | 'BUY_CONFIRM'
  | 'PAY_PHONE'
  | 'CLAIM_POLICY'
  | 'CLAIM_DESCRIPTION'
  | 'CLAIM_LOCATION'
  | 'TICKET_TEXT';

export type BotSession = {
  state: BotState;
  data: Record<string, string>;
  updatedAt: number;
};

export type BotAction =
  | { kind: 'CREATE_QUOTE'; vehicleValue: number; plate: string; name: string }
  | { kind: 'INITIATE_PAYMENT'; quoteRef: string; phone: string }
  | {
      kind: 'CREATE_CLAIM';
      policyNo: string;
      description: string;
      location: string;
    }
  | { kind: 'CREATE_TICKET'; text: string }
  | { kind: 'LOOKUP_POLICIES' }
  | { kind: 'LOOKUP_QUOTE'; quoteRef: string };

export type BotTurn = {
  reply: string;
  next: BotSession;
  action?: BotAction;
};

export const BOT_MENU = [
  '1. Buy motor cover (1.5% of value)',
  '2. My policies',
  '3. Pay for a quote',
  '4. Report a claim',
  '5. Talk to support',
].join('\n');

const emptySession = (): BotSession => ({
  state: 'IDLE',
  data: {},
  updatedAt: Date.now(),
});

const withState = (
  session: BotSession,
  state: BotState,
  data?: Record<string, string>,
): BotSession => ({
  state,
  data: state === 'IDLE' ? {} : { ...session.data, ...(data ?? {}) },
  updatedAt: Date.now(),
});

const isMenuCommand = (text: string): boolean =>
  ['menu', 'hi', 'hello', 'start', '0'].includes(text.trim().toLowerCase());

const parseMoney = (text: string): number | null => {
  const cleaned = text.replace(/[^0-9]/g, '');
  if (!cleaned) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
};

export const startSession = (): BotSession => emptySession();

/**
 * Pure menu-driven state machine. The caller persists `next`, runs `action`
 * against Twenty records, and sends `reply` (appending action results).
 */
export const handleBotTurn = (
  session: BotSession,
  rawText: string,
  minValue = 1_000_000,
  maxValue = 300_000_000,
): BotTurn => {
  const text = rawText.trim();

  if (isMenuCommand(text)) {
    return {
      reply: `🛡️ *Protecta Bode*\n${BOT_MENU}\n\nReply with a number.`,
      next: withState(session, 'IDLE', {}),
    };
  }

  switch (session.state) {
    case 'IDLE': {
      if (text === '1') {
        return {
          reply: 'What is the market value of the vehicle in UGX? (1M – 300M)',
          next: withState(session, 'BUY_VALUE'),
        };
      }
      if (text === '2') {
        return {
          reply: 'Looking up your policies…',
          next: withState(session, 'IDLE'),
          action: { kind: 'LOOKUP_POLICIES' },
        };
      }
      if (text === '3') {
        return {
          reply: 'Send the quote reference (15 digits).',
          next: withState(session, 'PAY_PHONE'),
        };
      }
      if (text === '4') {
        return {
          reply: 'Sorry to hear that. What is the policy number?',
          next: withState(session, 'CLAIM_POLICY'),
        };
      }
      if (text === '5') {
        return {
          reply:
            'Describe your issue in one message and our team will respond.',
          next: withState(session, 'TICKET_TEXT'),
        };
      }
      const quoteLookup = text.match(/^(\d{15})$/);
      if (quoteLookup) {
        return {
          reply: 'Looking up your quote…',
          next: withState(session, 'IDLE'),
          action: { kind: 'LOOKUP_QUOTE', quoteRef: quoteLookup[1] },
        };
      }
      return {
        reply: `I didn't get that.\n${BOT_MENU}`,
        next: withState(session, 'IDLE'),
      };
    }

    case 'BUY_VALUE': {
      const value = parseMoney(text);
      if (value === null || value < minValue || value > maxValue) {
        return {
          reply: `Enter a value between UGX ${minValue.toLocaleString('en-US')} and UGX ${maxValue.toLocaleString('en-US')} (numbers only).`,
          next: session,
        };
      }
      return {
        reply: `Value UGX ${value.toLocaleString('en-US')} ✅\nWhat is the number plate? (e.g. UAX 123C)`,
        next: withState(session, 'BUY_PLATE', { vehicleValue: String(value) }),
      };
    }

    case 'BUY_PLATE': {
      if (!isValidPlate(text)) {
        return {
          reply: 'That plate looks invalid. Try again, e.g. UAX 123C.',
          next: session,
        };
      }
      return {
        reply: 'What is your full name?',
        next: withState(session, 'BUY_NAME', { plate: normalizePlate(text) }),
      };
    }

    case 'BUY_NAME': {
      if (text.replace(/\s/g, '').length < 3) {
        return { reply: 'Please send your full name.', next: session };
      }
      const value = Number(session.data.vehicleValue);
      const premium = Math.round(value * 0.015);
      return {
        reply: `Confirm your quote:\n• Name: ${text}\n• Plate: ${session.data.plate}\n• Value: UGX ${value.toLocaleString('en-US')}\n• Premium (1.5%): UGX ${premium.toLocaleString('en-US')}\n\nReply YES to confirm or NO to restart.`,
        next: withState(session, 'BUY_CONFIRM', { name: text }),
      };
    }

    case 'BUY_CONFIRM': {
      const answer = text.toLowerCase();
      if (answer === 'yes' || answer === 'y') {
        return {
          reply: 'Creating your quote…',
          next: withState(session, 'IDLE', {}),
          action: {
            kind: 'CREATE_QUOTE',
            vehicleValue: Number(session.data.vehicleValue),
            plate: session.data.plate ?? '',
            name: session.data.name ?? '',
          },
        };
      }
      return {
        reply: `Restarted.\n${BOT_MENU}`,
        next: withState(session, 'IDLE', {}),
      };
    }

    case 'PAY_PHONE': {
      if (/^\d{15}$/.test(text)) {
        return {
          reply: 'Which mobile-money number should we debit? (e.g. 0772000000)',
          next: withState(session, 'PAY_PHONE', {
            quoteRef: text,
            step: 'phone',
          }),
        };
      }
      if (session.data.step === 'phone') {
        const phone = normalizeUgPhone(text);
        if (!phone) {
          return {
            reply: 'That number looks invalid. Send a 10-digit Ugandan number.',
            next: session,
          };
        }
        const quoteRef = session.data.quoteRef ?? '';
        return {
          reply: 'Opening secure payment options for your quote…',
          next: withState(session, 'IDLE', {}),
          action: { kind: 'INITIATE_PAYMENT', quoteRef, phone },
        };
      }
      return {
        reply: 'Send the 15-digit quote reference first.',
        next: session,
      };
    }

    case 'CLAIM_POLICY': {
      if (text.length < 4) {
        return { reply: 'Please send the full policy number.', next: session };
      }
      return {
        reply: 'Briefly describe what happened.',
        next: withState(session, 'CLAIM_DESCRIPTION', {
          policyNo: text.toUpperCase(),
        }),
      };
    }

    case 'CLAIM_DESCRIPTION': {
      if (text.length < 8) {
        return {
          reply: 'Please give a little more detail (at least a few words).',
          next: session,
        };
      }
      return {
        reply: 'Where did it happen? (area / town)',
        next: withState(session, 'CLAIM_LOCATION', { description: text }),
      };
    }

    case 'CLAIM_LOCATION': {
      if (text.length < 2) {
        return { reply: 'Please send the location.', next: session };
      }
      return {
        reply: 'Recording your claim…',
        next: withState(session, 'IDLE', {}),
        action: {
          kind: 'CREATE_CLAIM',
          policyNo: session.data.policyNo ?? '',
          description: session.data.description ?? '',
          location: text,
        },
      };
    }

    case 'TICKET_TEXT': {
      if (text.length < 5) {
        return {
          reply: 'Please describe the issue in a bit more detail.',
          next: session,
        };
      }
      return {
        reply: 'Thank you — our team will reach out shortly.',
        next: withState(session, 'IDLE', {}),
        action: { kind: 'CREATE_TICKET', text },
      };
    }

    default:
      return {
        reply: `Let's start over.\n${BOT_MENU}`,
        next: withState(session, 'IDLE', {}),
      };
  }
};
