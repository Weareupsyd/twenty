import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import {
  INSURANCE_PAYMENT,
  INSURANCE_POLICY,
  P_PAYMENTS,
  PM_POLICY,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PM_POLICY,
  objectUniversalIdentifier: INSURANCE_PAYMENT,
  type: FieldType.RELATION,
  name: 'policy',
  label: 'Policy',
  icon: 'IconShieldCheck',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_POLICY,
  relationTargetFieldMetadataUniversalIdentifier: P_PAYMENTS,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'policyId',
  },
});
