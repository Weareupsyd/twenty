import { confirmAndIssue } from 'src/lib/confirm-pipeline';
import { type DbClient, type RecordData } from 'src/lib/records';
import { advanceClaim } from 'src/lib/service-claims';
import { decideKyc } from 'src/lib/service-kyc';
import { renewPolicy } from 'src/lib/service-policies';
import { sendWhatsAppText, whatsappConfigFromEnv } from 'src/lib/whatsapp-api';
import { quoteIssuedMessage } from 'src/lib/whatsapp-text';

export const runStaffAction = async (
  db: DbClient,
  action: string,
  id: string,
): Promise<RecordData> => {
  const targets: Record<string, { object: string; fields: string[] }> = {
    'claim-advance': {
      object: 'insuranceClaims',
      fields: ['claimRef', 'status'],
    },
    'kyc-approve': { object: 'kycCases', fields: ['status', 'subjectId'] },
    'payment-confirm': {
      object: 'insurancePayments',
      fields: ['status', 'quoteRef', 'paymentRef', 'amountUgx', 'providerRef'],
    },
    'policy-renew': { object: 'insurancePolicies', fields: ['policyNo'] },
    'quote-send': {
      object: 'insuranceQuotes',
      fields: [
        'reference',
        'premium',
        'validUntil',
        'shareUrl',
        'policyholderPhone',
      ],
    },
  };
  const target = targets[action];
  if (!target) throw new Error('Unknown staff action.');
  const record = await db.findFirst(
    target.object,
    { id: { eq: id } },
    target.fields,
  );
  if (!record) throw new Error('Record not found or access denied.');
  switch (action) {
    case 'claim-advance':
      return advanceClaim(db, record);
    case 'kyc-approve':
      return decideKyc(db, record, 'APPROVED');
    case 'payment-confirm': {
      const { policy } = await confirmAndIssue(db, record);
      return { policyNo: policy.policyNo };
    }
    case 'policy-renew': {
      const { quote } = await renewPolicy(db, String(record.policyNo));
      return { reference: quote.reference };
    }
    case 'quote-send': {
      const config = whatsappConfigFromEnv();
      if (!config) throw new Error('WhatsApp is not configured.');
      await sendWhatsAppText(
        config,
        String(record.policyholderPhone),
        quoteIssuedMessage({
          name: 'Customer',
          quoteRef: String(record.reference),
          premium: Number(record.premium),
          validUntil: String(record.validUntil),
          shareUrl: String(record.shareUrl),
        }),
      );
      return { sent: true };
    }
    default:
      throw new Error('Unknown staff action.');
  }
};
