import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import { PERSON_PROTECTA_CONSENT } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_PROTECTA_CONSENT,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.BOOLEAN,
  name: 'protectaConsent',
  label: 'WhatsApp consent',
  icon: 'IconCheck',
  defaultValue: false,
});
