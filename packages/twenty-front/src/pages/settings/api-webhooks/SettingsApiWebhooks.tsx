import { NavigationButton } from '@/ui/input/components/NavigationButton';

import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { SettingsTabBar } from '@/settings/components/layout/SettingsTabBar';
import { useSettingsActiveTabId } from '@/settings/components/layout/useSettingsActiveTabId';
import { SettingsDiscoveryHeroCard } from '@/settings/components/SettingsDiscoveryHeroCard';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsApiKeysTable } from '@/settings/developers/components/SettingsApiKeysTable';
import { SettingsWebhooksTable } from '@/settings/developers/components/SettingsWebhooksTable';
import PlaygroundCoverDark from '@/settings/mcp-and-apis/assets/cover-dark.png';
import PlaygroundCoverLight from '@/settings/mcp-and-apis/assets/cover-light.png';
import McpCoverDark from '@/settings/mcp-and-apis/assets/mcp-cover-dark.png';
import McpCoverLight from '@/settings/mcp-and-apis/assets/mcp-cover-light.png';
import { PlaygroundSetupForm } from '@/settings/mcp-and-apis/components/PlaygroundSetupForm';
import { SettingsMcpSetup } from '@/settings/mcp-and-apis/components/SettingsMcpSetup';
import { useIsMobile } from 'twenty-ui/utilities';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Section } from 'twenty-ui/components';
import {
  IconApi,
  IconBrandWhatsapp,
  IconCopy,
  IconPlus,
  IconSparkle2,
  IconSparkles,
  IconWebhook,
} from 'twenty-ui/icon';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme';
import { SETTINGS_API_WEBHOOKS_TABS } from '~/pages/settings/api-webhooks/constants/SettingsApiWebhooksTabs';
import { Button } from 'twenty-ui/input';

type TabKey =
  (typeof SETTINGS_API_WEBHOOKS_TABS.TABS_IDS)[keyof typeof SETTINGS_API_WEBHOOKS_TABS.TABS_IDS];

const SETTINGS_API_HERO_INSTANCE_ID_PREFIX = 'settings-api-hero';

const StyledButtonContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: ${themeCssVariables.spacing[2]};
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    padding-top: ${themeCssVariables.spacing[5]};
  }
`;

const StyledTabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[10]};
  padding-top: ${themeCssVariables.spacing[6]};
`;

