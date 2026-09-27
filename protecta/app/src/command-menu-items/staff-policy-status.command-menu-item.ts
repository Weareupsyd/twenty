import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  EFFECT_POLICY_STATUS,
  INSURANCE_POLICY,
  STAFF_POLICY_STATUS,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_POLICY_STATUS,
  label: 'Renew policy into a new quote',
  shortLabel: 'Renew policy',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: INSURANCE_POLICY,
  frontComponentUniversalIdentifier: EFFECT_POLICY_STATUS,
});
