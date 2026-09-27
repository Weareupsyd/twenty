import { useState } from 'react';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { useSelectedRecordIds } from 'twenty-sdk/front-component';

export const StaffAction = ({
  action,
  title,
}: {
  action: string;
  title: string;
}) => {
  const ids = useSelectedRecordIds();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async () => {
    setBusy(true);
    setMessage('');
    try {
      const response = await new RestApiClient().post<{
        ok: boolean;
        result?: unknown;
        error?: string;
      }>('/s/protecta/staff/action', { action, id: ids[0] });
      if (!response.ok) throw new Error(response.error ?? 'Action failed.');
      setMessage(
        `Completed. ${JSON.stringify(response.result)} Refresh the record to see changes.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h2>{title}</h2>
      <p>
        {ids.length === 1
          ? 'Confirm this operation for the selected record.'
          : 'Select exactly one record.'}
      </p>
      <button disabled={busy || ids.length !== 1} onClick={run}>
        {busy ? 'Working…' : 'Confirm'}
      </button>
      <p role="status">{message}</p>
    </section>
  );
};
