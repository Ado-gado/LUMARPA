import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const FIELDS = {
  paths: [
    { key: 'COOKIES_DIR', label: 'Директория cookies',  type: 'text',  placeholder: './cookies' },
    { key: 'DB_PATH',     label: 'Путь к БД (read-only)', type: 'text', readOnly: true },
  ],
  registration: [
    { key: 'MAX_RETRIES',          label: 'Макс. попыток',           type: 'number', min: 1, max: 10 },
    { key: 'EMAIL_TIMEOUT_MS',     label: 'Таймаут письма (мс)',     type: 'number', min: 1000 },
    { key: 'PLAYWRIGHT_TIMEOUT_MS',label: 'Таймаут Playwright (мс)', type: 'number', min: 1000 },
    { key: 'CONCURRENCY',          label: 'Параллельных воркеров',   type: 'number', min: 1, max: 10 },
  ],
  adspower: [
    { key: 'ADSPOWER_API_URL',  label: 'API URL',  type: 'text', placeholder: 'http://local.adspower.net:50325' },
    { key: 'ADSPOWER_GROUP_ID', label: 'Group ID', type: 'text', placeholder: '9524590' },
  ],
  email: [
    { key: 'EMAIL_SENDER_PATTERN', label: 'Шаблон отправителя', type: 'text', placeholder: 'lumalabs.ai' },
    { key: 'CODE_REGEX',           label: 'Regex для кода',     type: 'text', placeholder: '\\d{4,8}' },
  ],
  target: [
    { key: 'TARGET_URL',        label: 'URL регистрации',  type: 'text', placeholder: 'https://...' },
    { key: 'CAPSOLVER_API_KEY', label: 'Capsolver API key', type: 'text', placeholder: 'CAP-...' },
  ],
};

export default function Settings() {
  const [values, setValues] = useState({});
  const [meta, setMeta]     = useState({});
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.settings();
        setMeta({ LOGS_DIR: s.LOGS_DIR, ENV_PATH: s.ENV_PATH });
        setValues(s);
      } catch (e) {
        setMsg({ type: 'err', text: e.message });
      }
    })();
  }, []);

  const set = (k, v) => setValues(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      // Не отправляем read-only / служебные поля
      const { LOGS_DIR, ENV_PATH, ...rest } = values;
      await api.saveSettings(rest);
      setMsg({ type: 'ok', text: 'Настройки сохранены в .env' });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setBusy(false); }
  };

  const Section = ({ title, items }) => (
    <div className="card p-4">
      <h3 className="font-mono text-sm uppercase tracking-wider text-muted mb-3">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        {items.map(f => (
          <div key={f.key} className={f.fullWidth ? 'col-span-2' : ''}>
            <label className="label">{f.label}</label>
            <input
              data-testid={`settings-${f.key}`}
              type={f.type || 'text'}
              min={f.min}
              max={f.max}
              readOnly={f.readOnly}
              placeholder={f.placeholder || ''}
              value={values[f.key] ?? ''}
              onChange={e => set(f.key, e.target.value)}
              className={`input font-mono ${f.readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
          </div>
        ))}
      </div>
    </div>
  );

  const headless = String(values.HEADLESS ?? 'true').toLowerCase() !== 'false';

  return (
    <div className="space-y-5" data-testid="settings-tab">
      <Section title="Целевой сайт" items={FIELDS.target} />
      <Section title="Пути" items={[
        ...FIELDS.paths,
        { key: '_LOGS', label: 'Директория логов (read-only)', type: 'text', readOnly: true },
      ].map(f => f.key === '_LOGS'
        ? { ...f, value: meta.LOGS_DIR }
        : f
      )} />

      {/* Logs Dir — рендерим вручную, т.к. он не в values */}
      <div className="card p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Директория логов (read-only)</label>
            <input
              data-testid="settings-LOGS_DIR"
              value={meta.LOGS_DIR || ''}
              readOnly
              className="input font-mono opacity-60 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="label">Путь .env (read-only)</label>
            <input
              data-testid="settings-ENV_PATH"
              value={meta.ENV_PATH || ''}
              readOnly
              className="input font-mono opacity-60 cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      <Section title="Регистрация" items={FIELDS.registration} />

      <div className="card p-4">
        <h3 className="font-mono text-sm uppercase tracking-wider text-muted mb-3">Режим браузера</h3>
        <div className="flex items-center gap-3">
          <label className="switch" data-testid="settings-HEADLESS">
            <input
              type="checkbox"
              checked={headless}
              onChange={e => set('HEADLESS', e.target.checked ? 'true' : 'false')}
            />
            <span className="slider" />
          </label>
          <span className="text-sm">
            Headless: <span className="font-mono">{headless ? 'ВКЛ (браузер скрыт)' : 'ВЫКЛ (браузер виден)'}</span>
          </span>
        </div>
      </div>

      <Section title="AdsPower" items={FIELDS.adspower} />
      <Section title="Фильтр писем" items={FIELDS.email} />

      <div className="flex items-center justify-end gap-3 sticky bottom-0 bg-bg/95 backdrop-blur py-3 -mx-5 px-5 border-t border-border">
        {msg && (
          <div className={`text-xs font-mono ${msg.type === 'ok' ? 'text-success' : 'text-danger'}`}
               data-testid="settings-msg">
            {msg.text}
          </div>
        )}
        <button onClick={save} disabled={busy} className="btn-primary px-5 py-2"
                data-testid="settings-save">
          Сохранить настройки
        </button>
      </div>
    </div>
  );
}
