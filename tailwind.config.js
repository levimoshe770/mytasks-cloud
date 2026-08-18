/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        priority: {
          critical: '#dc2626',
          high: '#ea580c',
          medium: '#0891b2',
          low: '#64748b',
        },
      },
    },
  },
  plugins: [],
};
