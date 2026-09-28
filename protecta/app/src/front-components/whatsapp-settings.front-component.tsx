import { useEffect, useState } from 'react';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { defineFrontComponent } from 'twenty-sdk/define';
import { FC_SETTINGS_TAB } from 'src/constants/universal-identifiers';

type SettingsView = {
  ok: boolean;
  provider: 'evolution' | 'meta';
  webhookPath: string;
  botRoutes: string[];
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

const Component = () => {
  const [status, setStatus] = useState('Loading WhatsApp bot settings…');
  const [baseUrl, setBaseUrl] = useState('');
  const [instance, setInstance] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [routes, setRoutes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const client = new RestApiClient();

  const load = async () => {
    try {
      const view = await client.get<SettingsView>('/s/protecta/settings/whatsapp');
      setBaseUrl(view.evolution?.baseUrl ?? '');
      setInstance(view.evolution?.instance ?? '');
      setRoutes(view.botRoutes ?? []);
      setWebhookUrl(`${window.location.origin}${view.webhookPath}`);
      setStatus(
        view.evolution?.apiKeySet
          ? `✓ Evolution API key saved (${view.evolution.apiKeyHint}). Click "Save and connect" to verify and register the webhook.`
          : 'Not connected yet — paste the Evolution API instance that already has the bot number onboarded.',
      );
    } catch {
      setWebhookUrl(`${window.location.origin}/s/protecta/whatsapp/webhook`);
      setStatus('Could not load settings. Make sure you are signed in, then open Settings → WhatsApp bot. If you still don’t see it, run “yarn twenty:push” or check that the Protecta app is installed.');
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

  return (
    <section style={{ padding: 24, maxWidth: 780, color: '#0B1C48', fontFamily: 'sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>WhatsApp bot — Protecta Bode</h2>
      <p>
        The bot uses the <b>Evolution API</b> (a WhatsApp gateway) — not the official Meta Cloud API — unless you configure Meta separately.
        Use this page to connect the Evolution instance that already has your bot number QR-scanned.
      </p>

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
            <code>Base URL</code> e.g. <code>http://YOUR_SERVER:8080</code> or <code>https://evolution.yourdomain.com</code> — must be reachable from the Twenty server. <code>Instance</code> is the name you created. <code>API key</code> is the instance apikey.
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
            From any phone, send <code>menu</code>, <code>hi</code> or <code>0</code> to the bot number. You should get the 6-item menu. Try <code>1</code> to calculate a premium.
          </div>
        </div>
        <div style={{ fontSize: 13, marginTop: 8 }}>
          <b>Where to find this page:</b> Twenty → <b>Settings</b> (gear) → <b>WhatsApp bot</b>. If you don’t see it, check <i>Settings → Protecta Bode</i> — both entries open the bot panel. You need <i>Admin</i> or <i>Protecta</i> role.
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

      <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f6f8', padding: 12, borderRadius: 8, marginTop: 12, minHeight: 60 }}>{status}</pre>

      <h3>Bot menus — what customers type on WhatsApp</h3>
      <p style={{ fontSize: 13, color: '#56607F' }}>
        The bot is menu-driven. Any of <code>menu</code>, <code>hi</code>, <code>hello</code>, <code>start</code>, <code>0</code> re-opens the main menu. Numbers are shortcuts:
      </p>
      <ul>
        {routes.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div style={card}>
        <b>Try it:</b>
        <div style={{ fontSize: 13, marginTop: 6 }}>
          <code>menu</code> → see menu → <code>1</code> → send car value → get 1.5% premium → <code>yes</code> to onboard → make/model/year/plate/name → <code>yes</code> to create quote → bot sends pay link.<br />
          <code>3</code> → list your policies. <code>5</code> → report claim (needs policyNo). <code>4</code> → pay a quote (needs 15-digit ref + MoMo number).
        </div>
      </div>

      <h3>Troubleshooting</h3>
      <ul style={{ fontSize: 13 }}>
        <li>
          <b>Don’t see Settings → WhatsApp bot?</b> Ensure the Protecta app is installed (<code>yarn twenty:push</code> or UI → Settings → Apps) and you have Admin. The entry is at position 1; <i>Settings → Protecta Bode</i> shows the same panel as fallback.
        </li>
        <li>
          <b>Bot not replying?</b> Check Evolution dashboard → Instance → <i>Connection: open</i>. Verify <i>Webhook URL</i> above is public and Evolution can POST to it. Check Twenty logs: <code>/s/protecta/whatsapp/webhook</code> should receive events.
        </li>
        <li>
          <b>Using Meta Cloud API instead?</b> Set <code>WHATSAPP_TOKEN</code>/<code>WHATSAPP_PHONE_ID</code> secrets and choose provider <code>meta</code> via API, or contact support to switch.
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
