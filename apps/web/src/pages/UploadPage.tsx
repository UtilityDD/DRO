import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { api, AUTH_MODULES, canUploadModule } from '../api';
import { useAuth } from '../auth';
import { isAtcWorkbook, parseAtcWorkbookFromAoa } from '../lib/atcParse';

export function UploadPage() {
  const { user } = useAuth();
  const allowedModules = AUTH_MODULES.filter((m) => canUploadModule(user, m.id));
  const [module, setModule] = useState<string>(allowedModules[0]?.uploadKey || 'nsc');
  const [period, setPeriod] = useState("Aug'26");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [filename, setFilename] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [batches, setBatches] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);

  const meta = AUTH_MODULES.find((m) => m.uploadKey === module) || AUTH_MODULES[0];
  const allowed = canUploadModule(user, meta.id);

  useEffect(() => {
    if (allowedModules.length && !allowedModules.some((m) => m.uploadKey === module)) {
      setModule(allowedModules[0].uploadKey);
    }
  }, [allowedModules, module]);

  useEffect(() => {
    api.batches().then((r) => setBatches(r.rows)).catch(() => {});
  }, []);

  const hints: Record<string, string> = {
    nsc: 'application_no, consumer_name, ccc_code, status, delay_days, category',
    disco: 'consumer_id, consumer_name, ccc_code, disco_date, amount_due, status',
    grievance: 'docket_no, consumer_name, ccc_code, category, aging_days, status',
    'tech-works': 'work_id, title, division_code, vendor_name, billing_status, status',
    'spot-billing': 'ccc_code, consumer_class, target_count, billed_count, period_label',
    consumers: 'consumer_id, name, ccc_code, consumer_class, status, meter_no',
    bulk: 'consumer_id, name, division_code, contract_demand, voltage_level',
    atc: 'Official Format-IA/IB workbook (both sheets) — or flat columns: period_label, source_format, office_type, office_code, …',
  };

  const templates: Record<string, string[]> = {
    nsc: ['application_no', 'consumer_name', 'ccc_code', 'status', 'delay_days', 'category'],
    disco: ['consumer_id', 'consumer_name', 'ccc_code', 'disco_date', 'amount_due', 'status'],
    grievance: ['docket_no', 'consumer_name', 'ccc_code', 'category', 'aging_days', 'status'],
    'tech-works': ['work_id', 'title', 'division_code', 'vendor_name', 'billing_status', 'status'],
    'spot-billing': ['ccc_code', 'consumer_class', 'target_count', 'billed_count', 'period_label'],
    consumers: ['consumer_id', 'name', 'ccc_code', 'consumer_class', 'status', 'meter_no'],
    bulk: ['consumer_id', 'name', 'division_code', 'contract_demand', 'voltage_level'],
    atc: ['period_label', 'office_type', 'office_code', 'office_name', 'consumer_count', 'atc_loss', 'dist_loss', 'coll_eff'],
  };

  if (!allowedModules.length) {
    return (
      <div className="panel">
        <h2>Upload Center</h2>
        <p className="error">You have no upload permission on any database. Ask an admin to grant Upload.</p>
      </div>
    );
  }

  const onFile = async (file: File) => {
    setError('');
    setMessage('');
    setFilename(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);

    if (module === 'atc') {
      const sheets = wb.SheetNames.map((name) => ({
        name,
        aoa: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
          header: 1,
          defval: null,
          raw: true,
        }) as unknown[][],
      }));
      const looksOfficial = isAtcWorkbook(
        wb.SheetNames,
        sheets[0]?.aoa
      );
      if (looksOfficial || sheets.some((s) => s.aoa.length > 5)) {
        // Do not force UI period onto rows — sheet headers carry May'25 / Mar'26 / May'26 …
        const parsed = parseAtcWorkbookFromAoa(sheets, {});
        if (parsed.rows.length) {
          const months = [
            ...new Set(parsed.rows.map((r) => String(r.period_label || '')).filter(Boolean)),
          ];
          if (parsed.period_label) setPeriod(parsed.period_label);
          setRows(parsed.rows);
          setMessage(
            `Parsed Format-IA ${parsed.counts.IA} + Format-IB ${parsed.counts.IB} rows` +
              (months.length ? ` · months ${months.join(', ')}` : '') +
              ` from ${file.name}. Upsert by period + format + office (refresh old months / add new).`
          );
          return;
        }
      }
    }

    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    setRows(json);
    setMessage(`Parsed ${json.length} rows from ${file.name}`);
  };

  const downloadTemplate = () => {
    const headers = templates[module] || ['col1'];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'template');
    XLSX.writeFile(wb, `dro_${module}_template.xlsx`);
  };

  const publish = async () => {
    if (!rows.length) return;
    setBusy(true);
    setError('');
    try {
      const chunkSize = 500;
      let total = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const res = await api.upload(module, {
          rows: chunk,
          filename,
          period_label: period,
        });
        total += res.upserted;
      }
      setMessage(`Published ${total} rows to ${meta.label}`);
      const b = await api.batches();
      setBatches(b.rows);
      setRows([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="panel">
        <h2>Upload Center</h2>
        <p className="muted">Only databases where you have <strong>Upload</strong> permission are listed.</p>
        <div className="form-grid">
          <label>
            Database
            <select value={module} onChange={(e) => setModule(e.target.value)}>
              {allowedModules.map((m) => (
                <option key={m.id} value={m.uploadKey}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period label
            <input value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <label>
            Excel / CSV file
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
        </div>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Expected columns: {hints[module]}
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn secondary" onClick={downloadTemplate}>
            Download template
          </button>
          <button type="button" className="btn" disabled={!allowed || !rows.length || busy} onClick={publish}>
            {busy ? 'Publishing…' : `Publish ${rows.length || ''} rows`}
          </button>
        </div>
        {!allowed && <p className="error">You do not have upload permission for this module.</p>}
        {message && <p className="muted">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel">
        <h2>Recent batches</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Module</th>
                <th>File</th>
                <th>By</th>
                <th>Rows</th>
                <th>Period</th>
              </tr>
            </thead>
            <tbody>
              {batches.slice(0, 20).map((b) => (
                <tr key={String(b.id)}>
                  <td>{String(b.created_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td>{String(b.module)}</td>
                  <td>{String(b.filename || '—')}</td>
                  <td>{String(b.uploaded_by)}</td>
                  <td>{String(b.row_count)}</td>
                  <td>{String(b.period_label || '—')}</td>
                </tr>
              ))}
              {!batches.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    No uploads yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
