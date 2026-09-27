import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  C_POLICY,
  INSURANCE_CLAIM,
  INSURANCE_POLICY,
  P_CLAIMS,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: P_CLAIMS,
  objectUniversalIdentifier: INSURANCE_POLICY,
  type: FieldType.RELATION,
  name: 'claims',
  label: 'Claims',
  icon: 'IconAlertCircle',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_CLAIM,
  relationTargetFieldMetadataUniversalIdentifier: C_POLICY,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
