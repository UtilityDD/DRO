import { useCallback, useEffect, useState } from 'react';
import { api, canEdit } from '../api';
import { useAuth } from '../auth';
import { DataPage } from '../components/DataPage';

export function NscPage() {
  const { user } = useAuth();
  const editable = canEdit(user, 'nsc');
  const [summary, setSummary] = useState('');
  const load = useCallback((q: string) => api.nsc(q), []);

  useEffect(() => {
    api.nscSummary().then((r) => {
      setSummary(`Total ${r.total} · ` + Object.entries(r.byStatus).map(([k, v]) => `${k}: ${v}`).join(' · '));
    });
  }, []);

  return (
    <DataPage
      title="New Connection (NSC)"
      subtitle={summary}
      exportName="nsc_cases"
      load={load}
      columns={[
        { key: 'application_no', label: 'Application' },
        { key: 'consumer_name', label: 'Name' },
        { key: 'division_name', label: 'Division' },
        { key: 'ccc_name', label: 'CCC' },
        { key: 'status', label: 'Status' },
        { key: 'stage', label: 'Stage' },
        { key: 'delay_days', label: 'Delay (d)' },
        { key: 'category', label: 'Category' },
      ]}
      onRowAction={
        editable
          ? (row) =>
              row.status !== 'completed' ? (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={async () => {
                    await api.patchNsc(String(row.application_no), { status: 'completed' });
                    (row.__reload as (() => void) | undefined)?.();
                  }}
                >
                  Mark done
                </button>
              ) : null
          : undefined
      }
    />
  );
}

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

export function GrievancePage() {
  const { user } = useAuth();
  const editable = canEdit(user, 'grievance');
  const load = useCallback((q: string) => api.grievances(q), []);
  return (
    <DataPage
      title="Consumer Grievances"
      exportName="grievances"
      load={load}
      columns={[
        { key: 'docket_no', label: 'Docket' },
        { key: 'consumer_name', label: 'Name' },
        { key: 'ccc_name', label: 'CCC' },
        { key: 'category', label: 'Category' },
        { key: 'lodged_on', label: 'Lodged' },
        { key: 'aging_days', label: 'Aging' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
      ]}
      onRowAction={
        editable
          ? (row) =>
              row.status === 'open' ? (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={async () => {
                    await api.patchGrievance(String(row.docket_no), { status: 'closed' });
                    (row.__reload as (() => void) | undefined)?.();
                  }}
                >
                  Close
                </button>
              ) : null
          : undefined
      }
    />
  );
}

export function TechWorksPage() {
  const { user } = useAuth();
  const editable = canEdit(user, 'tech_works');
  const load = useCallback((q: string) => api.techWorks(q), []);
  return (
    <DataPage
      title="Priority Technical Works"
      exportName="tech_works"
      load={load}
      columns={[
        { key: 'work_id', label: 'Work ID' },
        { key: 'title', label: 'Title' },
        { key: 'division_name', label: 'Division' },
        { key: 'priority', label: 'Priority' },
        { key: 'vendor_name', label: 'Vendor' },
        { key: 'billing_status', label: 'Billing' },
        { key: 'status', label: 'Status' },
        { key: 'target_date', label: 'Target' },
      ]}
      onRowAction={
        editable
          ? (row) => (
              <button
                type="button"
                className="btn secondary"
                onClick={async () => {
                  await api.patchTech(String(row.work_id), {
                    billing_status: 'submitted',
                    status: row.status === 'open' ? 'in_progress' : row.status,
                  });
                  (row.__reload as (() => void) | undefined)?.();
                }}
              >
                Bill submitted
              </button>
            )
          : undefined
      }
    />
  );
}

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
