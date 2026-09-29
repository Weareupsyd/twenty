import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { NAV_DASHBOARDS_FOLDER } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: NAV_DASHBOARDS_FOLDER,
  position: 0,
  type: NavigationMenuItemType.FOLDER,
  name: 'Dashboards',
  icon: 'IconFolder',
});
