/**
 * Dark Mode Toggle
 */

const THEME_KEY = 'jira-shame-theme';
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
    // Solarized dark theme
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
  const themeColors = THEMES[theme];
  
  Object.entries(themeColors).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
  
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}

function updateToggleButton() {
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    const currentTheme = document.body.getAttribute('data-theme') || 'light';
    toggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    toggle.setAttribute('aria-label', currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
}

function initDarkMode() {
  const theme = getStoredTheme();
  applyTheme(theme);
  
  // Create or update theme toggle button
  const nav = document.querySelector('.nav-links');
  if (nav) {
    let toggle = document.getElementById('theme-toggle');
    
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'theme-toggle';
      toggle.setAttribute('aria-label', 'Toggle dark mode');
      toggle.className = 'theme-toggle';
      toggle.style.cssText = `
        position: absolute;
        right: 20px;
        top: 50%;
        transform: translateY(-50%);
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 18px;
        color: var(--text-primary);
        transition: all 0.2s;
      `;
      toggle.onclick = () => {
        const currentTheme = document.body.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        updateToggleButton();
      };
      nav.style.position = 'relative';
      nav.appendChild(toggle);
    }
    
    updateToggleButton();
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDarkMode);
} else {
  initDarkMode();
}

// Re-initialize after HTMX swaps
document.body.addEventListener('htmx:afterSwap', function() {
  initDarkMode();
  updateToggleButton();
});

// Make functions globally available
window.darkMode = {
  apply: applyTheme,
  getTheme: getStoredTheme,
};
