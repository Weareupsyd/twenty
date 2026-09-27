import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  EFFECT_KYC_DECISION,
  KYC_CASE,
  STAFF_KYC_DECISION,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_KYC_DECISION,
  label: 'Approve KYC case',
  shortLabel: 'Approve KYC',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: KYC_CASE,
  frontComponentUniversalIdentifier: EFFECT_KYC_DECISION,
});
