import { defineView, ViewType } from 'twenty-sdk/define';
import {
  VIEW_WEBHOOKS_ALL_COL0,
  VIEW_WEBHOOKS_ALL_COL1,
  VIEW_WEBHOOKS_ALL_COL2,
  VIEW_WEBHOOKS_ALL_COL3,
  VIEW_WEBHOOKS_ALL_COL4,
  VIEW_WEBHOOKS_ALL_COL5,
  WEBHOOKS_ALL,
  WEBHOOK_DELIVERY,
  W_ATTEMPTS,
  W_DELIVERY_ID,
  W_EVENT,
  W_RESPONSE_STATUS,
  W_STATUS,
  W_TARGET_URL,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: WEBHOOKS_ALL,
  name: 'Webhook deliveries',
  objectUniversalIdentifier: WEBHOOK_DELIVERY,
  type: ViewType.TABLE,
  icon: 'IconWebhook',
  position: 0,
  fields: [
    { universalIdentifier: VIEW_WEBHOOKS_ALL_COL0, fieldMetadataUniversalIdentifier: W_DELIVERY_ID, position: 0, isVisible: true, size: 180 },
    { universalIdentifier: VIEW_WEBHOOKS_ALL_COL1, fieldMetadataUniversalIdentifier: W_EVENT, position: 1, isVisible: true, size: 200 },
    { universalIdentifier: VIEW_WEBHOOKS_ALL_COL2, fieldMetadataUniversalIdentifier: W_STATUS, position: 2, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_WEBHOOKS_ALL_COL3, fieldMetadataUniversalIdentifier: W_ATTEMPTS, position: 3, isVisible: true, size: 100 },
    { universalIdentifier: VIEW_WEBHOOKS_ALL_COL4, fieldMetadataUniversalIdentifier: W_RESPONSE_STATUS, position: 4, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_WEBHOOKS_ALL_COL5, fieldMetadataUniversalIdentifier: W_TARGET_URL, position: 5, isVisible: true, size: 260 },
  ],
});
