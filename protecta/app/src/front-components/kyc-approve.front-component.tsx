import { defineFrontComponent } from 'twenty-sdk/define';
import { EFFECT_KYC_DECISION } from 'src/constants/universal-identifiers';
import { StaffAction } from 'src/front-components/staff-action';
const Component = () => (
  <StaffAction action="kyc-approve" title="Approve KYC" />
);
export default defineFrontComponent({
  universalIdentifier: EFFECT_KYC_DECISION,
  name: 'kyc-approve',
  component: Component,
});
