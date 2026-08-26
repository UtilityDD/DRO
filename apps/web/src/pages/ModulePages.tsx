import { useCallback, useEffect, useState } from 'react';
import { api, canEdit } from '../api';
import { useAuth } from '../auth';
import { DataPage } from '../components/DataPage';

export { NscDeskPage as NscPage } from './NscDeskPage';

export function DiscoPage() {
  const { user } = useAuth();
  const editable = canEdit(user, 'disco');
  const [summary, setSummary] = useState('');
  const load = useCallback((q: string) => api.disco(q), []);

  useEffect(() => {
    api.discoSummary().then((r) => {
      setSummary(`Pending ${r.pending} · Due ₹${Math.round(r.totalDue).toLocaleString()}`);
    });
  }, []);

  return (
    <DataPage
      title="Disconnection / Revenue Drive"
      subtitle={summary}
      exportName="disconnections"
      load={load}
      columns={[
        { key: 'consumer_id', label: 'Consumer ID' },
        { key: 'consumer_name', label: 'Name' },
        { key: 'division_name', label: 'Division' },
        { key: 'ccc_name', label: 'CCC' },
        { key: 'disco_date', label: 'Disco date' },
        { key: 'amount_due', label: 'Amount due' },
        { key: 'status', label: 'Status' },
      ]}
      onRowAction={
        editable
          ? (row) =>
              row.status === 'pending' ? (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={async () => {
                    await api.patchDisco(String(row.id), {
                      status: 'reconnected',
                      reconnect_date: new Date().toISOString().slice(0, 10),
                    });
                    (row.__reload as (() => void) | undefined)?.();
                  }}
                >
                  Reconnected
                </button>
              ) : null
          : undefined
      }
    />
  );
}

export { GrievanceDeskPage as GrievancePage } from './GrievanceDeskPage';

export { TechWorksDeskPage as TechWorksPage } from './TechWorksDeskPage';

export function SpotBillingPage() {
  const load = useCallback((q: string) => api.spotBilling(q), []);
  return (
    <DataPage
      title="Spot Billing"
      exportName="spot_billing"
      load={load}
      columns={[
        { key: 'period_label', label: 'Period' },
        { key: 'division_name', label: 'Division' },
        { key: 'ccc_name', label: 'CCC' },
        { key: 'consumer_class', label: 'Class' },
        { key: 'target_count', label: 'Target' },
        { key: 'billed_count', label: 'Billed' },
        { key: 'unbilled_count', label: 'Unbilled' },
      ]}
    />
  );
}

export function BulkPage() {
  const load = useCallback((q: string) => api.bulk(q), []);
  return (
    <DataPage
      title="Bulk Consumers"
      subtitle="Region-level HT / bulk register"
      exportName="bulk_consumers"
      load={load}
      columns={[
        { key: 'consumer_id', label: 'Consumer ID' },
        { key: 'name', label: 'Name' },
        { key: 'division_code', label: 'Division' },
        { key: 'contract_demand', label: 'CD' },
        { key: 'voltage_level', label: 'Voltage' },
        { key: 'category', label: 'Category' },
        { key: 'status', label: 'Status' },
      ]}
    />
  );
}
