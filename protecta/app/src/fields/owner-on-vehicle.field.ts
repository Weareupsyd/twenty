import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  PERSON_VEHICLES,
  V_OWNER,
  VEHICLE,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: V_OWNER,
  objectUniversalIdentifier: VEHICLE,
  type: FieldType.RELATION,
  name: 'owner',
  label: 'Owner',
  icon: 'IconUser',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: PERSON_VEHICLES,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'ownerId',
  },
});
