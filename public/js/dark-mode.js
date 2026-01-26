/**
 * Dark mode via system preference (prefers-color-scheme).
 * No toggle: theme follows OS/browser setting.
 * https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme
 */

const THEMES = {
  light: {
    '--bg-primary': '#f4f5f7',
    '--bg-secondary': '#ffffff',
    '--text-primary': '#172B4D',
    '--text-secondary': '#42526E',
    '--text-muted': '#6B778C',
    '--border': '#DFE1E6',
    '--hover-bg': '#F4F5F7',
    '--shadow': 'rgba(0,0,0,0.05)',
  },
  dark: {
    '--bg-primary': '#002b36',
    '--bg-secondary': '#073642',
    '--text-primary': '#839496',
    '--text-secondary': '#93a1a1',
    '--text-muted': '#657b83',
    '--border': '#586e75',
    '--hover-bg': '#0a4a5a',
    '--shadow': 'rgba(0,0,0,0.5)',
    '--accent': '#268bd2',
    '--accent-hover': '#2aa198',
  },
};

function applyTheme(theme) {
  const root = document.documentElement;
  const themeColors = THEMES[theme] || THEMES.light;
  Object.entries(themeColors).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
  document.body.setAttribute('data-theme', theme);
}

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initDarkMode() {
  applyTheme(getSystemTheme());
}

function init() {
  initDarkMode();
  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', (e) => applyTheme(e.matches ? 'dark' : 'light'));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

document.body.addEventListener('htmx:afterSwap', function () {
  initDarkMode();
});

window.darkMode = {
  apply: applyTheme,
  getTheme: getSystemTheme,
};
