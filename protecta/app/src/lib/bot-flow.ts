import { isValidPlate, normalizePlate, normalizeUgPhone } from 'src/lib/phones';

export type BotState =
  | 'IDLE'
  | 'CALC_VALUE'
  | 'CALC_OFFER'
  | 'BUY_INTENT'
  | 'BUY_VALUE'
  | 'BUY_MAKE'
  | 'BUY_MODEL'
  | 'BUY_YEAR'
  | 'BUY_PLATE'
  | 'BUY_NAME'
  | 'BUY_CONFIRM'
  | 'PAY_PHONE'
  | 'CLAIM_POLICY'
  | 'CLAIM_DESCRIPTION'
  | 'CLAIM_LOCATION'
  | 'RENEW_PICK'
  | 'TICKET_TEXT';

export type BotSession = {
  state: BotState;
  data: Record<string, string>;
  updatedAt: number;
};

export type BotAction =
  | {
      kind: 'CREATE_QUOTE';
      vehicleValue: number;
      plate: string;
      name: string;
      make?: string;
      model?: string;
      year?: number;
    }
  | { kind: 'INITIATE_PAYMENT'; quoteRef: string; phone: string }
  | {
      kind: 'CREATE_CLAIM';
      policyNo: string;
      description: string;
      location: string;
    }
  | { kind: 'CREATE_TICKET'; text: string }
  | { kind: 'LOOKUP_POLICIES' }
  | { kind: 'LOOKUP_QUOTE'; quoteRef: string }
  | { kind: 'LIST_RENEWABLE_POLICIES' }
  | { kind: 'RENEW_POLICY'; policyNo: string };

export type BotTurn = {
  reply: string;
  next: BotSession;
  action?: BotAction;
};

export const BOT_MENU_ITEMS = [
  { id: '1', label: 'Calculate premium' },
  { id: '2', label: 'Get cover (onboard)' },
  { id: '3', label: 'My policies' },
  { id: '4', label: 'Pay for a quote' },
  { id: '5', label: 'Report a claim' },
  { id: '6', label: 'Talk to support' },
] as const;

export const BOT_MENU = BOT_MENU_ITEMS.map((i) => `${i.id}. ${i.label}`).join('\n');

export const buildBotMenu = (
  customMenu?: { id: string; label: string; enabled?: boolean }[],
  welcome?: string,
): string => {
  const items =
    customMenu && customMenu.length > 0
      ? customMenu.filter((m) => m.enabled !== false)
      : BOT_MENU_ITEMS;
  const lines = items.map((i) => `${i.id}. ${i.label}`).join('\n');
  return welcome ? `${welcome}\n${lines}` : lines;
};

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

const yes = (text: string): boolean =>
  ['yes', 'y', 'ok', 'proceed'].includes(text.trim().toLowerCase());

const firstNameOf = (name: string): string =>
  name.trim().split(/\s+/)[0] ?? '';

const coverConfirmTurn = (
  session: BotSession,
  args: { plate: string; name: string },
  rate: number,
): BotTurn => {
  const value = Number(session.data.vehicleValue);
  const premium = Math.round(value * rate);
  return {
    reply: [
      'Confirm your cover:',
      `• Name: ${args.name}`,
      `• Vehicle: ${session.data.year ?? ''} ${session.data.make ?? ''} ${session.data.model ?? ''}`.trim(),
      `• Plate: ${args.plate}`,
      `• Value: UGX ${value.toLocaleString('en-US')}`,
      `• Premium: UGX ${premium.toLocaleString('en-US')}`,
      '',
      'Reply YES to confirm or NO to restart.',
    ].join('\n'),
    next: withState(session, 'BUY_CONFIRM', {
      plate: args.plate,
      name: args.name,
    }),
  };
};

