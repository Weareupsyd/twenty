import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import { PERSON_PROTECTA_ROLE } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_PROTECTA_ROLE,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.SELECT,
  name: 'protectaRole',
  label: 'Protecta role',
  icon: 'IconUser',
  defaultValue: "'CUSTOMER'",
  options: [
    { value: 'CUSTOMER', label: 'Customer', position: 0, color: 'blue' },
    { value: 'AGENT', label: 'Agent', position: 1, color: 'green' },
    { value: 'BROKER', label: 'Broker', position: 2, color: 'purple' },
    { value: 'STAFF', label: 'Staff', position: 3, color: 'gray' },
  ],
});
