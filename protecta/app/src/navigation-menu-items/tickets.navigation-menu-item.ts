import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { SUPPORT_TICKET, TICKET } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: TICKET,
  position: 5,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: SUPPORT_TICKET,
});
