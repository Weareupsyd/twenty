import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { INSURANCE_POLICY, POLICY } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: POLICY,
  position: 1,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: INSURANCE_POLICY,
});
