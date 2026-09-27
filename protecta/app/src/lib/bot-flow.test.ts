import { describe, expect, it } from 'vitest';
import { handleBotTurn, startSession } from 'src/lib/bot-flow';

describe('bot menu', () => {
  it('shows the menu on greeting', () => {
    const turn = handleBotTurn(startSession(), 'hi');
    expect(turn.reply).toContain('Protecta Bode');
    expect(turn.reply).toContain('1. Buy');
  });

  it('walks the buy flow to a quote action', () => {
    let session = startSession();
    let turn = handleBotTurn(session, '1');
    expect(turn.next.state).toBe('BUY_VALUE');

    turn = handleBotTurn(turn.next, '500');
    expect(turn.next.state).toBe('BUY_VALUE');

    turn = handleBotTurn(turn.next, '5000000');
    expect(turn.next.state).toBe('BUY_PLATE');

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
    });
  });

  it('looks up 15-digit refs directly', () => {
    const turn = handleBotTurn(startSession(), '123456789012345');
    expect(turn.action).toEqual({ kind: 'LOOKUP_QUOTE', quoteRef: '123456789012345' });
  });

  it('walks the claim flow', () => {
    let turn = handleBotTurn(startSession(), '4');
    turn = handleBotTurn(turn.next, 'PB-2026-000001');
    turn = handleBotTurn(turn.next, 'Rear bumper damaged in parking');
    turn = handleBotTurn(turn.next, 'Kampala');
    expect(turn.action?.kind).toBe('CREATE_CLAIM');
  });
});
