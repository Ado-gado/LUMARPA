// Тонкая обёртка над fetch. Все запросы идут на относительный /api/*.
// В dev-режиме Vite проксирует на http://127.0.0.1:3001 (см. vite.config.js).
// В сборке Electron Express отдаёт UI с того же порта 3001.

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json && json.error) || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return json;
}

export const api = {
  // Stats / status
  stats:  ()        => request('GET',  '/api/stats'),
  status: ()        => request('GET',  '/api/status'),
  start:  (data)    => request('POST', '/api/start',  data),
  stop:   ()        => request('POST', '/api/stop'),

  // Emails
  emails:           (page = 1, limit = 50, status) => {
    const q = new URLSearchParams({ page, limit });
    if (status) q.set('status', status);
    return request('GET', `/api/emails?${q}`);
  },
  emailsImport:      (text) => request('POST', '/api/emails/import', { text }),
  emailsResetFailed: ()     => request('POST', '/api/emails/reset-failed'),
  emailsExportUrl:   ()     => '/api/emails/export-registered',

  // Proxies
  proxies:            (page = 1, limit = 50) => request('GET', `/api/proxies?page=${page}&limit=${limit}`),
  proxiesImport:      (text) => request('POST', '/api/proxies/import', { text }),
  proxiesResetFailed: ()     => request('POST', '/api/proxies/reset-failed'),
  proxiesClearUsed:   ()     => request('POST', '/api/proxies/clear-used'),

  // IMAP proxies
  imapProxies:       ()     => request('GET', '/api/imap-proxies'),
  imapProxiesImport: (text) => request('POST', '/api/imap-proxies/import', { text }),
  imapProxyDelete:   (id)   => request('DELETE', `/api/imap-proxies/${id}`),

  // Logs
  logs:        (lines = 200) => request('GET', `/api/logs?lines=${lines}`),
  logsStreamUrl: ()          => '/api/logs/stream',

  // Settings
  settings:     ()      => request('GET',  '/api/settings'),
  saveSettings: (data)  => request('POST', '/api/settings', data),
};
