import { defineFrontComponent } from 'twenty-sdk/define';
import { EFFECT_PAYMENT_CONFIRM } from 'src/constants/universal-identifiers';
import { StaffAction } from 'src/front-components/staff-action';
const Component = () => (
  <StaffAction
    action="payment-confirm"
    title="Confirm payment and issue policy"
  />
);
export default defineFrontComponent({
  universalIdentifier: EFFECT_PAYMENT_CONFIRM,
  name: 'payment-confirm',
  component: Component,
});
