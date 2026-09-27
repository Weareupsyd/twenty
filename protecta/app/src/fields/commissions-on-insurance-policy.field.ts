import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  CM_POLICY,
  COMMISSION,
  INSURANCE_POLICY,
  P_COMMISSIONS,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: P_COMMISSIONS,
  objectUniversalIdentifier: INSURANCE_POLICY,
  type: FieldType.RELATION,
  name: 'commissions',
  label: 'Commissions',
  icon: 'IconCoin',
  relationTargetObjectMetadataUniversalIdentifier: COMMISSION,
  relationTargetFieldMetadataUniversalIdentifier: CM_POLICY,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
