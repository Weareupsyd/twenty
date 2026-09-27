import { defineObject, FieldType, NumberDataType } from 'twenty-sdk/define';
import {
  WEBHOOK_DELIVERY,
  W_ATTEMPTS,
  W_DELIVERY_ID,
  W_EVENT,
  W_LAST_ERROR,
  W_RESPONSE_STATUS,
  W_STATUS,
  W_TARGET_URL,
} from 'src/constants/universal-identifiers';

export const WEBHOOK_DELIVERY_UNIVERSAL_IDENTIFIER = WEBHOOK_DELIVERY;

export default defineObject({
  universalIdentifier: WEBHOOK_DELIVERY_UNIVERSAL_IDENTIFIER,
  nameSingular: 'webhookDelivery',
  namePlural: 'webhookDeliveries',
  labelSingular: 'Webhook delivery',
  labelPlural: 'Webhook deliveries',
  description: 'Outbound partner webhook attempt log',
  icon: 'IconWebhook',
  labelIdentifierFieldMetadataUniversalIdentifier: W_DELIVERY_ID,
  fields: [
    {
      universalIdentifier: W_DELIVERY_ID,
      name: 'deliveryId',
      type: FieldType.TEXT,
      label: 'Delivery id',
      icon: 'IconHash',
      isSearchable: true,
    },
    {
      universalIdentifier: W_EVENT,
      name: 'eventType',
      type: FieldType.TEXT,
      label: 'Event',
      icon: 'IconBolt',
      isSearchable: true,
    },
    {
      universalIdentifier: W_TARGET_URL,
      name: 'targetUrl',
      type: FieldType.TEXT,
      label: 'Target URL',
      icon: 'IconLink',
    },
    {
      universalIdentifier: W_STATUS,
      name: 'status',
      type: FieldType.SELECT,
      label: 'Status',
      icon: 'IconProgress',
      defaultValue: "'PENDING'",
      options: [
        { value: 'PENDING', label: 'Pending', position: 0, color: 'yellow' },
        { value: 'SENDING', label: 'Sending', position: 1, color: 'blue' },
        { value: 'DELIVERED', label: 'Delivered', position: 2, color: 'green' },
        { value: 'FAILED', label: 'Failed', position: 3, color: 'red' },
      ],
    },
    {
      universalIdentifier: W_ATTEMPTS,
      name: 'attempts',
      type: FieldType.NUMBER,
      label: 'Attempts',
      icon: 'IconRepeat',
      universalSettings: { dataType: NumberDataType.INT },
    },
    {
      universalIdentifier: W_RESPONSE_STATUS,
      name: 'responseStatus',
      type: FieldType.NUMBER,
      label: 'Response status',
      icon: 'IconHash',
      universalSettings: { dataType: NumberDataType.INT },
    },
    {
      universalIdentifier: W_LAST_ERROR,
      name: 'lastError',
      type: FieldType.TEXT,
      label: 'Last error',
      icon: 'IconAlertCircle',
    },
  ],
});
