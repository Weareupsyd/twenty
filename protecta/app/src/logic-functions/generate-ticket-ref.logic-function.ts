import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { GENERATE_TICKET_REF } from 'src/constants/universal-identifiers';
import { fillMissingRef } from 'src/lib/generate-ref';
import { CoreDbClient } from 'src/lib/records';
import { makeTicketRef } from 'src/lib/refs';

type TicketRecord = {
  id: string;
  ticketRef?: string | null;
  protectaRef?: string | null;
};

export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<TicketRecord>>,
) =>
  fillMissingRef(new CoreDbClient(), payload.properties.after, {
    objectSingular: 'supportTicket',
    refField: 'ticketRef',
    makeRef: () => makeTicketRef(),
  });

export default defineLogicFunction({
  universalIdentifier: GENERATE_TICKET_REF,
  name: 'generate-ticket-ref',
  description:
    'Assigns a ticket reference (TCK-XXXXXX) when a support ticket is created without one, e.g. from the CRM UI.',
  timeoutSeconds: 10,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'supportTicket.created',
  },
});
