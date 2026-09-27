import { useState } from 'react';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { defineFrontComponent } from 'twenty-sdk/define';
import { STATUS_TAB } from 'src/constants/universal-identifiers';
const Component = () => {
  const [status, setStatus] = useState(
    'Click Check to inspect provider configuration.',
  );
  const check = async () => {
    try {
      setStatus(
        JSON.stringify(
          await new RestApiClient().get('/s/protecta/health'),
          null,
          2,
        ),
      );
    } catch {
      setStatus(
        'Unable to reach Protecta. Check installation and permissions.',
      );
    }
  };
  return (
    <section style={{ padding: 24 }}>
      <h2>Protecta Bode</h2>
      <p>
        Motor insurance workspace. Configure secrets in application settings
        before connecting live providers.
      </p>
      <button onClick={check}>Check configuration</button>
      <pre>{status}</pre>
    </section>
  );
};
export default defineFrontComponent({
  universalIdentifier: STATUS_TAB,
  name: 'protecta-status',
  component: Component,
});
