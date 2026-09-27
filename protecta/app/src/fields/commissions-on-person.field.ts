import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  CM_BENEFICIARY,
  COMMISSION,
  PERSON_COMMISSIONS,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_COMMISSIONS,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'commissions',
  label: 'Commissions',
  icon: 'IconCoin',
  relationTargetObjectMetadataUniversalIdentifier: COMMISSION,
  relationTargetFieldMetadataUniversalIdentifier: CM_BENEFICIARY,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
