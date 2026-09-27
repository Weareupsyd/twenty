import { normalizeUgPhone } from 'src/lib/phones';
import { type DbClient, type RecordData } from 'src/lib/records';
import { makeClaimRef } from 'src/lib/refs';
import { findPolicyByNo } from 'src/lib/service-policies';

const ADVANCE_MAP: Record<string, string> = {
  REPORTED: 'ASSIGNED',
  ASSIGNED: 'ASSESSED',
  APPROVED: 'SETTLED',
};

export const nextClaimStatus = (status: string): string | null =>
  ADVANCE_MAP[status] ?? null;

export const createClaim = async (
  db: DbClient,
  input: {
    policyNo: string;
    description: string;
    location?: string;
    reporterPhone: string;
    incidentDate?: string;
    rng?: () => number;
  },
): Promise<{ claim: RecordData; policy: RecordData }> => {
  const policy = await findPolicyByNo(db, input.policyNo.trim().toUpperCase());
  if (!policy) {
    throw new Error(`Policy ${input.policyNo} not found.`);
  }
  if (policy.status !== 'ACTIVE') {
    throw new Error(`Policy ${input.policyNo} is not active.`);
  }
  const phone = normalizeUgPhone(input.reporterPhone);
  if (!phone) {
    throw new Error('A valid reporter phone number is required.');
  }
  if (input.description.trim().length < 8) {
    throw new Error('Please describe what happened in a few words.');
  }
  const claimRef = makeClaimRef(input.rng);
  const claim = await db.create('insuranceClaim', {
    protectaRef: claimRef,
    claimRef,
    policyNo: policy.policyNo,
    status: 'REPORTED',
    description: input.description.trim(),
    location: input.location?.trim() ?? '',
    ...(input.incidentDate ? { incidentDate: input.incidentDate } : {}),
    reserveUgx: 0,
    reporterPhone: phone,
    policyId: policy.id,
  });
  return { claim, policy };
};

export const findClaimByRef = (db: DbClient, claimRef: string): Promise<RecordData | null> =>
  db.findFirst('insuranceClaims', { claimRef: { eq: claimRef } }, [
    'claimRef',
    'protectaRef',
    'policyNo',
    'status',
    'description',
    'location',
    'incidentDate',
    'reserveUgx',
    'reporterPhone',
  ]);

export const advanceClaim = async (
  db: DbClient,
  claim: RecordData,
): Promise<RecordData> => {
  const next = nextClaimStatus(String(claim.status));
  if (!next) {
    throw new Error(`Claim ${claim.claimRef} cannot advance from ${claim.status}.`);
  }
  return db.update('insuranceClaim', String(claim.id), { status: next });
};

export const decideClaim = async (
  db: DbClient,
  claim: RecordData,
  decision: 'APPROVED' | 'REJECTED' | 'SETTLED',
  reserveUgx?: number,
): Promise<RecordData> => {
  const status = String(claim.status);
  if (['REJECTED', 'SETTLED'].includes(status)) {
    throw new Error(`Claim ${claim.claimRef} is already ${status}.`);
  }
  return db.update('insuranceClaim', String(claim.id), {
    status: decision,
    ...(typeof reserveUgx === 'number' ? { reserveUgx } : {}),
  });
};
