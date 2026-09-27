import { hmacSha256Hex } from 'src/lib/crypto';
import { type DbClient, type RecordData } from 'src/lib/records';
import { makeDeliveryId } from 'src/lib/refs';

export const MAX_DELIVERY_ATTEMPTS = 8;

export type PartnerEventName =
  | 'quote.created'
  | 'payment.confirmed'
  | 'policy.issued'
  | 'claim.updated';

export const signWebhookPayload = (secret: string, body: string): string =>
  `sha256=${hmacSha256Hex(secret, body)}`;

export const createDelivery = async (
  db: DbClient,
  input: {
    partnerId?: string;
    event: PartnerEventName;
    targetUrl: string;
    rng?: () => number;
  },
): Promise<RecordData> =>
  db.create('webhookDelivery', {
    deliveryId: makeDeliveryId(input.rng),
    event: input.event,
    targetUrl: input.targetUrl,
    status: 'PENDING',
    attempts: 0,
    responseStatus: 0,
    lastError: '',
    ...(input.partnerId ? { partnerId: input.partnerId } : {}),
  });

export const markDeliverySending = (db: DbClient, delivery: RecordData): Promise<RecordData> =>
  db.update('webhookDelivery', String(delivery.id), {
    status: 'SENDING',
    attempts: Number(delivery.attempts ?? 0) + 1,
  });

export const markDeliveryResult = (
  db: DbClient,
  delivery: RecordData,
  result: { ok: boolean; status: number; error?: string },
): Promise<RecordData> =>
  db.update('webhookDelivery', String(delivery.id), {
    status: result.ok ? 'DELIVERED' : 'FAILED',
    responseStatus: result.status,
    lastError: result.error ?? '',
  });

export const requeueDelivery = (db: DbClient, delivery: RecordData): Promise<RecordData> =>
  db.update('webhookDelivery', String(delivery.id), { status: 'PENDING' });

export const shouldRetryDelivery = (delivery: RecordData): boolean =>
  String(delivery.status) === 'FAILED' &&
  Number(delivery.attempts ?? 0) < MAX_DELIVERY_ATTEMPTS;
