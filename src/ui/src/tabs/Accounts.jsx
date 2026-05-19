import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS_BADGE = {
  available:   'badge-blue',
  in_progress: 'badge-yellow',
  registered:  'badge-green',
  failed:      'badge-red',
  parked:      'badge-gray',
};
const STATUS_LABEL = {
  available:   'available',
  in_progress: 'in_progress',
  registered:  'registered',
  failed:      'failed',
  parked:      'parked',
};

export default function Accounts() {
  const [rows, setRows]       = useState([]);
  const [page, setPage]       = useState(1);
  const [limit]               = useState(50);
  const [total, setTotal]     = useState(0);
  const [filter, setFilter]   = useState('');
  const [text, setText]       = useState('');
  const [msg, setMsg]         = useState(null);
  const [busy, setBusy]       = useState(false);

  const load = async (p = page, f = filter) => {
    try {
      const r = await api.emails(p, limit, f || undefined);
      setRows(r.rows || []);
      setTotal(r.total || 0);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  };

  useEffect(() => { load(page, filter); }, [page, filter]);

  const handleImport = async () => {
    if (!text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.emailsImport(text);
      setMsg({ type: 'ok', text: `Добавлено: ${r.added}, пропущено: ${r.skipped}` });
      setText('');
      load(1, filter);
      setPage(1);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setBusy(false); }
  };

  const handleReset = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.emailsResetFailed();
      setMsg({ type: 'ok', text: `Сброшено: ${r.changed}` });
      load(page, filter);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setBusy(false); }
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5" data-testid="accounts-tab">
      <div className="grid grid-cols-12 gap-5">
        {/* Левая колонка — добавление */}
        <div className="col-span-5 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-mono text-sm uppercase tracking-wider text-muted">Добавить аккаунты</h2>
          </div>
          <textarea
            data-testid="emails-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'email1@gmx.com:password1\nemail2@gmx.com:password2\n...'}
            className="input font-mono h-40 resize-none"
          />
          <div className="mt-3 flex gap-2 justify-between items-center">
            <span className="text-[11px] text-muted font-mono">
              Формат: <code>email:password</code> на каждой строке
            </span>
            <div className="flex gap-2">
              <button onClick={handleReset} disabled={busy} className="btn-warning"
                      data-testid="emails-reset-failed">
                Сбросить Failed
              </button>
              <a className="btn-primary" href={api.emailsExportUrl()}
                 data-testid="emails-export"
                 download="registered.txt">
                Экспорт Registered
              </a>
              <button onClick={handleImport} disabled={busy} className="btn-success"
                      data-testid="emails-import">
                + Добавить
              </button>
            </div>
          </div>
          {msg && (
            <div className={`mt-3 text-xs font-mono ${msg.type === 'ok' ? 'text-success' : 'text-danger'}`}
                 data-testid="emails-msg">
              {msg.text}
            </div>
          )}
        </div>

        {/* Правая колонка — фильтры */}
        <div className="col-span-7 card p-4 flex flex-col gap-3">
          <h2 className="font-mono text-sm uppercase tracking-wider text-muted">Фильтр по статусу</h2>
          <div className="flex flex-wrap gap-2">
            {['', 'available', 'in_progress', 'registered', 'failed', 'parked'].map(s => (
              <button
                key={s || 'all'}
                data-testid={`emails-filter-${s || 'all'}`}
                onClick={() => { setFilter(s); setPage(1); }}
                className={`btn ${filter === s ? 'border-accent/60 text-accent bg-accent/10' : ''}`}
              >
                {s || 'Все'}
              </button>
            ))}
          </div>
          <div className="mt-auto text-[11px] text-muted font-mono">
            Всего: {total} · Страница {page} из {pages}
          </div>
        </div>
      </div>

      {/* Таблица */}
      <div className="card overflow-hidden">
        <table className="w-full" data-testid="emails-table">
          <thead>
            <tr>
              <th className="table-head w-16">ID</th>
              <th className="table-head">Email</th>
              <th className="table-head w-32">Статус</th>
              <th className="table-head w-24">Попытки</th>
              <th className="table-head w-44">Добавлен</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="table-cell text-muted italic text-center" colSpan="5">
                Аккаунтов не найдено
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-panel2/60">
                <td className="table-cell font-mono text-muted">{r.id}</td>
                <td className="table-cell font-mono">{r.email}</td>
                <td className="table-cell">
                  <span className={STATUS_BADGE[r.status] || 'badge-gray'}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </td>
                <td className="table-cell font-mono">{r.attempts}</td>
                <td className="table-cell font-mono text-muted text-xs">{r.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Пагинация */}
      <div className="flex items-center justify-end gap-2" data-testid="emails-pagination">
        <button className="btn" disabled={page <= 1}      onClick={() => setPage(p => Math.max(1, p - 1))}>← Назад</button>
        <span className="text-xs font-mono text-muted px-2">{page} / {pages}</span>
        <button className="btn" disabled={page >= pages}  onClick={() => setPage(p => Math.min(pages, p + 1))}>Вперёд →</button>
      </div>
    </div>
  );
}
