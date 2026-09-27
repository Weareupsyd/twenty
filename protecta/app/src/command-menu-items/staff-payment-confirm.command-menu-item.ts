import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  EFFECT_PAYMENT_CONFIRM,
  INSURANCE_PAYMENT,
  STAFF_PAYMENT_CONFIRM,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_PAYMENT_CONFIRM,
  label: 'Confirm payment and issue policy',
  shortLabel: 'Confirm payment',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: INSURANCE_PAYMENT,
  frontComponentUniversalIdentifier: EFFECT_PAYMENT_CONFIRM,
});
