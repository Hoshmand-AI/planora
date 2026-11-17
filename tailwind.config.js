/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Text. A neutral near-black: titles and figures. Body and secondary text step down through warm-700 … warm-400.
        ink: '#1D2125',
        // Midnight steel: the RunF9 palette (#06141B #11212D #253745 #4A5C6A #9BA8AB #CCD0CF)
        navy: {
          950: '#0C2340',
          900: '#14304F',
          800: '#1F3F61',
          700: '#555B61',
          400: '#A2A7AC',
          200: '#D3D6D9',
        },
        // RunF9 accent (steel blue) per Hoshmand AI brand standard
        accent: {
          700: '#1F4E9E',
          600: '#2B63C1',
          500: '#4A82D6',
          400: '#7FAAE8',
          100: '#EEF3FB',
        },
        // Cool steel neutrals (names kept from the original warm scale). Text tokens meet WCAG 2.2 AA contrast (4.5:1) on every warm/accent/status background.
        warm: {
          50:  '#FAFAFB',
          100: '#F4F5F6',
          200: '#E8EAEC',
          300: '#D3D6D9',
          400: '#666C72',
          500: '#5A6066',
          600: '#4B5056',
          700: '#33383D',
        },
        // Legacy aliases so existing class names don't break
        surface: {
          50:  '#FAFAFB',
          100: '#F4F5F6',
          200: '#E8EAEC',
          300: '#D3D6D9',
          400: '#666C72',
          500: '#5A6066',
          600: '#4B5056',
          700: '#33383D',
        },
        status: {
          'on-track':     '#2F7358',
          // Needs attention: the palette's deep blue (no amber in the RunF9 palette); distinct from at-risk red and on-track green.
          'attention':    '#1F4E9E',
          'at-risk':      '#A64848',
          'info':         '#3A6A9C',
          'complete':     '#4F7F61',
          'on-track-bg':  '#EDF7F2',
          'attention-bg': '#EEF3FB',
          'at-risk-bg':   '#FBF0F0',
          'info-bg':      '#EEF4FA',
          'complete-bg':  '#F0F7F2',
        },
      },
      fontFamily: {
        display: ['var(--font-digits, var(--font-dm-sans))', 'var(--font-dm-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        sans:    ['var(--font-digits, var(--font-dm-sans))', 'var(--font-dm-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [
    // `cols:` applies on a wide screen only while an ancestor has data-cols="on": the Schedule's optional date columns.
    ({ addVariant }) => addVariant('cols', '@media (min-width: 1280px) { [data-cols="on"] & }'),
    // `wide:` is the other half: a wide screen with those columns hidden, where the name column can be roomier.
    ({ addVariant }) => addVariant('wide', '@media (min-width: 1280px) { [data-cols="off"] & }'),
  ],
}
