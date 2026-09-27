import { defineView, ViewType } from 'twenty-sdk/define';
import {
  COMMISSION,
  COMMISSIONS_MONTH,
  CM_AMOUNT,
  CM_PAYOUT_REF,
  CM_POLICY_NO,
  CM_PROTECTA_REF,
  CM_RATE,
  CM_STATEMENT_MONTH,
  CM_STATUS,
  VIEW_COMMISSIONS_MONTH_COL0,
  VIEW_COMMISSIONS_MONTH_COL1,
  VIEW_COMMISSIONS_MONTH_COL2,
  VIEW_COMMISSIONS_MONTH_COL3,
  VIEW_COMMISSIONS_MONTH_COL4,
  VIEW_COMMISSIONS_MONTH_COL5,
  VIEW_COMMISSIONS_MONTH_COL6,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: COMMISSIONS_MONTH,
  name: 'Monthly commissions',
  objectUniversalIdentifier: COMMISSION,
  type: ViewType.TABLE,
  icon: 'IconCoin',
  position: 0,
  fields: [
    { universalIdentifier: VIEW_COMMISSIONS_MONTH_COL0, fieldMetadataUniversalIdentifier: CM_PROTECTA_REF, position: 0, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_COMMISSIONS_MONTH_COL1, fieldMetadataUniversalIdentifier: CM_RATE, position: 1, isVisible: true, size: 100 },
    { universalIdentifier: VIEW_COMMISSIONS_MONTH_COL2, fieldMetadataUniversalIdentifier: CM_AMOUNT, position: 2, isVisible: true, size: 150 },
    { universalIdentifier: VIEW_COMMISSIONS_MONTH_COL3, fieldMetadataUniversalIdentifier: CM_STATUS, position: 3, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_COMMISSIONS_MONTH_COL4, fieldMetadataUniversalIdentifier: CM_STATEMENT_MONTH, position: 4, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_COMMISSIONS_MONTH_COL5, fieldMetadataUniversalIdentifier: CM_PAYOUT_REF, position: 5, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_COMMISSIONS_MONTH_COL6, fieldMetadataUniversalIdentifier: CM_POLICY_NO, position: 6, isVisible: true, size: 160 },
  ],
});
