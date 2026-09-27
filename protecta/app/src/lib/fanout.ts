import { enqueueJobs } from 'twenty-sdk/logic-function';
import {
  WEBHOOK_DISPATCH,
  WHATSAPP_SEND,
} from 'src/constants/universal-identifiers';
import { getQuotePartner } from 'src/lib/attribution';
import { type DbClient, type RecordData } from 'src/lib/records';
import {
  createDelivery,
  type PartnerEventName,
} from 'src/lib/service-webhooks';

export const queueWhatsApp = (to: string, text: string): Promise<unknown> =>
  enqueueJobs({
    logicFunctionUniversalIdentifier: WHATSAPP_SEND,
    jobs: [{ payload: { to, text } }],
  }).catch((error: unknown) => {
    // Notifications must never break the domain flow.
    console.error('queueWhatsApp failed', error);
    return null;
  });

/** Fan a domain event out to the attributed partner, if it has a webhook URL. */
export const fanoutPartnerEvent = async (
  db: DbClient,
  event: PartnerEventName,
  quoteRef: string,
  payload: Record<string, unknown>,
): Promise<RecordData | null> => {
  let partnerId: string | null = null;
  try {
    partnerId = await getQuotePartner(quoteRef);
  } catch (error) {
    console.error('fanout attribution lookup failed', error);
    return null;
  }
  if (!partnerId) {
    return null;
  }
  const partner = await db.findFirst(
    'partnerAccounts',
    { id: { eq: partnerId } },
    ['webhookUrl', 'isActive'],
  );
  const targetUrl = String(partner?.webhookUrl ?? '');
  if (!partner || partner.isActive === false || !targetUrl) {
    return null;
  }
  const delivery = await createDelivery(db, { partnerId, event, targetUrl });
  try {
    await enqueueJobs({
      logicFunctionUniversalIdentifier: WEBHOOK_DISPATCH,
      retryLimit: 8,
      jobs: [
        {
          jobId: `delivery-${delivery.id}`,
          payload: { deliveryId: String(delivery.id), body: payload },
        },
      ],
    });
  } catch (error) {
    console.error('fanout enqueue failed', error);
  }
  return delivery;
};
