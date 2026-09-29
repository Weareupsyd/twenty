import {
  defineField,
  FieldType,
  NumberDataType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import { PERSON_COMMISSION_RATE } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_COMMISSION_RATE,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.NUMBER,
  name: 'protectaCommissionRate',
  label: 'Commission rate (fraction)',
  description:
    'Agent/broker commission as a fraction of premium (0.10 = 10%). Leave blank to use the workspace default.',
  icon: 'IconPercentage',
  universalSettings: { dataType: NumberDataType.FLOAT },
});
