import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  CM_BENEFICIARY,
  COMMISSION,
  PERSON_COMMISSIONS,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: CM_BENEFICIARY,
  objectUniversalIdentifier: COMMISSION,
  type: FieldType.RELATION,
  name: 'beneficiary',
  label: 'Beneficiary',
  icon: 'IconUser',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: PERSON_COMMISSIONS,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'beneficiaryId',
  },
});
