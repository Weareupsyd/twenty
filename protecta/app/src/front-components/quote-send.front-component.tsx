import { defineFrontComponent } from 'twenty-sdk/define';
import { EFFECT_WHATSAPP_SEND } from 'src/constants/universal-identifiers';
import { StaffAction } from 'src/front-components/staff-action';
const Component = () => (
  <StaffAction action="quote-send" title="Send quote on WhatsApp" />
);
export default defineFrontComponent({
  universalIdentifier: EFFECT_WHATSAPP_SEND,
  name: 'quote-send',
  component: Component,
});
