import { defineSettingsMenuItem } from 'twenty-sdk/define';
import { SETTINGS_STATUS, STATUS_TAB } from 'src/constants/universal-identifiers';

export default defineSettingsMenuItem({
  universalIdentifier: SETTINGS_STATUS,
  frontComponentUniversalIdentifier: STATUS_TAB,
  title: 'Protecta Bode',
  icon: 'IconShieldCheck',
});
