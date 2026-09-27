import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  PERSON_VEHICLES,
  V_OWNER,
  VEHICLE,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_VEHICLES,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'vehicles',
  label: 'Vehicles',
  icon: 'IconCar',
  relationTargetObjectMetadataUniversalIdentifier: VEHICLE,
  relationTargetFieldMetadataUniversalIdentifier: V_OWNER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
