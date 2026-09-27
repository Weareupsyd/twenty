import { defineTimelineActivityType } from 'twenty-sdk/define';
import { FC_TIMELINE_EVENT, TIMELINE_QUOTE_ISSUED } from 'src/constants/universal-identifiers';

export default defineTimelineActivityType({
  universalIdentifier: TIMELINE_QUOTE_ISSUED,
  name: 'protectaQuoteIssued',
  label: 'issued a Protecta quote',
  icon: 'IconFileText',
  frontComponentUniversalIdentifier: FC_TIMELINE_EVENT,
});
