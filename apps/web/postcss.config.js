module.exports = {
  plugins: {
    // Inlines @ngo/ui/tokens.css before Tailwind runs, so its @layer rules join globals.css.
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
