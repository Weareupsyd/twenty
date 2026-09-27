import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  INSURANCE_PAYMENT,
  INSURANCE_QUOTE,
  PM_QUOTE,
  Q_PAYMENTS,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: Q_PAYMENTS,
  objectUniversalIdentifier: INSURANCE_QUOTE,
  type: FieldType.RELATION,
  name: 'payments',
  label: 'Payments',
  icon: 'IconCash',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_PAYMENT,
  relationTargetFieldMetadataUniversalIdentifier: PM_QUOTE,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
