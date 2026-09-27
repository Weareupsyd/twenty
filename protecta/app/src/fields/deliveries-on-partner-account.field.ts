import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  PA_DELIVERIES,
  PARTNER_ACCOUNT,
  W_PARTNER,
  WEBHOOK_DELIVERY,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PA_DELIVERIES,
  objectUniversalIdentifier: PARTNER_ACCOUNT,
  type: FieldType.RELATION,
  name: 'deliveries',
  label: 'Webhook deliveries',
  icon: 'IconWebhook',
  relationTargetObjectMetadataUniversalIdentifier: WEBHOOK_DELIVERY,
  relationTargetFieldMetadataUniversalIdentifier: W_PARTNER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
