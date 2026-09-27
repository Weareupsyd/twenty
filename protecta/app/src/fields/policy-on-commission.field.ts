import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import {
  CM_POLICY,
  COMMISSION,
  INSURANCE_POLICY,
  P_COMMISSIONS,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: CM_POLICY,
  objectUniversalIdentifier: COMMISSION,
  type: FieldType.RELATION,
  name: 'policy',
  label: 'Policy',
  icon: 'IconShieldCheck',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_POLICY,
  relationTargetFieldMetadataUniversalIdentifier: P_COMMISSIONS,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'policyId',
  },
});
