import { defineView, ViewType } from 'twenty-sdk/define';
import {
  PARTNERS_ALL,
  PARTNER_ACCOUNT,
  PA_CLIENT_ID,
  PA_COMMISSION_RATE,
  PA_ENVIRONMENT,
  PA_IS_ACTIVE,
  PA_SCOPES,
  PA_WEBHOOK_URL,
  VIEW_PARTNERS_ALL_COL0,
  VIEW_PARTNERS_ALL_COL1,
  VIEW_PARTNERS_ALL_COL2,
  VIEW_PARTNERS_ALL_COL3,
  VIEW_PARTNERS_ALL_COL4,
  VIEW_PARTNERS_ALL_COL5,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: PARTNERS_ALL,
  name: 'All partners',
  objectUniversalIdentifier: PARTNER_ACCOUNT,
  type: ViewType.TABLE,
  icon: 'IconBuildingStore',
  position: 0,
  fields: [
    { universalIdentifier: VIEW_PARTNERS_ALL_COL0, fieldMetadataUniversalIdentifier: PA_CLIENT_ID, position: 0, isVisible: true, size: 180 },
    { universalIdentifier: VIEW_PARTNERS_ALL_COL1, fieldMetadataUniversalIdentifier: PA_ENVIRONMENT, position: 1, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_PARTNERS_ALL_COL2, fieldMetadataUniversalIdentifier: PA_COMMISSION_RATE, position: 2, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_PARTNERS_ALL_COL3, fieldMetadataUniversalIdentifier: PA_IS_ACTIVE, position: 3, isVisible: true, size: 100 },
    { universalIdentifier: VIEW_PARTNERS_ALL_COL4, fieldMetadataUniversalIdentifier: PA_WEBHOOK_URL, position: 4, isVisible: true, size: 260 },
    { universalIdentifier: VIEW_PARTNERS_ALL_COL5, fieldMetadataUniversalIdentifier: PA_SCOPES, position: 5, isVisible: true, size: 220 },
  ],
});