const StyledTableContainer = styled.div<{ isMobile?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  overflow: ${({ isMobile }) => (isMobile ? 'hidden' : 'visible')};
`;

export const SettingsApiWebhooks = () => {
  const isMobile = useIsMobile();
  const { t } = useLingui();

  const tabs = [
    {
      id: SETTINGS_API_WEBHOOKS_TABS.TABS_IDS.MCP,
      title: t`MCP`,
      Icon: IconSparkles,
    },
    {
      id: SETTINGS_API_WEBHOOKS_TABS.TABS_IDS.API,
      title: t`API`,
      Icon: IconApi,
    },
    {
      id: SETTINGS_API_WEBHOOKS_TABS.TABS_IDS.WEBHOOKS,
      title: t`Webhooks`,
      Icon: IconWebhook,
    },
  ];

  const activeTab: TabKey =
    (useSettingsActiveTabId(
      SETTINGS_API_WEBHOOKS_TABS.COMPONENT_INSTANCE_ID,
      tabs.map((tab) => tab.id),
    ) as TabKey) ?? SETTINGS_API_WEBHOOKS_TABS.TABS_IDS.MCP;

  const isMcpTab = activeTab === SETTINGS_API_WEBHOOKS_TABS.TABS_IDS.MCP;

  return (
    <SettingsPageLayout
      title={t`MCP & APIs`}
      secondaryBar={
        <SettingsTabBar
          aria-label={t`APIs and webhooks`}
          tabs={tabs}
          componentInstanceId={SETTINGS_API_WEBHOOKS_TABS.COMPONENT_INSTANCE_ID}
        />
      }
      links={[
        {
          children: t`Workspace`,
          href: getSettingsPath(SettingsPath.General),
        },
        { children: t`MCP & APIs` },
      ]}
    >
      <SettingsPageContainer>
        <Section.Root>
          <SettingsDiscoveryHeroCard
            lightSrc={isMcpTab ? McpCoverLight : PlaygroundCoverLight}
            darkSrc={isMcpTab ? McpCoverDark : PlaygroundCoverDark}
            instanceIdPrefix={SETTINGS_API_HERO_INSTANCE_ID_PREFIX}
            tabs={[
              {
                id: 'api_webhook_walkthrough',
                title: t`Walkthrough`,
                Icon: IconSparkle2,
                vimeoId: '1217967646',
                hasSound: true,
              },
            ]}
            playButtonAriaLabel={t`Watch API demo`}
          />
        </Section.Root>

        {activeTab === SETTINGS_API_WEBHOOKS_TABS.TABS_IDS.API && (
          <StyledTabContent>
            <Section.Root>
              <Section.Header
                title={t`Documentation`}
                description={t`Try our REST or GraphQL API playgrounds`}
              />
              <PlaygroundSetupForm />
            </Section.Root>

            <Section.Root>
              <Section.Header
                title={t`API Keys`}
                description={t`Active API keys created by you or your team.`}
              />
              <StyledTableContainer isMobile={isMobile}>
                <SettingsApiKeysTable />
                <StyledButtonContainer>
                  <NavigationButton
                    startIcon={<IconPlus />}
                    size="sm"
                    to={getSettingsPath(SettingsPath.NewApiKey)}
                    variant="outline"
                  >{t`Create API key`}</NavigationButton>
                </StyledButtonContainer>
              </StyledTableContainer>
            </Section.Root>
          </StyledTabContent>
        )}

        {activeTab === SETTINGS_API_WEBHOOKS_TABS.TABS_IDS.MCP && (
          <StyledTabContent>
            <SettingsMcpSetup />
          </StyledTabContent>
        )}

        {activeTab === SETTINGS_API_WEBHOOKS_TABS.TABS_IDS.WEBHOOKS && (
          <StyledTabContent>
            <Section.Root>
              <Section.Header
                title={t`Protecta Bode — WhatsApp inbound webhook (Evolution API)`}
                description={t`Default webhook that Evolution API must POST WhatsApp messages to. Seeded in Twenty CRM as EVOLUTION_WEBHOOK_URL + PUBLIC_BASE_URL.`}
              />
              <div
                style={{
                  border: `1px solid ${themeCssVariables.border.color.strong}`,
                  borderRadius: 8,
                  padding: themeCssVariables.spacing[4],
                  background: themeCssVariables.background.secondary,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: themeCssVariables.spacing[3],
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconBrandWhatsapp size={20} />
                  <strong>Default (production):</strong>
                  <code style={{ flex: 1, padding: '4px 8px', background: themeCssVariables.background.primary, borderRadius: 4, border: `1px solid ${themeCssVariables.border.color.strong}` }}>
                    https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook
                  </code>
                  <Button
                    variant="secondary"
                    size="small"
                    Icon={IconCopy}
                    onClick={() => {
                      navigator.clipboard.writeText('https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook');
                    }}
                    title={t`Copy`}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconWebhook size={20} />
                  <strong>Current host:</strong>
                  <code style={{ flex: 1, padding: '4px 8px', background: themeCssVariables.background.primary, borderRadius: 4, border: `1px solid ${themeCssVariables.border.color.strong}` }}>
                    {typeof window !== 'undefined' ? `${window.location.origin}/s/protecta/whatsapp/webhook` : '/s/protecta/whatsapp/webhook'}
                  </code>
                  <Button
                    variant="secondary"
                    size="small"
                    Icon={IconCopy}
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        navigator.clipboard.writeText(`${window.location.origin}/s/protecta/whatsapp/webhook`);
                      }
                    }}
                    title={t`Copy`}
                  />
                </div>
                <div style={{ fontSize: 13, color: themeCssVariables.font.color.secondary, lineHeight: 1.5 }}>
                  <div><strong>Seeded in Twenty CRM:</strong> Application variable <code>EVOLUTION_WEBHOOK_URL</code> = <code>https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook</code> and <code>PUBLIC_BASE_URL</code> = <code>https://protectabode.weareupsyd.com</code> (see Settings → Apps → Protecta Bode → Variables). Also available via <code>/s/protecta/health</code> and <code>/s/protecta/settings/whatsapp</code>.</div>
                  <div style={{ marginTop: 8 }}><strong>Evolution API setup:</strong> <code>POST /webhook/set/{'{instance}'}</code> with <code>{'{\"webhook\":{\"enabled\":true,\"url\":\"https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook\",\"events\":[\"MESSAGES_UPSERT\"]}}'}</code></div>
                  <div style={{ marginTop: 8 }}><strong>Auto-configure:</strong> <code>./scripts/setup-evolution-webhook.sh --webhook https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook</code> or <code>./install.sh --with-caddy --with-evolution --domain protectabode.weareupsyd.com</code> (sets Caddy TLS + webhook).</div>
                  <div style={{ marginTop: 8 }}><strong>Where else:</strong> Main menu → <code>WhatsApp bot</code> (connection + menus), <code>/s/protecta/health</code>, Caddyfile <code>protecta/Caddyfile</code>, compose <code>protecta/docker-compose.caddy.yml</code>. See <code>protecta/EVOLUTION.md</code>.</div>
                </div>
              </div>
            </Section.Root>
            <Section.Root>
              <Section.Header
                title={t`Webhooks`}
                description={t`Establish Webhook endpoints for notifications on asynchronous events.`}
              />
              <StyledTableContainer isMobile={isMobile}>
                <SettingsWebhooksTable />
                <StyledButtonContainer>
                  <NavigationButton
                    startIcon={<IconPlus />}
                    size="sm"
                    to={getSettingsPath(SettingsPath.NewWebhook)}
                    variant="outline"
                  >{t`Create webhook`}</NavigationButton>
                </StyledButtonContainer>
              </StyledTableContainer>
            </Section.Root>
          </StyledTabContent>
        )}
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
