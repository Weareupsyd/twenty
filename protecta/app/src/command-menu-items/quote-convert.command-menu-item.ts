import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  EFFECT_QUOTE_CONVERT,
  INSURANCE_QUOTE,
  STAFF_QUOTE_CONVERT,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_QUOTE_CONVERT,
  label: 'Convert quote to policy',
  shortLabel: 'Convert to policy',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: INSURANCE_QUOTE,
  frontComponentUniversalIdentifier: EFFECT_QUOTE_CONVERT,
});
