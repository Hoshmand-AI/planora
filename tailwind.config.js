/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    // One type scale (docs/design/DESIGN-SYSTEM.md, "Type"). Sizes only: weight and color are set where the text is.
    // This replaces Tailwind's default scale, so `text-sm` or `text-xl` do not exist, and src/lib/type-scale.test.ts
    // fails the build if a size is written any other way (`text-[17px]`, an inline font-size off the scale).
    fontSize: {
      // The app: five sizes, one per level of a page. A level down the page, or into a card, is one step smaller.
      title: '20px',   // the page title: once, top-left; nothing on the page is larger
      heading: '16px', // a section's heading, a dialog's title, the figure that answers the page
      subhead: '14px', // the title of an item inside a section: a card, a row, a folded row, a navigation item
      body: '13px',    // everything you read or operate: text, buttons, fields, table cells
      caption: '12px', // notes: captions, hints, column headers, badges, chart text
      // Public pages only (landing, sign-in, legal): headlines above the app's five, and a larger reading size.
      display: '64px', // the landing headline on a desktop
      h1: '40px',      // a section's headline on a desktop; the landing headline on a phone
      h2: '28px',      // a sub-headline on a desktop; a section's headline on a phone; a figure
      h3: '20px',      // a card's title
      lead: '18px',    // the paragraph under a headline
      copy: '16px',    // reading text
      small: '14px',   // secondary text, links, buttons
      fine: '13px',    // fine print
    },
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
        // Schedule bars, the three colours a Primavera P6 user expects: blue for work done, green for work
        // remaining, red for the critical path. Every timeline in the product and on the public page uses these
        // three and no others (a baseline and the data date are lines, not bars). The green leans to teal so it
        // stays apart from the red for people who do not see red and green well.
        bar: { done: '#2B63C1', todo: '#12A37F', critical: '#C81E1E' },
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
