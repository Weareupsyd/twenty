import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  INSURANCE_PAYMENT,
  INSURANCE_POLICY,
  P_PAYMENTS,
  PM_POLICY,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: P_PAYMENTS,
  objectUniversalIdentifier: INSURANCE_POLICY,
  type: FieldType.RELATION,
  name: 'payments',
  label: 'Payments',
  icon: 'IconCash',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_PAYMENT,
  relationTargetFieldMetadataUniversalIdentifier: PM_POLICY,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
