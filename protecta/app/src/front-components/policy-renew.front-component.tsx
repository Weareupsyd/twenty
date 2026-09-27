import { defineFrontComponent } from 'twenty-sdk/define';
import { EFFECT_POLICY_STATUS } from 'src/constants/universal-identifiers';
import { StaffAction } from 'src/front-components/staff-action';
const Component = () => (
  <StaffAction action="policy-renew" title="Create renewal quote" />
);
export default defineFrontComponent({
  universalIdentifier: EFFECT_POLICY_STATUS,
  name: 'policy-renew',
  component: Component,
});
