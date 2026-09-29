import { defineFrontComponent } from 'twenty-sdk/define';
import { FC_SETTINGS_TAB } from 'src/constants/universal-identifiers';
import { WhatsAppSettings } from 'src/front-components/whatsapp-settings';

export default defineFrontComponent({
  universalIdentifier: FC_SETTINGS_TAB,
  name: 'whatsapp-settings',
  component: WhatsAppSettings,
});
