import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import {
  INSURANCE_PAYMENT,
  INSURANCE_QUOTE,
  PM_QUOTE,
  Q_PAYMENTS,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PM_QUOTE,
  objectUniversalIdentifier: INSURANCE_PAYMENT,
  type: FieldType.RELATION,
  name: 'quote',
  label: 'Quote',
  icon: 'IconFileText',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_QUOTE,
  relationTargetFieldMetadataUniversalIdentifier: Q_PAYMENTS,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'quoteId',
  },
});
