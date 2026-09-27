import { defineView, ViewFilterOperand, ViewType } from 'twenty-sdk/define';
import {
  KYC_CASE,
  KYC_QUEUE,
  K_BACK_FILE,
  K_FRONT_FILE,
  K_ID_NUMBER,
  K_ID_TYPE,
  K_REVIEW_NOTES,
  K_SELFIE_FILE,
  K_STATUS,
  VFLT_KYC,
  VIEW_KYC_QUEUE_COL0,
  VIEW_KYC_QUEUE_COL1,
  VIEW_KYC_QUEUE_COL2,
  VIEW_KYC_QUEUE_COL3,
  VIEW_KYC_QUEUE_COL4,
  VIEW_KYC_QUEUE_COL5,
  VIEW_KYC_QUEUE_COL6,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: KYC_QUEUE,
  name: 'KYC review queue',
  objectUniversalIdentifier: KYC_CASE,
  type: ViewType.TABLE,
  icon: 'IconUserCheck',
  position: 0,
  fields: [
    { universalIdentifier: VIEW_KYC_QUEUE_COL0, fieldMetadataUniversalIdentifier: K_ID_NUMBER, position: 0, isVisible: true, size: 170 },
    { universalIdentifier: VIEW_KYC_QUEUE_COL1, fieldMetadataUniversalIdentifier: K_ID_TYPE, position: 1, isVisible: true, size: 140 },
    { universalIdentifier: VIEW_KYC_QUEUE_COL2, fieldMetadataUniversalIdentifier: K_STATUS, position: 2, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_KYC_QUEUE_COL3, fieldMetadataUniversalIdentifier: K_REVIEW_NOTES, position: 3, isVisible: true, size: 260 },
    { universalIdentifier: VIEW_KYC_QUEUE_COL4, fieldMetadataUniversalIdentifier: K_FRONT_FILE, position: 4, isVisible: true, size: 140 },
    { universalIdentifier: VIEW_KYC_QUEUE_COL5, fieldMetadataUniversalIdentifier: K_BACK_FILE, position: 5, isVisible: true, size: 140 },
    { universalIdentifier: VIEW_KYC_QUEUE_COL6, fieldMetadataUniversalIdentifier: K_SELFIE_FILE, position: 6, isVisible: true, size: 140 },
  ],
  filters: [
    {
      universalIdentifier: VFLT_KYC,
      fieldMetadataUniversalIdentifier: K_STATUS,
      operand: ViewFilterOperand.IS,
      value: 'NEEDS_REVIEW',
    },
  ],
});
