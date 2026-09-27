import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  EFFECT_CLAIM_ADVANCE,
  INSURANCE_CLAIM,
  STAFF_CLAIM_STATUS,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_CLAIM_STATUS,
  label: 'Advance claim to next stage',
  shortLabel: 'Advance claim',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: INSURANCE_CLAIM,
  frontComponentUniversalIdentifier: EFFECT_CLAIM_ADVANCE,
});
