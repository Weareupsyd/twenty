import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import {
  INSURANCE_POLICY,
  INSURANCE_QUOTE,
  P_QUOTE,
  Q_POLICIES,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: P_QUOTE,
  objectUniversalIdentifier: INSURANCE_POLICY,
  type: FieldType.RELATION,
  name: 'quote',
  label: 'Quote',
  icon: 'IconFileText',
  relationTargetObjectMetadataUniversalIdentifier: INSURANCE_QUOTE,
  relationTargetFieldMetadataUniversalIdentifier: Q_POLICIES,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'quoteId',
  },
});
