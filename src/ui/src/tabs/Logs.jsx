import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const FILTERS = [
  { id: 'all',   label: 'Все' },
  { id: 'info',  label: 'Info' },
  { id: 'warn',  label: 'Warn' },
  { id: 'error', label: 'Error' },
];

function lineLevel(line) {
  if (/\berror\b/i.test(line)) return 'error';
  if (/\bwarn(ing)?\b/i.test(line)) return 'warn';
  return 'info';
}

function colorClass(line) {
  if (/✓ Registration successful/.test(line)) return 'text-success';
  if (/proxy/i.test(line) && /(error|fail)/i.test(line)) return 'text-warning';
  const lvl = lineLevel(line);
  if (lvl === 'error') return 'text-danger';
  if (lvl === 'warn')  return 'text-warning';
  return 'text-text';
}

export default function Logs() {
  const [lines, setLines]     = useState([]);
  const [filter, setFilter]   = useState('all');
  const [autoScroll, setAuto] = useState(true);
  const containerRef          = useRef(null);
  const esRef                 = useRef(null);

  // Стартовая подгрузка
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.logs(500);
        if (alive) setLines(r.lines || []);
      } catch { /* noop */ }
    })();
    return () => { alive = false; };
  }, []);

  // SSE стрим новых строк
  useEffect(() => {
    const es = new EventSource(api.logsStreamUrl());
    esRef.current = es;
    es.onmessage = (ev) => {
      setLines(prev => {
        const next = prev.concat(ev.data);
        return next.length > 5000 ? next.slice(-5000) : next;
      });
    };
    es.onerror = () => { /* reconnect автоматически */ };
    return () => es.close();
  }, []);

  // Autoscroll
  useEffect(() => {
    if (!autoScroll) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  const filtered = filter === 'all'
    ? lines
    : lines.filter(l => lineLevel(l) === filter);

  return (
    <div className="space-y-3" data-testid="logs-tab">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button
              key={f.id}
              data-testid={`logs-filter-${f.id}`}
              onClick={() => setFilter(f.id)}
              className={`btn ${filter === f.id ? 'border-accent/60 text-accent bg-accent/10' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            data-testid="logs-toggle-autoscroll"
            onClick={() => setAuto(a => !a)}
            className={`btn ${autoScroll ? 'border-success/40 text-success' : ''}`}
          >
            {autoScroll ? '⮟ Автоскролл: вкл' : '⮟ Автоскролл: выкл'}
          </button>
          <button
            data-testid="logs-clear"
            onClick={() => setLines([])}
            className="btn"
          >
            Очистить экран
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        data-testid="logs-container"
        className="card font-mono text-[12px] leading-relaxed p-4 h-[calc(100vh-220px)] overflow-auto"
      >
        {filtered.length === 0 ? (
          <div className="text-muted italic">Лог пуст</div>
        ) : (
          filtered.map((l, i) => (
            <div key={i} className={`${colorClass(l)} whitespace-pre-wrap break-all`}>
              {l}
            </div>
          ))
        )}
      </div>

      <div className="text-[11px] text-muted font-mono flex justify-between">
        <span>Показано: {filtered.length} из {lines.length}</span>
        <span>Поток: SSE · {esRef.current?.readyState === 1 ? 'подключён' : '—'}</span>
      </div>
    </div>
  );
}
