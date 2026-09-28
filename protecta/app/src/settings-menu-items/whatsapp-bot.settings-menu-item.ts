import { defineSettingsMenuItem } from 'twenty-sdk/define';
import {
  FC_SETTINGS_TAB,
  WHATSAPP_SETTINGS_MENU,
} from 'src/constants/universal-identifiers';

export default defineSettingsMenuItem({
  universalIdentifier: WHATSAPP_SETTINGS_MENU,
  frontComponentUniversalIdentifier: FC_SETTINGS_TAB,
  title: 'WhatsApp bot',
  icon: 'IconMessage',
  // Must not share a position with protecta-settings (position 0): the sync
  // refuses two settings menu items of the same app on the same position.
  position: 1,
});
