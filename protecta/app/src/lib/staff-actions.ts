import { confirmAndIssue } from 'src/lib/confirm-pipeline';
import { quotePdfDocument } from 'src/lib/conversation-docs';
import { type DbClient, type RecordData } from 'src/lib/records';
import { advanceClaim } from 'src/lib/service-claims';
import { decideKyc } from 'src/lib/service-kyc';
import { issuePolicy } from 'src/lib/service-policies';
import { renewPolicy } from 'src/lib/service-policies';
import {
  deliverWhatsAppText,
  whatsAppDocSender,
} from 'src/lib/whatsapp-transport';
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
        'plate',
        'vehicleMake',
        'vehicleModel',
        'vehicleValue',
      ],
    },
    'quote-convert': {
      object: 'insuranceQuotes',
      fields: ['reference', 'status'],
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
      await deliverWhatsAppText(
        String(record.policyholderPhone),
        quoteIssuedMessage({
          name: 'Customer',
          quoteRef: String(record.reference),
          premium: Number(record.premium),
          validUntil: String(record.validUntil),
          shareUrl: String(record.shareUrl),
        }),
      );
      // Text first, then the quote PDF: the customer sees both in the chat.
      const sendDocument = await whatsAppDocSender();
      if (sendDocument) {
        try {
          const doc = await quotePdfDocument(record, { name: 'Customer' });
          await sendDocument(String(record.policyholderPhone), doc);
        } catch (error) {
          console.error('quote-send PDF attach failed', error);
        }
      }
      return { sent: true };
    }
    case 'quote-convert': {
      if (String(record.status) === 'EXPIRED') throw new Error('Quote has expired.');
      if (String(record.status) === 'ACCEPTED') {
        const existing = await db.findFirst(
          'insurancePolicies',
          { quoteRef: { eq: String(record.reference) } },
          ['policyNo', 'status'],
        );
        if (existing) return { policyNo: existing.policyNo, alreadyConverted: true };
        throw new Error('Quote already accepted but no policy found.');
      }
      const { policy } = await issuePolicy(db, { quoteRef: String(record.reference) });
      return { policyNo: policy.policyNo };
    }
    default:
      throw new Error('Unknown staff action.');
  }
};
