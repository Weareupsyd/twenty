import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import { PERSON_PROTECTA_KYC } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_PROTECTA_KYC,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.SELECT,
  name: 'protectaKycStatus',
  label: 'KYC status',
  icon: 'IconUserCheck',
  defaultValue: "'PENDING'",
  options: [
    { value: 'PENDING', label: 'Pending', position: 0, color: 'yellow' },
    { value: 'APPROVED', label: 'Approved', position: 1, color: 'green' },
    { value: 'REJECTED', label: 'Rejected', position: 2, color: 'red' },
  ],
});
