import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  K_SUBJECT,
  KYC_CASE,
  PERSON_KYC_CASES,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: K_SUBJECT,
  objectUniversalIdentifier: KYC_CASE,
  type: FieldType.RELATION,
  name: 'subject',
  label: 'Subject',
  icon: 'IconUser',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: PERSON_KYC_CASES,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'subjectId',
  },
});
