import { defineTimelineActivityType } from 'twenty-sdk/define';
import { FC_TIMELINE_EVENT, TIMELINE_PAYMENT_CONFIRMED } from 'src/constants/universal-identifiers';

export default defineTimelineActivityType({
  universalIdentifier: TIMELINE_PAYMENT_CONFIRMED,
  name: 'protectaPaymentConfirmed',
  label: 'confirmed a Protecta payment',
  icon: 'IconCash',
  frontComponentUniversalIdentifier: FC_TIMELINE_EVENT,
});
