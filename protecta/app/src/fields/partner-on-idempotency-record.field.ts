import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import {
  I_PARTNER,
  IDEMPOTENCY_RECORD,
  PA_IDEMPOTENCY,
  PARTNER_ACCOUNT,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: I_PARTNER,
  objectUniversalIdentifier: IDEMPOTENCY_RECORD,
  type: FieldType.RELATION,
  name: 'partner',
  label: 'Partner',
  icon: 'IconBuildingStore',
  relationTargetObjectMetadataUniversalIdentifier: PARTNER_ACCOUNT,
  relationTargetFieldMetadataUniversalIdentifier: PA_IDEMPOTENCY,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'partnerId',
  },
});
