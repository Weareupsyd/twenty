import { normalizeUgPhone } from 'src/lib/phones';
import { type DbClient, type RecordData } from 'src/lib/records';
import { makeTicketRef } from 'src/lib/refs';
import { ensurePerson } from 'src/lib/service-quotes';

export const createTicket = async (
  db: DbClient,
  input: {
    phone: string;
    subject: string;
    description?: string;
    channel?: string;
    priority?: string;
    rng?: () => number;
  },
): Promise<{ ticket: RecordData; person: RecordData }> => {
  const phone = normalizeUgPhone(input.phone);
  if (!phone) {
    throw new Error('A valid phone number is required.');
  }
  const subject = input.subject.trim().slice(0, 140);
  if (subject.length < 3) {
    throw new Error('A ticket subject is required.');
  }
  const { person } = await ensurePerson(db, phone);
  const ticketRef = makeTicketRef(input.rng);
  const ticket = await db.create('supportTicket', {
    protectaRef: ticketRef,
    ticketRef,
    subject,
    description: input.description?.trim() ?? subject,
    channel: input.channel ?? 'PORTAL',
    status: 'OPEN',
    priority: input.priority ?? 'NORMAL',
    requesterPhone: phone,
    requesterId: person.id,
  });
  return { ticket, person };
};
