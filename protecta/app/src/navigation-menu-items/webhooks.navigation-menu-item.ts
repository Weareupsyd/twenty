import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { WEBHOOK, WEBHOOK_DELIVERY } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: WEBHOOK,
  position: 9,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: WEBHOOK_DELIVERY,
});
