(function () {
  // Collapsible sections: restore state from sessionStorage, then bind toggles
  var STORAGE_KEY = 'retro-sections-collapsed';
  function getStoredState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function setStoredState(state) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  document.querySelectorAll('.digest-section-collapsible').forEach(function (section) {
    var id = section.getAttribute('data-section');
    var btn = section.querySelector('.digest-section-toggle');
    var body = section.querySelector('.digest-section-body');
    if (!btn || !body) return;

    var state = getStoredState();
    if (state[id]) {
      section.classList.add('digest-section--collapsed');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function () {
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      section.classList.toggle('digest-section--collapsed', expanded);
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      state = getStoredState();
      state[id] = expanded;
      setStoredState(state);
    });
  });

  // Table sorting for all digest tables (including stuck) is handled by table-sort.js

  // Burnup chart: hover tooltip showing scope, completed, remaining for that day
  var tooltipEl = document.getElementById('burnup-tooltip');
  var chartWrap = document.querySelector('.burnup-chart-wrap');
  if (tooltipEl && chartWrap) {
    chartWrap.querySelectorAll('.burnup-day-hover').forEach(function (g) {
      g.addEventListener('mouseenter', function () {
        var day = g.getAttribute('data-day') || '';
        var scope = g.getAttribute('data-scope') || '0';
        var completed = g.getAttribute('data-completed') || '0';
        var remaining = g.getAttribute('data-remaining') || '0';
        tooltipEl.textContent = day + ': Scope ' + scope + ', Completed ' + completed + ', Remaining ' + remaining;
        tooltipEl.setAttribute('aria-hidden', 'false');
        tooltipEl.classList.add('burnup-tooltip--visible');
      });
      g.addEventListener('mousemove', function (e) {
        var wrap = chartWrap.getBoundingClientRect();
        var x = e.clientX - wrap.left;
        var y = e.clientY - wrap.top;
        tooltipEl.style.left = (x + 12) + 'px';
        tooltipEl.style.top = (y - 8) + 'px';
      });
      g.addEventListener('mouseleave', function () {
        tooltipEl.classList.remove('burnup-tooltip--visible');
        tooltipEl.setAttribute('aria-hidden', 'true');
      });
    });
  }
})();
