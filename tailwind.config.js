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
        warm: {
          50:  '#FDFCFA',
          100: '#F8F6F3',
          200: '#F0EDE8',
          300: '#E2DDD5',
          400: '#B8B0A4',
          500: '#8A8178',
          600: '#6B6359',
          700: '#4A443C',
        },
        // Legacy aliases so existing class names don't break
        surface: {
          50:  '#FDFCFA',
          100: '#F8F6F3',
          200: '#F0EDE8',
          300: '#E2DDD5',
          400: '#B8B0A4',
          500: '#8A8178',
          600: '#6B6359',
          700: '#4A443C',
        },
        status: {
          'on-track':     '#3D8B6E',
          'attention':    '#C4873B',
          'at-risk':      '#B85C5C',
          'info':         '#4A7FB5',
          'complete':     '#6B9F7E',
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
