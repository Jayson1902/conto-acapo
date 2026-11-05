/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#0D9488', // Teal/Ottanio
          income: '#10B981', // Verde per i crediti
          expense: '#EF4444', // Rosso per i debiti
        },
      },
    },
  },
  plugins: [],
};
