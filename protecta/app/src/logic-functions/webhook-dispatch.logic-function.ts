import { defineLogicFunction } from 'twenty-sdk/define';
import { RetryableLogicFunctionError } from 'twenty-sdk/logic-function';
import { WEBHOOK_DISPATCH } from 'src/constants/universal-identifiers';
import { CoreDbClient } from 'src/lib/records';
import {
  markDeliveryResult,
  markDeliverySending,
  MAX_DELIVERY_ATTEMPTS,
  signWebhookPayload,
} from 'src/lib/service-webhooks';

export const approvedWebhookUrl = (
  raw: string,
  allowedOrigins: string,
): URL => {
  const url = new URL(raw);
  const allowlist = allowedOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !allowlist.includes(url.origin)
  )
    throw new Error('Webhook origin is not approved.');
  return url;
};
export const handler = async (payload: {
  deliveryId: string;
  body: Record<string, unknown>;
}) => {
  const db = new CoreDbClient();
  const delivery = await db.findFirst(
    'webhookDeliveries',
    { id: { eq: payload.deliveryId } },
    ['deliveryId', 'eventType', 'targetUrl', 'status', 'attempts', 'partnerId'],
  );
  if (!delivery) throw new Error('Delivery not found.');
  if (delivery.status === 'DELIVERED') return;
  if (Number(delivery.attempts) >= MAX_DELIVERY_ATTEMPTS)
    throw new Error('Delivery attempt limit reached.');
  const partner = await db.findFirst(
    'partnerAccounts',
    { id: { eq: delivery.partnerId } },
    ['isActive', 'webhookUrl'],
  );
  if (
    !partner ||
    partner.isActive !== true ||
    partner.webhookUrl !== delivery.targetUrl
  )
    throw new Error('Partner is inactive or webhook URL changed.');
  const secret = process.env.PARTNER_WEBHOOK_SECRET;
  if (!secret) throw new Error('Partner webhook signing is not configured.');
  const target = approvedWebhookUrl(
    String(delivery.targetUrl),
    process.env.PARTNER_WEBHOOK_ALLOWED_ORIGINS ?? '',
  );
  const sending = { ...delivery, ...(await markDeliverySending(db, delivery)) };
  const body = JSON.stringify({
    id: delivery.deliveryId,
    event: delivery.eventType,
    data: payload.body,
  });
  try {
    const response = await fetch(target, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        'X-Protecta-Signature': signWebhookPayload(secret, body),
      },
      body,
    });
    await markDeliveryResult(db, sending, {
      ok: response.ok,
      status: response.status,
    });
    if (!response.ok) throw new Error('Partner rejected the delivery.');
  } catch {
    await markDeliveryResult(db, sending, {
      ok: false,
      status: 0,
      error: 'Delivery failed. Check the receiving service.',
    });
    throw new RetryableLogicFunctionError('Partner webhook delivery failed.');
  }
};
export default defineLogicFunction({
  universalIdentifier: WEBHOOK_DISPATCH,
  name: 'webhook-dispatch',
  timeoutSeconds: 30,
  handler,
});
