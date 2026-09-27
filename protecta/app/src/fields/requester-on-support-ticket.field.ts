import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  PERSON_TICKETS,
  SUPPORT_TICKET,
  T_REQUESTER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: T_REQUESTER,
  objectUniversalIdentifier: SUPPORT_TICKET,
  type: FieldType.RELATION,
  name: 'requester',
  label: 'Requester',
  icon: 'IconUser',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: PERSON_TICKETS,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'requesterId',
  },
});
