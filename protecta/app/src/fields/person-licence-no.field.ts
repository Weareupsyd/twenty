import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import { PERSON_LICENCE_NO } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_LICENCE_NO,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.TEXT,
  name: 'licenceNo',
  label: 'Licence no',
  description: 'IRA licence for agents and brokers',
  icon: 'IconCertificate',
  isSearchable: true,
});
