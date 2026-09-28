import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import { PERSON_PROTECTA_OCCUPATION } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_PROTECTA_OCCUPATION,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.TEXT,
  name: 'protectaOccupation',
  label: 'Business or profession',
  description: 'Insured business or profession printed on the policy schedule',
  icon: 'IconBriefcase',
});
