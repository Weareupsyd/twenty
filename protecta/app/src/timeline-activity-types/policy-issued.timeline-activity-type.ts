import { defineTimelineActivityType } from 'twenty-sdk/define';
import { FC_TIMELINE_EVENT, TIMELINE_POLICY_ISSUED } from 'src/constants/universal-identifiers';

export default defineTimelineActivityType({
  universalIdentifier: TIMELINE_POLICY_ISSUED,
  name: 'protectaPolicyIssued',
  label: 'issued a Protecta policy',
  icon: 'IconShieldCheck',
  frontComponentUniversalIdentifier: FC_TIMELINE_EVENT,
});
