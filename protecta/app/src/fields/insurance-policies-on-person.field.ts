import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  INSURANCE_POLICY,
  P_POLICYHOLDER,
  PERSON_POLICIES,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_POLICIES,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'insurancePolicies',
  label: 'Insurance policies',
  icon: 'IconShieldCheck',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_POLICY,
  relationTargetFieldMetadataUniversalIdentifier: P_POLICYHOLDER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
