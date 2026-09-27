import { defineView, ViewType } from 'twenty-sdk/define';
import {
  CLAIMS_QUEUE,
  C_CLAIM_REF,
  C_DESCRIPTION,
  C_LOCATION,
  C_POLICY_NO,
  C_REPORTER_PHONE,
  C_RESERVE,
  C_STATUS,
  INSURANCE_CLAIM,
  VIEW_CLAIMS_QUEUE_COL0,
  VIEW_CLAIMS_QUEUE_COL1,
  VIEW_CLAIMS_QUEUE_COL2,
  VIEW_CLAIMS_QUEUE_COL3,
  VIEW_CLAIMS_QUEUE_COL4,
  VIEW_CLAIMS_QUEUE_COL5,
  VIEW_CLAIMS_QUEUE_COL6,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: CLAIMS_QUEUE,
  name: 'Claims queue',
  objectUniversalIdentifier: INSURANCE_CLAIM,
  type: ViewType.TABLE,
  icon: 'IconAlertCircle',
  position: 1,
  fields: [
    { universalIdentifier: VIEW_CLAIMS_QUEUE_COL0, fieldMetadataUniversalIdentifier: C_CLAIM_REF, position: 0, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_CLAIMS_QUEUE_COL1, fieldMetadataUniversalIdentifier: C_POLICY_NO, position: 1, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_CLAIMS_QUEUE_COL2, fieldMetadataUniversalIdentifier: C_STATUS, position: 2, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_CLAIMS_QUEUE_COL3, fieldMetadataUniversalIdentifier: C_DESCRIPTION, position: 3, isVisible: true, size: 260 },
    { universalIdentifier: VIEW_CLAIMS_QUEUE_COL4, fieldMetadataUniversalIdentifier: C_LOCATION, position: 4, isVisible: true, size: 180 },
    { universalIdentifier: VIEW_CLAIMS_QUEUE_COL5, fieldMetadataUniversalIdentifier: C_RESERVE, position: 5, isVisible: true, size: 150 },
    { universalIdentifier: VIEW_CLAIMS_QUEUE_COL6, fieldMetadataUniversalIdentifier: C_REPORTER_PHONE, position: 6, isVisible: true, size: 150 },
  ],
});
