import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { PARTNER, PARTNER_ACCOUNT } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: PARTNER,
  position: 7,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: PARTNER_ACCOUNT,
});
