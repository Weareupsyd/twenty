import { defineFrontComponent } from 'twenty-sdk/define';
import { EFFECT_CLAIM_ADVANCE } from 'src/constants/universal-identifiers';
import { StaffAction } from 'src/front-components/staff-action';
const Component = () => (
  <StaffAction action="claim-advance" title="Advance claim" />
);
export default defineFrontComponent({
  universalIdentifier: EFFECT_CLAIM_ADVANCE,
  name: 'claim-advance',
  component: Component,
});
