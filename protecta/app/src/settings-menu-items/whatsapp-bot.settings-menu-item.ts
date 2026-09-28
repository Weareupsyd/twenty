import { defineSettingsMenuItem } from 'twenty-sdk/define';
import {
  STATUS_TAB,
  WHATSAPP_SETTINGS_MENU,
} from 'src/constants/universal-identifiers';

export default defineSettingsMenuItem({
  universalIdentifier: WHATSAPP_SETTINGS_MENU,
  frontComponentUniversalIdentifier: STATUS_TAB,
  title: 'WhatsApp bot',
  icon: 'IconMessage',
  position: 0,
});
