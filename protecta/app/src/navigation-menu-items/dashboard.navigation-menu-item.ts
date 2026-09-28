import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import {
  NAV_DASHBOARD,
  PROTECTA_DASHBOARD,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: NAV_DASHBOARD,
  position: 0,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: PROTECTA_DASHBOARD,
  label: 'Protecta Bode Ops',
  icon: 'IconDashboard',
});
