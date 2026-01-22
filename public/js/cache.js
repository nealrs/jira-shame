/**
 * Client-side data caching for route responses
 */

const CACHE_PREFIX = 'jira-shame-';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached data for a route
 */
function getCachedRoute(route) {
  try {
    const cached = sessionStorage.getItem(CACHE_PREFIX + route);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    const age = Date.now() - timestamp;

    if (age > CACHE_TTL) {
      sessionStorage.removeItem(CACHE_PREFIX + route);
      return null;
    }

    return data;
  } catch (e) {
    return null;
  }
}

/**
 * Cache route data
 */
function cacheRoute(route, data) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + route, JSON.stringify({
      data,
      timestamp: Date.now(),
    }));
  } catch (e) {
    // Storage quota exceeded or other error - silently fail
    console.warn('Failed to cache route data:', e);
  }
}

/**
 * Clear cache for a specific route or all routes
 */
function clearCache(route = null) {
  if (route) {
    sessionStorage.removeItem(CACHE_PREFIX + route);
  } else {
    // Clear all jira-shame cache entries
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    });
  }
}

/**
 * Get cache age for a route
 */
function getCacheAge(route) {
  try {
    const cached = sessionStorage.getItem(CACHE_PREFIX + route);
    if (!cached) return null;

    const { timestamp } = JSON.parse(cached);
    return Date.now() - timestamp;
  } catch (e) {
    return null;
  }
}

// Make functions globally available
window.routeCache = {
  get: getCachedRoute,
  set: cacheRoute,
  clear: clearCache,
  getAge: getCacheAge,
};

// Integrate with HTMX
document.body.addEventListener('htmx:beforeRequest', function(event) {
  const url = new URL(event.detail.path, window.location.origin);
  const route = url.pathname + url.search;
  
  // Check cache
  const cached = getCachedRoute(route);
  if (cached) {
    // Use cached data instead of making request
    event.detail.shouldSwap = true;
    event.detail.target.innerHTML = cached;
    event.preventDefault();
    return;
  }
});

document.body.addEventListener('htmx:afterSwap', function(event) {
  if (event.detail.target.id === 'main-content') {
    const url = new URL(window.location.href);
    const route = url.pathname + url.search;
    
    // Cache the response
    cacheRoute(route, event.detail.target.innerHTML);
  }
});

// Add refresh button to bypass cache
document.addEventListener('DOMContentLoaded', function() {
  // Add refresh handler for Ctrl+R or Cmd+R
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      // Clear cache on refresh
      clearCache();
    }
  });
});
