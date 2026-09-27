import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  EFFECT_WHATSAPP_SEND,
  INSURANCE_QUOTE,
  STAFF_WHATSAPP_SEND,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_WHATSAPP_SEND,
  label: 'Send quote on WhatsApp',
  shortLabel: 'Send quote',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: INSURANCE_QUOTE,
  frontComponentUniversalIdentifier: EFFECT_WHATSAPP_SEND,
});
