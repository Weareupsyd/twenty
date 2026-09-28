import { describe, expect, it, vi } from 'vitest';
vi.mock('src/lib/records', () => ({ CoreDbClient: class {} }));
import generateClaimRef from 'src/logic-functions/generate-claim-ref.logic-function';
import generatePaymentRef from 'src/logic-functions/generate-payment-ref.logic-function';
import generatePolicyNo from 'src/logic-functions/generate-policy-no.logic-function';
import generateQuoteRef from 'src/logic-functions/generate-quote-ref.logic-function';
import generateTicketRef from 'src/logic-functions/generate-ticket-ref.logic-function';

const cases = [
  {
    logicFunction: generateClaimRef,
    name: 'generate-claim-ref',
    eventName: 'insuranceClaim.created',
  },
  {
    logicFunction: generatePaymentRef,
    name: 'generate-payment-ref',
    eventName: 'insurancePayment.created',
  },
  {
    logicFunction: generatePolicyNo,
    name: 'generate-policy-no',
    eventName: 'insurancePolicy.created',
  },
  {
    logicFunction: generateQuoteRef,
    name: 'generate-quote-ref',
    eventName: 'insuranceQuote.created',
  },
  {
    logicFunction: generateTicketRef,
    name: 'generate-ticket-ref',
    eventName: 'supportTicket.created',
  },
];

const configOf = (logicFunction: unknown) =>
  (
    logicFunction as {
      config: {
        name: string;
        databaseEventTriggerSettings?: { eventName: string };
      };
    }
  ).config;

describe('reference generation triggers', () => {
  it.each(cases)('$name subscribes to $eventName', ({
    logicFunction,
    name,
    eventName,
  }) => {
    const config = configOf(logicFunction);
    expect(config.name).toBe(name);
    expect(config.databaseEventTriggerSettings).toEqual({ eventName });
  });

  it('covers every object that carries a generated reference', () => {
    const events = cases
      .map((c) => configOf(c.logicFunction).databaseEventTriggerSettings?.eventName)
      .sort();
    expect(events).toEqual([
      'insuranceClaim.created',
      'insurancePayment.created',
      'insurancePolicy.created',
      'insuranceQuote.created',
      'supportTicket.created',
    ]);
  });
});
