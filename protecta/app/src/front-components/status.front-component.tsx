import { useEffect, useState } from 'react';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { defineFrontComponent } from 'twenty-sdk/define';
import { STATUS_TAB } from 'src/constants/universal-identifiers';

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
  error?: string;
};

const field = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
  marginBottom: 12,
};
const input = {
  border: '1px solid #BCDCE7',
  borderRadius: 8,
  padding: '10px 12px',
  font: 'inherit',
};

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
          ? `Evolution API key is saved (${view.evolution.apiKeyHint}). Connect to register the webhook.`
          : 'Not connected yet. Paste the Evolution API instance that already has the bot onboarded.',
      );
    } catch {
      setWebhookUrl(`${window.location.origin}/s/protecta/whatsapp/webhook`);
      setStatus('Could not load settings. Sign in, then open Settings → WhatsApp bot.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const result = await client.post<{
        ok: boolean;
        error?: string;
        connection?: { state: string; detail: string };
        webhook?: { ok: boolean; detail: string };
      }>('/s/protecta/settings/whatsapp', {
        provider: 'evolution',
        baseUrl,
        instance,
        apiKey,
        webhookUrl,
        connect: true,
      });
      if (!result.ok && result.error) {
        setStatus(result.error);
        return;
      }
      setApiKey('');
      setStatus(
        [
          result.connection
            ? `Session: ${result.connection.state}. ${result.connection.detail}`
            : 'Settings saved.',
          result.webhook?.detail ?? '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ padding: 24, maxWidth: 720, color: '#0B1C48' }}>
      <h2 style={{ marginTop: 0 }}>WhatsApp bot</h2>
      <p>
        Connect the Evolution API instance that already has the bot onboarded.
        This does not use the official Meta Cloud API unless you set those
        secrets separately. The bot calculates premiums and onboards cover the
        same way as the website.
      </p>
      <label style={field}>
        Evolution API base URL
        <input
          style={input}
          value={baseUrl}
          placeholder="http://127.0.0.1:8080"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>
      <label style={field}>
        Instance name
        <input
          style={input}
          value={instance}
          placeholder="protecta"
          onChange={(event) => setInstance(event.target.value)}
        />
      </label>
      <label style={field}>
        API key
        <input
          style={input}
          type="password"
          value={apiKey}
          placeholder="Leave blank to keep the saved key"
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <label style={field}>
        Webhook URL (Evolution must be able to reach this)
        <input
          style={input}
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
        />
      </label>
      <button type="button" onClick={connect} disabled={busy}>
        {busy ? 'Connecting…' : 'Save and connect'}
      </button>
      <button
        type="button"
        style={{ marginLeft: 8 }}
        onClick={async () => {
          try {
            setStatus(
              JSON.stringify(
                await client.get('/s/protecta/health'),
                null,
                2,
              ),
            );
          } catch {
            setStatus('Unable to reach Protecta. Check installation and permissions.');
          }
        }}
      >
        Check configuration
      </button>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{status}</pre>
      <h3>Bot routes</h3>
      <ul>
        {routes.map((route) => (
          <li key={route}>{route}</li>
        ))}
      </ul>
      <p>
        Customers can also calculate and buy on{' '}
        <a href="/s/protecta/">the Protecta landing page</a>.
      </p>
    </section>
  );
};

export default defineFrontComponent({
  universalIdentifier: STATUS_TAB,
  name: 'protecta-status',
  component: Component,
});
