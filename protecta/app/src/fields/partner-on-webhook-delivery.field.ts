import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import {
  PA_DELIVERIES,
  PARTNER_ACCOUNT,
  W_PARTNER,
  WEBHOOK_DELIVERY,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: W_PARTNER,
  objectUniversalIdentifier: WEBHOOK_DELIVERY,
  type: FieldType.RELATION,
  name: 'partner',
  label: 'Partner',
  icon: 'IconBuildingStore',
  relationTargetObjectMetadataUniversalIdentifier: PARTNER_ACCOUNT,
  relationTargetFieldMetadataUniversalIdentifier: PA_DELIVERIES,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'partnerId',
  },
});
