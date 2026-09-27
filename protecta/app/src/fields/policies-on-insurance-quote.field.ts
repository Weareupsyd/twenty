import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  INSURANCE_POLICY,
  INSURANCE_QUOTE,
  P_QUOTE,
  Q_POLICIES,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: Q_POLICIES,
  objectUniversalIdentifier: INSURANCE_QUOTE,
  type: FieldType.RELATION,
  name: 'policies',
  label: 'Policies',
  icon: 'IconShieldCheck',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_POLICY,
  relationTargetFieldMetadataUniversalIdentifier: P_QUOTE,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
