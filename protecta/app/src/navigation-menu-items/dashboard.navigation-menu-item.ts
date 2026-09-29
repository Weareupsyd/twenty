import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import {
  NAV_DASHBOARD,
  NAV_DASHBOARDS_FOLDER,
  PROTECTA_DASHBOARD,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: NAV_DASHBOARD,
  position: 0,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: PROTECTA_DASHBOARD,
  name: 'Protecta Bode Ops',
  icon: 'IconDashboard',
  folderUniversalIdentifier: NAV_DASHBOARDS_FOLDER,
});
