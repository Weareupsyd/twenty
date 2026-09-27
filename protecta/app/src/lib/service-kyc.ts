import { normalizeUgPhone } from 'src/lib/phones';
import { type DbClient, type RecordData } from 'src/lib/records';
import { ensurePerson } from 'src/lib/service-quotes';

export type KycDecision = 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';

export const submitKyc = async (
  db: DbClient,
  input: {
    phone: string;
    name?: string;
    idType: string;
    idNumber: string;
    reviewNotes?: string;
  },
): Promise<{ kycCase: RecordData; person: RecordData }> => {
  const phone = normalizeUgPhone(input.phone);
  if (!phone) {
    throw new Error('A valid phone number is required.');
  }
  const idType = input.idType.trim().toUpperCase();
  if (!['NIN', 'PASSPORT', 'DRIVING_LICENCE'].includes(idType)) {
    throw new Error('idType must be NIN, PASSPORT or DRIVING_LICENCE.');
  }
  const idNumber = input.idNumber.trim();
  if (idNumber.length < 4) {
    throw new Error('A valid ID number is required.');
  }
  const { person } = await ensurePerson(db, phone, input.name);
  const kycCase = await db.create('kycCase', {
    protectaRef: `${phone}:${idNumber}`,
    idType,
    idNumber,
    status: 'PENDING',
    reviewNotes: input.reviewNotes ?? '',
    subjectId: person.id,
  });
  return { kycCase, person };
};

export const decideKyc = async (
  db: DbClient,
  kycCase: RecordData,
  decision: KycDecision,
  reviewNotes?: string,
): Promise<RecordData> => {
  const updated = await db.update('kycCase', String(kycCase.id), {
    status: decision,
    ...(typeof reviewNotes === 'string' ? { reviewNotes } : {}),
  });
  if ((decision === 'APPROVED' || decision === 'REJECTED') && kycCase.subjectId) {
    await db.update('person', String(kycCase.subjectId), {
      protectaKycStatus: decision,
    });
  }
  return updated;
};

export const findKycByPerson = async (
  db: DbClient,
  personId: string,
): Promise<RecordData[]> =>
  db.findMany('kycCases', { filter: {}, first: 100 }, [
    'idNumber',
    'idType',
    'status',
  ]).then((rows) => rows.filter((row) => row.subjectId === personId));
