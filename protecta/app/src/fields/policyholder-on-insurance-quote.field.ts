import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  INSURANCE_QUOTE,
  PERSON_QUOTES,
  Q_POLICYHOLDER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: Q_POLICYHOLDER,
  objectUniversalIdentifier: INSURANCE_QUOTE,
  type: FieldType.RELATION,
  name: 'policyholder',
  label: 'Policyholder',
  icon: 'IconUser',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: PERSON_QUOTES,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'policyholderId',
  },
});
