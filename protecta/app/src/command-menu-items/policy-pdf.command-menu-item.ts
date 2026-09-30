import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  EFFECT_POLICY_PDF,
  INSURANCE_POLICY,
  STAFF_POLICY_PDF,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_POLICY_PDF,
  label: 'Download full policy PDF',
  shortLabel: 'Policy PDF',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: INSURANCE_POLICY,
  frontComponentUniversalIdentifier: EFFECT_POLICY_PDF,
});
