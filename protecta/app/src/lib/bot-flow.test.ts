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

  it('looks up 15-digit refs directly', () => {
    const turn = handleBotTurn(startSession(), '123456789012345');
    expect(turn.action).toEqual({ kind: 'LOOKUP_QUOTE', quoteRef: '123456789012345' });
  });

  it('walks the claim flow', () => {
    let turn = handleBotTurn(startSession(), '5');
    turn = handleBotTurn(turn.next, 'PB-2026-000001');
    turn = handleBotTurn(turn.next, 'Rear bumper damaged in parking');
    turn = handleBotTurn(turn.next, 'Kampala');
    expect(turn.action?.kind).toBe('CREATE_CLAIM');
  });
});
