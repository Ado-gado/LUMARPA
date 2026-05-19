import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS_BADGE = {
  available: 'badge-blue',
  in_use:    'badge-yellow',
  used:      'badge-gray',
  failed:    'badge-red',
};

function BrowserProxies() {
  const [rows, setRows]   = useState([]);
  const [total, setTotal] = useState(0);
  const [text, setText]   = useState('');
  const [msg, setMsg]     = useState(null);
  const [busy, setBusy]   = useState(false);

  const load = async () => {
    try {
      const r = await api.proxies(1, 500);
      setRows(r.rows || []);
      setTotal(r.total || 0);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  };
  useEffect(() => { load(); }, []);

  const doImport = async () => {
    if (!text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.proxiesImport(text);
      setMsg({ type: 'ok', text: `Добавлено: ${r.added}, пропущено: ${r.skipped}` });
      setText(''); await load();
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setBusy(false); }
  };
  const doReset = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.proxiesResetFailed();
      setMsg({ type: 'ok', text: `Сброшено: ${r.changed}` });
      await load();
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setBusy(false); }
  };
  const doClear = async () => {
    if (!confirm('Удалить все использованные (used) прокси?')) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.proxiesClearUsed();
      setMsg({ type: 'ok', text: `Удалено: ${r.deleted}` });
      await load();
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="card p-4 flex flex-col gap-3" data-testid="browser-proxies">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm uppercase tracking-wider text-muted">
          Прокси браузера (AdsPower)
        </h2>
        <span className="text-[11px] text-muted font-mono">всего: {total}</span>
      </div>

      <textarea
        data-testid="browser-proxies-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'host:port:user:pass\nsocks5://user:pass@host:port\n...'}
        className="input font-mono h-24 resize-none"
      />
      <div className="flex gap-2 flex-wrap">
        <button onClick={doImport} disabled={busy} className="btn-success"
                data-testid="browser-proxies-import">+ Добавить</button>
        <button onClick={doReset}  disabled={busy} className="btn-warning"
                data-testid="browser-proxies-reset">Сбросить Failed</button>
        <button onClick={doClear}  disabled={busy} className="btn-danger"
                data-testid="browser-proxies-clear">Очистить Used</button>
      </div>
      {msg && (
        <div className={`text-xs font-mono ${msg.type === 'ok' ? 'text-success' : 'text-danger'}`}>
          {msg.text}
        </div>
      )}

      <div className="overflow-auto max-h-[420px]">
        <table className="w-full" data-testid="browser-proxies-table">
          <thead>
            <tr>
              <th className="table-head w-12">ID</th>
              <th className="table-head">Host</th>
              <th className="table-head w-16">Port</th>
              <th className="table-head w-24">User</th>
              <th className="table-head w-28">Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="table-cell text-muted italic text-center" colSpan="5">
                Нет прокси
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id}>
                <td className="table-cell font-mono text-muted">{r.id}</td>
                <td className="table-cell font-mono">{r.host}</td>
                <td className="table-cell font-mono">{r.port}</td>
                <td className="table-cell font-mono text-muted">{r.username || '—'}</td>
                <td className="table-cell">
                  <span className={STATUS_BADGE[r.status] || 'badge-gray'}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImapProxies() {
  const [rows, setRows] = useState([]);
  const [text, setText] = useState('');
  const [msg, setMsg]   = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api.imapProxies();
      setRows(r.rows || []);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  };
  useEffect(() => { load(); }, []);

  const doImport = async () => {
    if (!text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.imapProxiesImport(text);
      setMsg({ type: 'ok', text: `Добавлено: ${r.added}, пропущено: ${r.skipped}` });
      setText(''); await load();
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setBusy(false); }
  };
  const doDelete = async (id) => {
    if (!confirm(`Удалить IMAP-прокси #${id}?`)) return;
    try {
      await api.imapProxyDelete(id);
      await load();
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  return (
    <div className="card p-4 flex flex-col gap-3" data-testid="imap-proxies">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm uppercase tracking-wider text-muted">
          IMAP-прокси (round-robin)
        </h2>
        <span className="text-[11px] text-muted font-mono">всего: {rows.length}</span>
      </div>

      <textarea
        data-testid="imap-proxies-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'host:port:user:pass\nsocks5://user:pass@host:port\n...'}
        className="input font-mono h-24 resize-none"
      />
      <div className="flex gap-2">
        <button onClick={doImport} disabled={busy} className="btn-success"
                data-testid="imap-proxies-import">+ Добавить</button>
      </div>
      {msg && (
        <div className={`text-xs font-mono ${msg.type === 'ok' ? 'text-success' : 'text-danger'}`}>
          {msg.text}
        </div>
      )}

      <div className="overflow-auto max-h-[420px]">
        <table className="w-full" data-testid="imap-proxies-table">
          <thead>
            <tr>
              <th className="table-head w-12">ID</th>
              <th className="table-head w-20">Proto</th>
              <th className="table-head">Host</th>
              <th className="table-head w-16">Port</th>
              <th className="table-head w-24">User</th>
              <th className="table-head w-16"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="table-cell text-muted italic text-center" colSpan="6">
                Нет IMAP-прокси
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id}>
                <td className="table-cell font-mono text-muted">{r.id}</td>
                <td className="table-cell font-mono">{r.protocol}</td>
                <td className="table-cell font-mono">{r.host}</td>
                <td className="table-cell font-mono">{r.port}</td>
                <td className="table-cell font-mono text-muted">{r.username || '—'}</td>
                <td className="table-cell text-right">
                  <button onClick={() => doDelete(r.id)}
                          data-testid={`imap-proxy-del-${r.id}`}
                          className="text-xs text-danger hover:underline">
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Proxies() {
  return (
    <div className="grid grid-cols-2 gap-5" data-testid="proxies-tab">
      <BrowserProxies />
      <ImapProxies />
    </div>
  );
}
