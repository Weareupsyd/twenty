import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { INSURANCE_QUOTE, QUOTE } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: QUOTE,
  position: 0,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: INSURANCE_QUOTE,
});
