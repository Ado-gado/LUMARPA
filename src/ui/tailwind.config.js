/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#0f0f0f',
        panel:    '#1a1a1a',
        panel2:   '#141414',
        border:   '#2a2a2a',
        muted:    '#7a7a7a',
        text:     '#e0e0e0',
        accent:   '#3b82f6',
        success:  '#22c55e',
        warning:  '#f59e0b',
        danger:   '#ef4444',
        info:     '#60a5fa',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', '"Fira Code"', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
