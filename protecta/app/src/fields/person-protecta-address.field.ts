import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import { PERSON_PROTECTA_ADDRESS } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_PROTECTA_ADDRESS,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.TEXT,
  name: 'protectaAddress',
  label: 'Address',
  description: 'Insured address printed on the policy schedule',
  icon: 'IconMapPin',
  isSearchable: true,
});
