import { defineView, ViewFilterOperand, ViewType } from 'twenty-sdk/define';
import {
  INSURANCE_PAYMENT,
  PAYMENTS_PENDING,
  PM_AMOUNT,
  PM_PAYER_PHONE,
  PM_PAYMENT_REF,
  PM_PROVIDER,
  PM_PROVIDER_REF,
  PM_QUOTE_REF,
  PM_STATUS,
  VFLT_RECON,
  VIEW_PAYMENTS_PENDING_COL0,
  VIEW_PAYMENTS_PENDING_COL1,
  VIEW_PAYMENTS_PENDING_COL2,
  VIEW_PAYMENTS_PENDING_COL3,
  VIEW_PAYMENTS_PENDING_COL4,
  VIEW_PAYMENTS_PENDING_COL5,
  VIEW_PAYMENTS_PENDING_COL6,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: PAYMENTS_PENDING,
  name: 'Pending payments',
  objectUniversalIdentifier: INSURANCE_PAYMENT,
  type: ViewType.TABLE,
  icon: 'IconCash',
  position: 0,
  fields: [
    { universalIdentifier: VIEW_PAYMENTS_PENDING_COL0, fieldMetadataUniversalIdentifier: PM_PAYMENT_REF, position: 0, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_PAYMENTS_PENDING_COL1, fieldMetadataUniversalIdentifier: PM_QUOTE_REF, position: 1, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_PAYMENTS_PENDING_COL2, fieldMetadataUniversalIdentifier: PM_PROVIDER, position: 2, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_PAYMENTS_PENDING_COL3, fieldMetadataUniversalIdentifier: PM_AMOUNT, position: 3, isVisible: true, size: 150 },
    { universalIdentifier: VIEW_PAYMENTS_PENDING_COL4, fieldMetadataUniversalIdentifier: PM_PAYER_PHONE, position: 4, isVisible: true, size: 150 },
    { universalIdentifier: VIEW_PAYMENTS_PENDING_COL5, fieldMetadataUniversalIdentifier: PM_STATUS, position: 5, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_PAYMENTS_PENDING_COL6, fieldMetadataUniversalIdentifier: PM_PROVIDER_REF, position: 6, isVisible: true, size: 180 },
  ],
  filters: [
    {
      universalIdentifier: VFLT_RECON,
      fieldMetadataUniversalIdentifier: PM_STATUS,
      operand: ViewFilterOperand.IS,
      value: 'PENDING',
    },
  ],
});
