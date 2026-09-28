import { defineSettingsMenuItem } from 'twenty-sdk/define';
import { SETTINGS_STATUS, STATUS_TAB } from 'src/constants/universal-identifiers';

export default defineSettingsMenuItem({
  universalIdentifier: SETTINGS_STATUS,
  frontComponentUniversalIdentifier: STATUS_TAB,
  title: 'Protecta Bode',
  icon: 'IconShieldCheck',
  // Explicit so it can never collide with another item that omits position
  // (the server defaults an omitted position to 0).
  position: 0,
});
