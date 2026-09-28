import { describe, expect, it, vi } from 'vitest';
vi.mock('src/lib/records', () => ({
  CoreDbClient: class {},
  MemoryDbClient: class {},
}));
import fillOnMessageCreated from 'src/logic-functions/fill-on-message-created.logic-function';
import sendOnQuoteCreated from 'src/logic-functions/send-on-quote-created.logic-function';
import sendOnPolicyCreated from 'src/logic-functions/send-on-policy-created.logic-function';
import sendOnClaimCreated from 'src/logic-functions/send-on-claim-created.logic-function';
import sendSmsRoute from 'src/logic-functions/send-sms-route.logic-function';

const configOf = (logicFunction: unknown) =>
  (
    logicFunction as {
      config: {
        name: string;
        databaseEventTriggerSettings?: { eventName: string };
        httpRouteTriggerSettings?: { path: string; httpMethod: string; isAuthRequired: boolean };
      };
    }
  ).config;

describe('sms triggers and routes', () => {
  it('sends on Protecta quote, policy and claim creation', () => {
    expect(configOf(sendOnQuoteCreated).databaseEventTriggerSettings).toEqual({
      eventName: 'insuranceQuote.created',
    });
    expect(configOf(sendOnPolicyCreated).databaseEventTriggerSettings).toEqual({
      eventName: 'insurancePolicy.created',
    });
    expect(configOf(sendOnClaimCreated).databaseEventTriggerSettings).toEqual({
      eventName: 'insuranceClaim.created',
    });
  });

  it('fills manually created sms message records', () => {
    expect(configOf(fillOnMessageCreated).databaseEventTriggerSettings).toEqual({
      eventName: 'smsMessage.created',
    });
  });

  it('exposes the send route', () => {
    expect(configOf(sendSmsRoute).httpRouteTriggerSettings).toEqual({
      path: '/sms/send',
      httpMethod: 'POST',
      isAuthRequired: false,
    });
  });
});
