import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  INSURANCE_QUOTE,
  PERSON_QUOTES,
  Q_POLICYHOLDER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_QUOTES,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'insuranceQuotes',
  label: 'Insurance quotes',
  icon: 'IconFileText',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_QUOTE,
  relationTargetFieldMetadataUniversalIdentifier: Q_POLICYHOLDER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
