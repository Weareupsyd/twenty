import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import {
  C_POLICY,
  INSURANCE_CLAIM,
  INSURANCE_POLICY,
  P_CLAIMS,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: C_POLICY,
  objectUniversalIdentifier: INSURANCE_CLAIM,
  type: FieldType.RELATION,
  name: 'policy',
  label: 'Policy',
  icon: 'IconShieldCheck',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_POLICY,
  relationTargetFieldMetadataUniversalIdentifier: P_CLAIMS,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'policyId',
  },
});
