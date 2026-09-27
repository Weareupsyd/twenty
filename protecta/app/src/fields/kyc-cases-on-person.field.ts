import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  K_SUBJECT,
  KYC_CASE,
  PERSON_KYC_CASES,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_KYC_CASES,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'kycCases',
  label: 'KYC cases',
  icon: 'IconUserCheck',
  relationTargetObjectMetadataUniversalIdentifier: KYC_CASE,
  relationTargetFieldMetadataUniversalIdentifier: K_SUBJECT,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
