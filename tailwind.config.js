/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Midnight steel: the RunF9 palette (#06141B #11212D #253745 #4A5C6A #9BA8AB #CCD0CF)
        navy: {
          950: '#06141B',
          900: '#11212D',
          800: '#253745',
          700: '#4A5C6A',
          400: '#9BA8AB',
          200: '#CCD0CF',
        },
        // RunF9 accent (steel blue) per Hoshmand AI brand standard
        accent: {
          700: '#1d4ed8',
          600: '#2563eb',
          500: '#3b82f6',
          400: '#60a5fa',
          100: '#eff6ff',
        },
        // Cool steel neutrals (names kept from the original warm scale). Text tokens meet WCAG 2.2 AA contrast (4.5:1) on every warm/accent/status background.
        warm: {
          50:  '#FAFBFB',
          100: '#F4F6F6',
          200: '#EBEEEE',
          300: '#CCD0CF',
          400: '#56656F',
          500: '#4C5B66',
          600: '#3F4E5A',
          700: '#253745',
        },
        // Legacy aliases so existing class names don't break
        surface: {
          50:  '#FAFBFB',
          100: '#F4F6F6',
          200: '#EBEEEE',
          300: '#CCD0CF',
          400: '#56656F',
          500: '#4C5B66',
          600: '#3F4E5A',
          700: '#253745',
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
