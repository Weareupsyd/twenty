import {
  definePageLayout,
  PageLayoutTabLayoutMode,
} from 'twenty-sdk/define';
import {
  FC_SETTINGS_TAB,
  WHATSAPP_BOT_PAGE_LAYOUT,
  WHATSAPP_BOT_TAB,
  WHATSAPP_BOT_WIDGET,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: WHATSAPP_BOT_PAGE_LAYOUT,
  name: 'WhatsApp bot',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: WHATSAPP_BOT_TAB,
      title: 'Configuration',
      position: 0,
      icon: 'IconMessageCircle',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: WHATSAPP_BOT_WIDGET,
          title: 'WhatsApp bot settings',
          type: 'FRONT_COMPONENT',
          position: {
            layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
            index: 0,
          },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier: FC_SETTINGS_TAB,
          },
        },
      ],
    },
  ],
});
