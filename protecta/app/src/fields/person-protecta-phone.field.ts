import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import { PERSON_PROTECTA_PHONE } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_PROTECTA_PHONE,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.TEXT,
  name: 'protectaPhone',
  label: 'Protecta phone',
  description: 'E.164 identity key used by quotes, bot and partner API',
  icon: 'IconPhone',
  isSearchable: true,
});
