import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { INSURANCE_PAYMENT, PAYMENT } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: PAYMENT,
  position: 2,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: INSURANCE_PAYMENT,
});
