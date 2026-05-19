import React, { useEffect, useState } from 'react';
import Dashboard from './tabs/Dashboard.jsx';
import Logs from './tabs/Logs.jsx';
import Accounts from './tabs/Accounts.jsx';
import Proxies from './tabs/Proxies.jsx';
import Settings from './tabs/Settings.jsx';
import { api } from './api.js';

const TABS = [
  { id: 'dashboard', label: 'Дашборд',   key: 'D' },
  { id: 'logs',      label: 'Логи',      key: 'L' },
  { id: 'accounts',  label: 'Аккаунты',  key: 'A' },
  { id: 'proxies',   label: 'Прокси',    key: 'P' },
  { id: 'settings',  label: 'Настройки', key: 'S' },
];

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [status, setStatus] = useState({ running: false, status: 'stopped', lastError: null });

  // Глобальный пуллинг статуса воркера (для индикатора в header)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.status();
        if (alive) setStatus(s);
      } catch { /* noop */ }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const dotColor =
    status.status === 'running' ? 'bg-success'
    : status.status === 'error' ? 'bg-danger'
    : 'bg-muted';
  const statusLabel =
    status.status === 'running' ? 'Работает'
    : status.status === 'error' ? 'Ошибка'
    : 'Остановлен';

  return (
    <div className="min-h-screen flex flex-col" data-testid="app-root">
      {/* Header */}
      <header className="border-b border-border bg-panel2 px-5 py-2.5 flex items-center justify-between"
              data-testid="app-header">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border border-accent/40 bg-accent/10 grid place-items-center rounded-sm"
               aria-hidden="true">
            <span className="text-accent text-xs font-mono">L</span>
          </div>
          <div className="font-mono text-sm tracking-wider">
            LUMA <span className="text-muted">/</span> REGISTRATION-BOT
          </div>
          <span className="text-[11px] text-muted font-mono">v1.0.0</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono" data-testid="status-indicator">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="uppercase tracking-wider">{statusLabel}</span>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-border bg-panel2 px-5 flex gap-0" data-testid="tab-nav">
        {TABS.map(t => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto p-5">
        {tab === 'dashboard' && <Dashboard status={status} />}
        {tab === 'logs'      && <Logs />}
        {tab === 'accounts'  && <Accounts />}
        {tab === 'proxies'   && <Proxies />}
        {tab === 'settings'  && <Settings />}
      </main>
    </div>
  );
}
