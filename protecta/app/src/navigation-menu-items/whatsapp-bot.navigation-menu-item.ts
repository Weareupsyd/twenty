import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import {
  NAV_WHATSAPP_BOT,
  WHATSAPP_BOT_PAGE_LAYOUT,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: NAV_WHATSAPP_BOT,
  position: 0.5,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: WHATSAPP_BOT_PAGE_LAYOUT,
  name: 'WhatsApp bot',
  icon: 'IconMessageCircle',
});
