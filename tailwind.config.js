/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#0A1628',
          900: '#0F2140',
          800: '#162D54',
          700: '#1E3A6A',
        },
        // Planora accent (steel blue) per Hoshmand AI brand standard
        accent: {
          600: '#2563eb',
          500: '#3b82f6',
          400: '#60a5fa',
          100: '#eff6ff',
        },
        // Text tokens meet WCAG 2.2 AA contrast (4.5:1) on every warm/accent/status background.
        warm: {
          50:  '#FDFCFA',
          100: '#F8F6F3',
          200: '#F0EDE8',
          300: '#E2DDD5',
          400: '#736A60',
          500: '#665E54',
          600: '#575047',
          700: '#433D36',
        },
        // Legacy aliases so existing class names don't break
        surface: {
          50:  '#FDFCFA',
          100: '#F8F6F3',
          200: '#F0EDE8',
          300: '#E2DDD5',
          400: '#736A60',
          500: '#665E54',
          600: '#575047',
          700: '#433D36',
        },
        status: {
          'on-track':     '#2F7358',
          'attention':    '#94601C',
          'at-risk':      '#A64848',
          'info':         '#3A6A9C',
          'complete':     '#4F7F61',
          'on-track-bg':  '#EDF7F2',
          'attention-bg': '#FDF5EC',
          'at-risk-bg':   '#FBF0F0',
          'info-bg':      '#EEF4FA',
          'complete-bg':  '#F0F7F2',
        },
      },
      fontFamily: {
        display: ['var(--font-dm-serif)', 'Georgia', 'serif'],
        sans:    ['var(--font-dm-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