const moneyReply = (value: number, rate: number): string => {
  const premium = Math.round(value * rate);
  const percent = `${(rate * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  return [
    `Car value: UGX ${value.toLocaleString('en-US')}`,
    `Annual premium: UGX ${premium.toLocaleString('en-US')} (${percent})`,
    'Cover: car body, third party and driver.',
    '',
    'Reply YES to get this cover, or MENU.',
  ].join('\n');
};

export const startSession = (): BotSession => emptySession();

const menuTurn = (session: BotSession, intro?: string, customMenu?: { id: string; label: string; enabled?: boolean }[], welcome?: string): BotTurn => ({
  reply: `${intro ? `${intro}\n` : ''}*${welcome || 'Protecta Bode'}*\n${buildBotMenu(customMenu, undefined)}\n\nReply with a number.`,
  next: withState(session, 'IDLE', {}),
});

const idleCommand = (text: string): string => {
  const value = text.trim().toLowerCase();
  if (value === '1' || value.includes('calc') || value.includes('premium')) {
    return '1';
  }
  if (
    value === '2' ||
    value.includes('cover') ||
    value.includes('buy') ||
    value.includes('onboard')
  ) {
    return '2';
  }
  if (value === '3' || value.includes('polic')) {
    return '3';
  }
  if (value === '4' || value === 'pay') {
    return '4';
  }
  if (value === '5' || value.includes('claim')) {
    return '5';
  }
  if (value === '6' || value.includes('support') || value === 'help') {
    return '6';
  }
  return value;
};

/**
 * Same jobs as the website: calculate a 1.5% premium, then onboard
 * (make, model, year, plate, name) and hand payment to the quote page.
 *
 * When `options.customer` is set (the WhatsApp number is already
 * registered), onboarding greets the returning customer by name and
 * skips the name question — and offers renewing an existing policy.
 */
export const handleBotTurn = (
  session: BotSession,
  rawText: string,
  options: {
    minValue?: number;
    maxValue?: number;
    rate?: number;
    customer?: { name: string };
    botMenu?: { id: string; label: string; enabled?: boolean }[];
    welcomeMessage?: string;
  } = {},
): BotTurn => {
  const text = rawText.trim();
  const minValue = options.minValue ?? 1_000_000;
  const maxValue = options.maxValue ?? 300_000_000;
  const rate = options.rate ?? 0.015;
  const knownName = options.customer?.name.trim() ?? '';

  if (isMenuCommand(text)) {
    return menuTurn(session, undefined, options.botMenu, options.welcomeMessage);
  }

  switch (session.state) {
    case 'IDLE': {
      const command = idleCommand(text);
      if (command === '1') {
        return {
          reply: `Premium calculator — same 1.5% as the website.\nWhat is the market value of the vehicle in UGX? (${(minValue / 1_000_000).toLocaleString('en-US')}M – ${(maxValue / 1_000_000).toLocaleString('en-US')}M)`,
          next: withState(session, 'CALC_VALUE'),
        };
      }
      if (command === '2') {
        if (knownName) {
          return {
            reply: [
              `Welcome back, ${firstNameOf(knownName)}.`,
              '',
              '1. Cover another car',
              '2. Renew a policy',
              '',
              'Reply with a number.',
            ].join('\n'),
            next: withState(session, 'BUY_INTENT'),
          };
        }
        return {
          reply: 'Let’s get you covered. What is the market value of the vehicle in UGX?',
          next: withState(session, 'BUY_VALUE'),
        };
      }
      if (command === '3') {
        return {
          reply: 'Looking up your policies…',
          next: withState(session, 'IDLE'),
          action: { kind: 'LOOKUP_POLICIES' },
        };
      }
      if (command === '4') {
        return {
          reply: 'Send the quote reference (15 digits).',
          next: withState(session, 'PAY_PHONE'),
        };
      }
      if (command === '5') {
        return {
          reply: 'Sorry to hear that. What is the policy number?',
          next: withState(session, 'CLAIM_POLICY'),
        };
      }
      if (command === '6') {
        return {
          reply: 'Describe your issue in one message and our team will respond.',
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
      return menuTurn(session, "I didn't get that.", options.botMenu, options.welcomeMessage);
    }

    case 'CALC_VALUE': {
      const value = parseMoney(text);
      if (value === null || value < minValue || value > maxValue) {
        return {
          reply: `Enter a value between UGX ${minValue.toLocaleString('en-US')} and UGX ${maxValue.toLocaleString('en-US')} (numbers only).`,
          next: session,
        };
      }
      return {
        reply: moneyReply(value, rate),
        next: withState(session, 'CALC_OFFER', { vehicleValue: String(value) }),
      };
    }

    case 'CALC_OFFER': {
      if (yes(text)) {
        return {
          reply: 'What is the make? (e.g. Toyota)',
          next: withState(session, 'BUY_MAKE'),
        };
      }
      return menuTurn(session, 'Calculator closed.', options.botMenu, options.welcomeMessage);
    }

    case 'BUY_INTENT': {
      const choice = text.trim();
      if (choice === '1') {
        return {
          reply: 'Let’s get your next car covered. What is the market value of the vehicle in UGX?',
          next: withState(session, 'BUY_VALUE'),
        };
      }
      if (choice === '2') {
        return {
          reply: 'Looking up your policies…',
          next: withState(session, 'RENEW_PICK'),
          action: { kind: 'LIST_RENEWABLE_POLICIES' },
        };
      }
      return {
        reply: 'Reply 1 to cover another car or 2 to renew a policy.',
        next: session,
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
        reply: `${moneyReply(value, rate)}\n\nWhat is the make? (e.g. Toyota)`,
        next: withState(session, 'BUY_MAKE', { vehicleValue: String(value) }),
      };
    }

    case 'BUY_MAKE': {
      if (text.replace(/\s/g, '').length < 2) {
        return { reply: 'Enter the make, e.g. Toyota.', next: session };
      }
      return {
        reply: 'What is the model? (e.g. Premio)',
        next: withState(session, 'BUY_MODEL', { make: text }),
      };
    }

    case 'BUY_MODEL': {
      if (text.length < 1) {
        return { reply: 'Enter the model.', next: session };
      }
      return {
        reply: 'Year of manufacture? (e.g. 2018)',
        next: withState(session, 'BUY_YEAR', { model: text }),
      };
    }

    case 'BUY_YEAR': {
      const year = Number(text.replace(/[^0-9]/g, ''));
      const maxYear = new Date().getFullYear() + 1;
      if (!Number.isInteger(year) || year < 1985 || year > maxYear) {
        return {
          reply: `Enter a year between 1985 and ${maxYear}.`,
          next: session,
        };
      }
      return {
        reply: 'What is the number plate? (e.g. UAX 123C)',
        next: withState(session, 'BUY_PLATE', { year: String(year) }),
      };
    }

    case 'BUY_PLATE': {
      if (!isValidPlate(text)) {
        return {
          reply: 'That plate looks invalid. Try again, e.g. UAX 123C.',
          next: session,
        };
      }
      const plate = normalizePlate(text);
      // Returning customers are recognised by their WhatsApp number, so
      // their registered name is used and the name question is skipped.
      if (knownName) {
        return coverConfirmTurn(session, { plate, name: knownName }, rate);
      }
      return {
        reply: 'What is your full name?',
        next: withState(session, 'BUY_NAME', { plate }),
      };
    }

    case 'BUY_NAME': {
      if (text.replace(/\s/g, '').length < 3) {
        return { reply: 'Please send your full name.', next: session };
      }
      return coverConfirmTurn(
        session,
        { plate: session.data.plate ?? '', name: text },
        rate,
      );
    }

    case 'BUY_CONFIRM': {
      if (yes(text)) {
        const year = Number(session.data.year);
        return {
          reply: 'Creating your quote…',
          next: withState(session, 'IDLE', {}),
          action: {
            kind: 'CREATE_QUOTE',
            vehicleValue: Number(session.data.vehicleValue),
            plate: session.data.plate ?? '',
            name: session.data.name ?? '',
            make: session.data.make,
            model: session.data.model,
            ...(Number.isInteger(year) ? { year } : {}),
          },
        };
      }
      return menuTurn(session, 'Restarted.', options.botMenu, options.welcomeMessage);
    }

    case 'PAY_PHONE': {
      if (/^\d{15}$/.test(text)) {
        return {
          reply: 'Which mobile-money number should we use? (e.g. 0701440613)',
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
            reply: 'That number looks invalid. Try 0701440613 or 256701440613.',
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

    case 'RENEW_PICK': {
      const policyNo = text.toUpperCase();
      if (policyNo.length < 4) {
        return { reply: 'Please send the full policy number.', next: session };
      }
      return {
        reply: 'Renewing your policy…',
        next: withState(session, 'IDLE', {}),
        action: { kind: 'RENEW_POLICY', policyNo },
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
      return menuTurn(session, "Let's start over.", options.botMenu, options.welcomeMessage);
  }
};
