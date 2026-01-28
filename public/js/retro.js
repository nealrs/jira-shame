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
})();
