import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { CLAIM, INSURANCE_CLAIM } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: CLAIM,
  position: 3,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: INSURANCE_CLAIM,
});
