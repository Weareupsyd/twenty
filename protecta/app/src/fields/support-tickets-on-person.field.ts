import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  PERSON_TICKETS,
  SUPPORT_TICKET,
  T_REQUESTER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_TICKETS,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'supportTickets',
  label: 'Support tickets',
  icon: 'IconMessage',
  relationTargetObjectMetadataUniversalIdentifier: SUPPORT_TICKET,
  relationTargetFieldMetadataUniversalIdentifier: T_REQUESTER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
