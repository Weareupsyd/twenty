import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  EFFECT_POLICY_PDF,
  INSURANCE_POLICY,
  STAFF_POLICY_PDF,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_POLICY_PDF,
  label: 'Generate policy document (PDF)',
  shortLabel: 'Generate PDF',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: INSURANCE_POLICY,
  frontComponentUniversalIdentifier: EFFECT_POLICY_PDF,
});
