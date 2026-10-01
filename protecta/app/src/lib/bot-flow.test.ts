import { describe, expect, it } from 'vitest';
import { handleBotTurn, startSession } from 'src/lib/bot-flow';

describe('bot menu', () => {
  it('shows calculate and onboard routes', () => {
    const turn = handleBotTurn(startSession(), 'hi');
    expect(turn.reply).toContain('Protecta Bode');
    expect(turn.reply).toContain('1. Calculate premium');
    expect(turn.reply).toContain('2. Get cover');
  });

  it('calculates a premium and can continue into onboarding', () => {
    let turn = handleBotTurn(startSession(), '1');
    expect(turn.next.state).toBe('CALC_VALUE');
    turn = handleBotTurn(turn.next, '262500000');
    expect(turn.reply).toContain('3,937,500');
    expect(turn.next.state).toBe('CALC_OFFER');
    turn = handleBotTurn(turn.next, 'YES');
    expect(turn.next.state).toBe('BUY_MAKE');
    expect(turn.next.data.vehicleValue).toBe('262500000');
  });

  it('walks the website onboard flow to a quote action', () => {
    let turn = handleBotTurn(startSession(), '2');
    expect(turn.next.state).toBe('BUY_VALUE');

    turn = handleBotTurn(turn.next, '500');
    expect(turn.next.state).toBe('BUY_VALUE');

    turn = handleBotTurn(turn.next, '5000000');
    expect(turn.next.state).toBe('BUY_OFFER');
    expect(turn.reply).not.toContain('What is the make?');

    turn = handleBotTurn(turn.next, 'YES');
    expect(turn.next.state).toBe('BUY_MAKE');

    turn = handleBotTurn(turn.next, 'Toyota');
    turn = handleBotTurn(turn.next, 'Premio');
    turn = handleBotTurn(turn.next, '2018');
    turn = handleBotTurn(turn.next, 'uax 123c');
    expect(turn.next.state).toBe('BUY_NAME');

    turn = handleBotTurn(turn.next, 'Jane Doe');
    expect(turn.next.state).toBe('BUY_CONFIRM');
    expect(turn.reply).toContain('75,000');

    turn = handleBotTurn(turn.next, 'YES');
    expect(turn.action).toEqual({
      kind: 'CREATE_QUOTE',
      vehicleValue: 5_000_000,
      plate: 'UAX 123C',
      name: 'Jane Doe',
      make: 'Toyota',
      model: 'Premio',
      year: 2018,
    });
  });

  it('accepts the customer’s Ugandan number formats when paying', () => {
    let turn = handleBotTurn(startSession(), '4');
    turn = handleBotTurn(turn.next, '123456789012345');
    turn = handleBotTurn(turn.next, '0701440613');
    expect(turn.action).toMatchObject({
      kind: 'INITIATE_PAYMENT',
      phone: '+256701440613',
    });
  });

  it('pays with a short 6-digit quote reference too', () => {
    let turn = handleBotTurn(startSession(), '4');
    expect(turn.reply).toContain('6-digit quote reference');
    turn = handleBotTurn(turn.next, '482913');
    expect(turn.next.data.quoteRef).toBe('482913');
    turn = handleBotTurn(turn.next, '0701440613');
    expect(turn.action).toMatchObject({
      kind: 'INITIATE_PAYMENT',
      quoteRef: '482913',
      phone: '+256701440613',
    });
  });

  it('looks up 6-digit refs directly', () => {
    const turn = handleBotTurn(startSession(), '482913');
    expect(turn.action).toEqual({ kind: 'LOOKUP_QUOTE', quoteRef: '482913' });
  });

  it('looks up legacy 15-digit refs directly', () => {
    const turn = handleBotTurn(startSession(), '123456789012345');
    expect(turn.action).toEqual({ kind: 'LOOKUP_QUOTE', quoteRef: '123456789012345' });
  });

  it('tells the customer how to return to the main menu at every question', () => {
    const menuHint = 'Reply MENU for the main menu.';
    let turn = handleBotTurn(startSession(), '1');
    expect(turn.reply).toContain(menuHint);

    turn = handleBotTurn(turn.next, 'not-a-number');
    expect(turn.reply).toContain(menuHint);

    turn = handleBotTurn(startSession(), '4');
    expect(turn.reply).toContain(menuHint);

    turn = handleBotTurn(startSession(), '5');
    expect(turn.reply).toContain(menuHint);

    turn = handleBotTurn(startSession(), '6');
    expect(turn.reply).toContain(menuHint);

    // Free-text steps accept the MENU keyword even though the answer
    // itself is prose.
    turn = handleBotTurn(startSession(), '6');
    turn = handleBotTurn(turn.next, 'MENU');
    expect(turn.next.state).toBe('IDLE');
    expect(turn.reply).toContain('1. Calculate premium');
  });

  it('walks the claim flow', () => {
    let turn = handleBotTurn(startSession(), '5');
    turn = handleBotTurn(turn.next, 'PB-2026-000001');
    turn = handleBotTurn(turn.next, 'Rear bumper damaged in parking');
    turn = handleBotTurn(turn.next, 'Kampala');
    expect(turn.action?.kind).toBe('CREATE_CLAIM');
  });

  it('keeps the cover offer and the make question in separate messages', () => {
    let turn = handleBotTurn(startSession(), '2');
    turn = handleBotTurn(turn.next, '15000000');

    expect(turn.next.state).toBe('BUY_OFFER');
    expect(turn.reply).toContain('Reply YES to get this cover, or MENU.');
    expect(turn.reply).not.toContain('What is the make?');
    expect(turn.next.data.vehicleValue).toBe('15000000');

    // Only an explicit YES starts the questions…
    turn = handleBotTurn(turn.next, 'YES');
    expect(turn.reply).toBe('What is the make? (e.g. Toyota)');
    expect(turn.next.state).toBe('BUY_MAKE');

    // …and anything else closes the offer instead of becoming the make.
    const closed = handleBotTurn(turn.next, 'MENU');
    expect(closed.next.state).toBe('IDLE');
    expect(closed.reply).toContain('Protecta Bode');
  });

  it('never stores YES as the car make', () => {
    let turn = handleBotTurn(startSession(), '2');
    turn = handleBotTurn(turn.next, '15000000');
    turn = handleBotTurn(turn.next, 'YES');
    turn = handleBotTurn(turn.next, 'Toyota');

    expect(turn.next.data.make).toBe('Toyota');
  });

  it('asks again when a session left over from the old prompt answers YES', () => {
    // A conversation saved before the messages were separated is already
    // waiting for the make when the customer replies YES.
    const stale = { ...startSession(), state: 'BUY_MAKE' as const };

    const turn = handleBotTurn(stale, 'YES');

    expect(turn.next.state).toBe('BUY_MAKE');
    expect(turn.next.data.make).toBeUndefined();
    expect(turn.reply).toContain('Reply with the car make, e.g. Toyota.');

    const answered = handleBotTurn(turn.next, 'Toyota');
    expect(answered.next.data.make).toBe('Toyota');
  });

  it('greets a returning customer and skips the name question', () => {
    const options = { customer: { name: 'Sarah Kato' } };
    let turn = handleBotTurn(startSession(), '2', options);
    expect(turn.next.state).toBe('BUY_INTENT');
    expect(turn.reply).toContain('Welcome back, Sarah.');
    expect(turn.reply).toContain('1. Cover another car');
    expect(turn.reply).toContain('2. Renew a policy');
    expect(turn.reply).not.toMatch(/\p{Extended_Pictographic}/u);

    turn = handleBotTurn(turn.next, '1', options);
    expect(turn.next.state).toBe('BUY_VALUE');
    turn = handleBotTurn(turn.next, '5000000', options);
    expect(turn.next.state).toBe('BUY_OFFER');
    turn = handleBotTurn(turn.next, 'YES', options);
    turn = handleBotTurn(turn.next, 'Toyota', options);
    turn = handleBotTurn(turn.next, 'Premio', options);
    turn = handleBotTurn(turn.next, '2018', options);
    turn = handleBotTurn(turn.next, 'UAX 123C', options);
    // The registered name is used and never asked for.
    expect(turn.next.state).toBe('BUY_CONFIRM');
    expect(turn.reply).toContain('Name: Sarah Kato');

    turn = handleBotTurn(turn.next, 'YES', options);
    expect(turn.action).toEqual({
      kind: 'CREATE_QUOTE',
      vehicleValue: 5_000_000,
      plate: 'UAX 123C',
      name: 'Sarah Kato',
      make: 'Toyota',
      model: 'Premio',
      year: 2018,
    });
  });

  it('lets a returning customer renew an existing policy', () => {
    const options = { customer: { name: 'Sarah Kato' } };
    let turn = handleBotTurn(startSession(), '2', options);
    turn = handleBotTurn(turn.next, '2', options);
    expect(turn.next.state).toBe('RENEW_PICK');
    expect(turn.action).toEqual({ kind: 'LIST_RENEWABLE_POLICIES' });

    turn = handleBotTurn(turn.next, 'pb-2026-000001', options);
    expect(turn.next.state).toBe('IDLE');
    expect(turn.action).toEqual({
      kind: 'RENEW_POLICY',
      policyNo: 'PB-2026-000001',
    });
  });

  it('rejects anything but 1 or 2 at the returning-customer choice', () => {
    const options = { customer: { name: 'Sarah Kato' } };
    let turn = handleBotTurn(startSession(), '2', options);
    turn = handleBotTurn(turn.next, 'banana', options);
    expect(turn.next.state).toBe('BUY_INTENT');
    expect(turn.reply).toContain('Reply 1 to cover another car or 2 to renew');
  });
});
