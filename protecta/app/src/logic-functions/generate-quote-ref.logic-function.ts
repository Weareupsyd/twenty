import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { GENERATE_QUOTE_REF } from 'src/constants/universal-identifiers';
import { fillMissingRef } from 'src/lib/generate-ref';
import { CoreDbClient } from 'src/lib/records';
import { makeQuoteRef } from 'src/lib/refs';

type QuoteRecord = {
  id: string;
  reference?: string | null;
  protectaRef?: string | null;
};

export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<QuoteRecord>>,
) =>
  fillMissingRef(new CoreDbClient(), payload.properties.after, {
    objectSingular: 'insuranceQuote',
    refField: 'reference',
    makeRef: () => makeQuoteRef(),
  });

export default defineLogicFunction({
  universalIdentifier: GENERATE_QUOTE_REF,
  name: 'generate-quote-ref',
  description:
    'Assigns a quote reference (15 digits) when a quote is created without one, e.g. from the CRM UI.',
  timeoutSeconds: 10,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insuranceQuote.created',
  },
});
