import { defineTimelineActivityType } from 'twenty-sdk/define';
import { FC_TIMELINE_EVENT, TIMELINE_CLAIM_UPDATED } from 'src/constants/universal-identifiers';

export default defineTimelineActivityType({
  universalIdentifier: TIMELINE_CLAIM_UPDATED,
  name: 'protectaClaimUpdated',
  label: 'updated a Protecta claim',
  icon: 'IconAlertCircle',
  frontComponentUniversalIdentifier: FC_TIMELINE_EVENT,
});
