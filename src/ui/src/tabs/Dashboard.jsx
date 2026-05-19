import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function StatCard({ label, value, color = 'text', testId }) {
  return (
    <div className="card p-4" data-testid={testId}>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-mono text-${color}`}>{value}</div>
    </div>
  );
}

export default function Dashboard({ status }) {
  const [stats, setStats]       = useState(null);
  const [recent, setRecent]     = useState([]);
  const [count, setCount]       = useState(10);
  const [concurrency, setConc]  = useState(1);
  const [headless, setHeadless] = useState(true);
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState(null);

  const refresh = async () => {
    try {
      const [s, l] = await Promise.all([api.stats(), api.logs(10)]);
      setStats(s);
      setRecent(l.lines || []);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  };

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, []);

  const handleStart = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.start({ count: Number(count), concurrency: Number(concurrency), headless });
      setMsg({ type: 'ok', text: 'Воркер запущен' });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setBusy(false); }
  };

  const handleStop = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.stop();
      setMsg({ type: 'ok', text: 'Сигнал остановки отправлен' });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setBusy(false); }
  };

  const running = status?.running;

  return (
    <div className="space-y-5" data-testid="dashboard-tab">
      {/* Статистика */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard testId="stat-emails-available"  label="Email в очереди"   value={stats?.emailsAvailable  ?? '—'} color="accent" />
        <StatCard testId="stat-emails-registered" label="Зарегистрировано"  value={stats?.emailsRegistered ?? '—'} color="success" />
        <StatCard testId="stat-emails-failed"     label="Ошибок"            value={stats?.emailsFailed     ?? '—'} color="danger" />
        <StatCard testId="stat-proxies-available" label="Прокси доступно"   value={stats?.proxiesAvailable ?? '—'} color="accent" />
      </div>

      {/* Управление */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-sm uppercase tracking-wider text-muted">Управление воркером</h2>
          {msg && (
            <div className={`text-xs font-mono ${msg.type === 'ok' ? 'text-success' : 'text-danger'}`}
                 data-testid="dashboard-msg">
              {msg.text}
            </div>
          )}
        </div>

        <div className="grid grid-cols-12 gap-4 items-end">
          <div className="col-span-3">
            <label className="label">Аккаунтов к регистрации</label>
            <input
              data-testid="input-count"
              type="number" min="1" max="100"
              value={count}
              onChange={e => setCount(e.target.value)}
              className="input font-mono"
            />
          </div>

          <div className="col-span-3">
            <label className="label">Параллельных воркеров</label>
            <input
              data-testid="input-concurrency"
              type="number" min="1" max="10"
              value={concurrency}
              onChange={e => setConc(e.target.value)}
              className="input font-mono"
            />
          </div>

          <div className="col-span-3">
            <label className="label">Headless режим</label>
            <label className="switch" data-testid="toggle-headless">
              <input
                type="checkbox"
                checked={headless}
                onChange={e => setHeadless(e.target.checked)}
              />
              <span className="slider" />
            </label>
            <span className="ml-3 text-xs text-muted font-mono">
              {headless ? 'браузер скрыт' : 'браузер виден'}
            </span>
          </div>

          <div className="col-span-3 flex gap-2 justify-end">
            {running ? (
              <button onClick={handleStop}  disabled={busy} className="btn-danger px-5 py-2"
                      data-testid="btn-stop">
                <span className="font-mono">■</span> Остановить
              </button>
            ) : (
              <button onClick={handleStart} disabled={busy} className="btn-success px-5 py-2"
                      data-testid="btn-start">
                <span className="font-mono">▶</span> Запустить
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="card">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-mono text-sm uppercase tracking-wider text-muted">Последняя активность</h2>
          <span className="text-[11px] text-muted font-mono">
            обновление каждые 3 сек · последние 10 строк
          </span>
        </div>
        <div className="p-4 font-mono text-[12px] leading-relaxed space-y-0.5 min-h-[160px]"
             data-testid="recent-activity">
          {recent.length === 0 ? (
            <div className="text-muted italic">Лог пуст</div>
          ) : (
            recent.map((line, i) => {
              let cls = 'text-text';
              if (/error/i.test(line))                cls = 'text-danger';
              else if (/warn/i.test(line))            cls = 'text-warning';
              if (/✓ Registration successful/.test(line)) cls = 'text-success font-medium';
              else if (/proxy/i.test(line) && /error/i.test(line)) cls = 'text-warning';
              return <div key={i} className={`${cls} whitespace-pre-wrap break-all`}>{line}</div>;
            })
          )}
        </div>
      </div>
    </div>
  );
}
