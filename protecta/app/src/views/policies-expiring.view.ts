import {
  defineView,
  ViewFilterOperand,
  ViewSortDirection,
  ViewType,
} from 'twenty-sdk/define';
import {
  INSURANCE_POLICY,
  POLICIES_EXPIRING,
  P_PERIOD_END,
  P_PLATE,
  P_POLICY_NO,
  P_PREMIUM,
  P_QUOTE_REF,
  P_STATUS,
  P_VEHICLE_MODEL,
  VFLT_PEXP,
  VIEW_POLICIES_EXPIRING_COL0,
  VIEW_POLICIES_EXPIRING_COL1,
  VIEW_POLICIES_EXPIRING_COL2,
  VIEW_POLICIES_EXPIRING_COL3,
  VIEW_POLICIES_EXPIRING_COL4,
  VIEW_POLICIES_EXPIRING_COL5,
  VIEW_POLICIES_EXPIRING_COL6,
  VSORT_PEXP,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: POLICIES_EXPIRING,
  name: 'Expiring soon',
  objectUniversalIdentifier: INSURANCE_POLICY,
  type: ViewType.TABLE,
  icon: 'IconAlarm',
  position: 1,
  fields: [
    { universalIdentifier: VIEW_POLICIES_EXPIRING_COL0, fieldMetadataUniversalIdentifier: P_POLICY_NO, position: 0, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_POLICIES_EXPIRING_COL1, fieldMetadataUniversalIdentifier: P_PLATE, position: 1, isVisible: true, size: 140 },
    { universalIdentifier: VIEW_POLICIES_EXPIRING_COL2, fieldMetadataUniversalIdentifier: P_PERIOD_END, position: 2, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_POLICIES_EXPIRING_COL3, fieldMetadataUniversalIdentifier: P_PREMIUM, position: 3, isVisible: true, size: 150 },
    { universalIdentifier: VIEW_POLICIES_EXPIRING_COL4, fieldMetadataUniversalIdentifier: P_STATUS, position: 4, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_POLICIES_EXPIRING_COL5, fieldMetadataUniversalIdentifier: P_QUOTE_REF, position: 5, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_POLICIES_EXPIRING_COL6, fieldMetadataUniversalIdentifier: P_VEHICLE_MODEL, position: 6, isVisible: true, size: 140 },
  ],
  filters: [
    {
      universalIdentifier: VFLT_PEXP,
      fieldMetadataUniversalIdentifier: P_STATUS,
      operand: ViewFilterOperand.IS,
      value: 'ACTIVE',
    },
  ],
  sorts: [
    {
      universalIdentifier: VSORT_PEXP,
      fieldMetadataUniversalIdentifier: P_PERIOD_END,
      direction: ViewSortDirection.ASC,
    },
  ],
});
