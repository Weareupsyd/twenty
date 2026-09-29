import { useEffect, useState } from 'react';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { defineFrontComponent } from 'twenty-sdk/define';
import { FC_SETTINGS_TAB } from 'src/constants/universal-identifiers';

type BotMenuItem = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
};

type SettingsView = {
  ok: boolean;
  provider: 'evolution' | 'meta';
  webhookPath: string;
  botRoutes: string[];
  botMenu: BotMenuItem[];
  welcomeMessage: string;
  evolution: {
    baseUrl: string;
    instance: string;
    apiKeySet: boolean;
    apiKeyHint: string;
  };
};

const field: any = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 };
const input: any = { border: '1px solid #BCDCE7', borderRadius: 8, padding: '10px 12px', font: 'inherit' };
const card: any = { border: '1px solid #BCDCE7', borderRadius: 12, padding: 16, background: '#EEF8FB', marginBottom: 16 };
const step: any = { background: '#fff', border: '1px solid #BCDCE7', borderRadius: 10, padding: 12, marginBottom: 8 };
const menuRow: any = { display: 'flex', gap: 8, alignItems: 'center', background: '#fff', border: '1px solid #BCDCE7', borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
const smallBtn: any = { padding: '6px 10px', borderRadius: 6, border: '1px solid #BCDCE7', background: '#fff', cursor: 'pointer', fontSize: 12 };

const DEFAULT_MENU: BotMenuItem[] = [
  { id: '1', label: 'Calculate premium', description: 'Send car value, get premium', enabled: true },
  { id: '2', label: 'Get cover (onboard)', description: 'Make, model, year, plate and name', enabled: true },
  { id: '3', label: 'My policies', description: 'List policies by phone', enabled: true },
  { id: '4', label: 'Pay for a quote', description: 'Pay with mobile money', enabled: true },
  { id: '5', label: 'Report a claim', description: 'Needs policy number', enabled: true },
  { id: '6', label: 'Talk to support', description: 'Create support ticket', enabled: true },
];

const Component = () => {
  const [status, setStatus] = useState('Loading WhatsApp bot settings…');
  const [baseUrl, setBaseUrl] = useState('');
  const [instance, setInstance] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [routes, setRoutes] = useState<string[]>([]);
  const [botMenu, setBotMenu] = useState<BotMenuItem[]>(DEFAULT_MENU);
  const [welcome, setWelcome] = useState('Protecta Bode — Cover Your Ride, Cover Your Life');
  const [busy, setBusy] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'connection' | 'menus'>('connection');
  const client = new RestApiClient();

  const load = async () => {
    try {
      const view = await client.get<SettingsView>('/s/protecta/settings/whatsapp');
      setBaseUrl(view.evolution?.baseUrl ?? '');
      setInstance(view.evolution?.instance ?? '');
      setRoutes(view.botRoutes ?? []);
      setBotMenu(view.botMenu && view.botMenu.length ? view.botMenu : DEFAULT_MENU);
      setWelcome(view.welcomeMessage || 'Protecta Bode — Cover Your Ride, Cover Your Life');
      setWebhookUrl(`${window.location.origin}${view.webhookPath}`);
      setStatus(
        view.evolution?.apiKeySet
          ? `✓ Evolution API key saved (${view.evolution.apiKeyHint}). Click "Save and connect" to verify and register the webhook.`
          : 'Not connected yet — paste the Evolution API instance that already has the bot number onboarded.',
      );
    } catch {
      setWebhookUrl(`${window.location.origin}/s/protecta/whatsapp/webhook`);
      setStatus('Could not load settings. Make sure you are signed in. Open via main menu: WhatsApp bot, or Settings → WhatsApp bot. If you still don’t see it, run “yarn twenty:push”.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const result = await client.post<{ ok: boolean; error?: string; connection?: { state: string; detail: string }; webhook?: { ok: boolean; detail: string } }>(
        '/s/protecta/settings/whatsapp',
        { provider: 'evolution', baseUrl, instance, apiKey, webhookUrl, connect: true },
      );
      if (!result.ok && result.error) {
        setStatus(result.error);
        return;
      }
      setApiKey('');
      setStatus(
        [
          result.connection ? `Connection: ${result.connection.state}. ${result.connection.detail}` : 'Settings saved.',
          result.webhook?.detail ?? '',
          result.connection?.state === 'open' ? '✅ Bot is online — send “menu” on WhatsApp to see the menu.' : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  const saveMenus = async () => {
    setMenuBusy(true);
    try {
      const result = await client.post<{ ok: boolean; error?: string }>(
        '/s/protecta/settings/whatsapp',
        { botMenu, welcomeMessage: welcome },
      );
      if (!result.ok && result.error) {
        setStatus(result.error);
        return;
      }
      setStatus('✅ Bot menus saved. Send “menu” on WhatsApp to see the updated menu.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not save menus.');
    } finally {
      setMenuBusy(false);
    }
  };

  const updateMenuItem = (id: string, patch: Partial<BotMenuItem>) => {
    setBotMenu((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const addMenuItem = () => {
    const nextId = String(Math.max(0, ...botMenu.map((m) => parseInt(m.id) || 0)) + 1);
    setBotMenu([...botMenu, { id: nextId, label: 'New option', description: '', enabled: true }]);
  };

  const removeMenuItem = (id: string) => {
    if (botMenu.length <= 1) return;
    setBotMenu(botMenu.filter((m) => m.id !== id));
  };

  const previewText = `*${welcome}*\n${botMenu
    .filter((m) => m.enabled)
    .map((m) => `${m.id}. ${m.label}`)
    .join('\n')}\n\nReply with a number.`;

  return (
    <section style={{ padding: 24, maxWidth: 860, color: '#0B1C48', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#0B1C48', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>W</div>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>WhatsApp bot — Protecta Bode</h2>
          <div style={{ fontSize: 12, color: '#56607F' }}>Configure connection, menus and welcome message. Visible in main navigation: WhatsApp bot, and Settings → WhatsApp bot.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setActiveTab('connection')}
          style={{ padding: '8px 14px', borderRadius: 999, border: activeTab === 'connection' ? '1.5px solid #0B1C48' : '1px solid #BCDCE7', background: activeTab === 'connection' ? '#0B1C48' : '#fff', color: activeTab === 'connection' ? '#fff' : '#0B1C48', cursor: 'pointer', fontWeight: 600 }}
        >
          Connection
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('menus')}
          style={{ padding: '8px 14px', borderRadius: 999, border: activeTab === 'menus' ? '1.5px solid #0B1C48' : '1px solid #BCDCE7', background: activeTab === 'menus' ? '#0B1C48' : '#fff', color: activeTab === 'menus' ? '#fff' : '#0B1C48', cursor: 'pointer', fontWeight: 600 }}
        >
          Menus & Welcome
        </button>
      </div>

      {activeTab === 'connection' && (
        <>
          <div style={card}>
            <h3 style={{ margin: '0 0 8px' }}>Quick start — make the bot answer on WhatsApp</h3>
            <div style={step}>
              <b>1. Evolution API running</b>
              <div style={{ fontSize: 13, color: '#56607F', marginTop: 4 }}>
                Deploy <code>evolution-api</code> (e.g. <code>docker run -p 8080:8080 atendai/evolution-api</code>) and create an instance via its dashboard. Scan the QR with the bot phone.
              </div>
            </div>
            <div style={step}>
              <b>2. Paste connection details below</b>
              <div style={{ fontSize: 13, color: '#56607F', marginTop: 4 }}>
                <code>Base URL</code> e.g. <code>http://YOUR_SERVER:8080</code> — must be reachable from the Twenty server. <code>Instance</code> is the name you created. <code>API key</code> is the instance apikey.
              </div>
            </div>
            <div style={step}>
              <b>3. Webhook URL</b>
              <div style={{ fontSize: 13, color: '#56607F', marginTop: 4 }}>
                Keep the default below — Evolution must be able to <b>POST</b> to it. Click <b>Save and connect</b> to verify the instance state (<code>open</code> = connected) and register the webhook.
              </div>
            </div>
            <div style={step}>
              <b>4. Test on WhatsApp</b>
              <div style={{ fontSize: 13, color: '#56607F', marginTop: 4 }}>
                From any phone, send <code>menu</code>, <code>hi</code> or <code>0</code> to the bot number. You should get the menu. Try <code>1</code> to calculate a premium.
              </div>
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              <b>Where to find this page:</b> Main sidebar → <b>WhatsApp bot</b> (position 2) OR Twenty → <b>Settings</b> (gear) → <b>WhatsApp bot</b>. You need <i>Admin</i> or <i>Protecta support</i> role (now allowed to update settings).
            </div>
          </div>

          <label style={field}>
            Evolution API base URL
            <input style={input} value={baseUrl} placeholder="http://127.0.0.1:8080" onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label style={field}>
            Instance name
            <input style={input} value={instance} placeholder="protecta" onChange={(e) => setInstance(e.target.value)} />
          </label>
          <label style={field}>
            API key (instance apikey)
            <input style={input} type="password" value={apiKey} placeholder="Leave blank to keep saved key" onChange={(e) => setApiKey(e.target.value)} />
          </label>
          <label style={field}>
            Webhook URL (Evolution must reach this — keep as is for this Twenty host)
            <input style={input} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
          </label>

          <button type="button" onClick={connect} disabled={busy} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#0B1C48', color: '#fff', cursor: 'pointer' }}>
            {busy ? 'Connecting…' : 'Save and connect'}
          </button>
          <button
            type="button"
            style={{ marginLeft: 8, padding: '10px 16px', borderRadius: 8, border: '1px solid #BCDCE7', background: '#fff', cursor: 'pointer' }}
            onClick={async () => {
              try {
                setStatus(JSON.stringify(await client.get('/s/protecta/health'), null, 2));
              } catch {
                setStatus('Unable to reach Protecta health check.');
              }
            }}
          >
            Check configuration
          </button>
        </>
      )}

      {activeTab === 'menus' && (
        <>
          <div style={card}>
            <h3 style={{ margin: '0 0 8px' }}>Bot menus — configure what customers see</h3>
            <p style={{ fontSize: 13, color: '#56607F', margin: '0 0 12px' }}>
              The bot is menu-driven. Any of <code>menu</code>, <code>hi</code>, <code>hello</code>, <code>start</code>, <code>0</code> re-opens the main menu. Numbers are shortcuts. Edit labels below, toggle on/off, and save.
            </p>

            <label style={field}>
              Welcome / header message (shown before menu)
              <input style={input} value={welcome} placeholder="Protecta Bode — Cover Your Ride" onChange={(e) => setWelcome(e.target.value)} />
            </label>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b>Menu items ({botMenu.length})</b>
                <button type="button" style={smallBtn} onClick={addMenuItem}>+ Add item</button>
              </div>

              {botMenu.map((item) => (
                <div key={item.id} style={menuRow}>
                  <input
                    style={{ width: 40, ...input, padding: '6px 8px' }}
                    value={item.id}
                    onChange={(e) => updateMenuItem(item.id, { id: e.target.value })}
                  />
                  <input
                    style={{ flex: 1, ...input, padding: '6px 10px' }}
                    value={item.label}
                    placeholder="Label"
                    onChange={(e) => updateMenuItem(item.id, { label: e.target.value })}
                  />
                  <input
                    style={{ flex: 1.2, ...input, padding: '6px 10px' }}
                    value={item.description}
                    placeholder="Description (admin only)"
                    onChange={(e) => updateMenuItem(item.id, { description: e.target.value })}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input type="checkbox" checked={item.enabled} onChange={(e) => updateMenuItem(item.id, { enabled: e.target.checked })} />
                    On
                  </label>
                  <button type="button" style={{ ...smallBtn, color: '#B3261E', borderColor: '#f5c2c0' }} onClick={() => removeMenuItem(item.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={saveMenus} disabled={menuBusy} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#0B1C48', color: '#fff', cursor: 'pointer' }}>
                {menuBusy ? 'Saving…' : 'Save menus'}
              </button>
              <button type="button" onClick={() => setBotMenu(DEFAULT_MENU)} style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #BCDCE7', background: '#fff', cursor: 'pointer' }}>
                Reset to defaults
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={card}>
              <b>Live preview — what user sees on WhatsApp</b>
              <pre style={{ whiteSpace: 'pre-wrap', background: '#fff', padding: 12, borderRadius: 8, marginTop: 8, border: '1px solid #BCDCE7', fontSize: 13, lineHeight: 1.4 }}>{previewText}</pre>
            </div>
            <div style={card}>
              <b>Current server routes (reference)</b>
              <ul style={{ fontSize: 13, paddingLeft: 18, marginTop: 8 }}>
                {routes.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <div style={{ fontSize: 12, color: '#56607F', marginTop: 8 }}>
                <b>Try it:</b> <code>menu</code> → <code>1</code> → car value → premium → <code>yes</code> → make/model/year/plate/name → <code>yes</code> → quote link.<br />
                <code>3</code> → policies, <code>5</code> → claim, <code>4</code> → pay.
              </div>
            </div>
          </div>
        </>
      )}

      <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f6f8', padding: 12, borderRadius: 8, marginTop: 16, minHeight: 60, fontSize: 12 }}>{status}</pre>

      <h3>Troubleshooting</h3>
      <ul style={{ fontSize: 13 }}>
        <li>
          <b>Don’t see Settings → WhatsApp bot?</b> Now also available as main navigation <b>WhatsApp bot</b>. Ensure app installed (<code>yarn twenty:push</code>) and you have Admin or Protecta support role.
        </li>
        <li>
          <b>Bot not replying?</b> Check Evolution dashboard → Instance → <i>Connection: open</i>. Verify <i>Webhook URL</i> is public and Evolution can POST to it. Logs: <code>/s/protecta/whatsapp/webhook</code>.
        </li>
        <li>
          <b>Using Meta Cloud API instead?</b> Set <code>WHATSAPP_TOKEN</code>/<code>WHATSAPP_PHONE_ID</code> secrets and choose provider <code>meta</code> via API.
        </li>
      </ul>

      <p>
        Customers can also self-serve on <a href="/s/protecta/">the Protecta landing page</a>.
      </p>
    </section>
  );
};

export default defineFrontComponent({
  universalIdentifier: FC_SETTINGS_TAB,
  name: 'whatsapp-settings',
  component: Component,
});
