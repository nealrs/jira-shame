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

  // Sortable stuck table (Key, Assignee, Summary, Status, Days, Priority)
  function sortStuckTable(columnIndex, isNumeric) {
    var table = document.getElementById('stuck-table');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    var rows = Array.from(tbody.querySelectorAll('tr'));
    var headers = table.querySelectorAll('thead th');
    var th = headers[columnIndex];
    if (!th) return;
    table.querySelectorAll('thead th').forEach(function (h) { h.classList.remove('sort-asc', 'sort-desc'); });
    var wasDesc = th.classList.contains('sort-desc');
    var isAsc = wasDesc;
    th.classList.add(isAsc ? 'sort-asc' : 'sort-desc');
    rows.sort(function (a, b) {
      var aCell = a.cells[columnIndex];
      var bCell = b.cells[columnIndex];
      var aVal, bVal;
      if (isNumeric) {
        aVal = parseFloat(aCell.getAttribute('data-sort-numeric')) || parseFloat(aCell.textContent) || 0;
        bVal = parseFloat(bCell.getAttribute('data-sort-numeric')) || parseFloat(bCell.textContent) || 0;
      } else {
        aVal = (aCell.textContent || '').trim().toLowerCase();
        bVal = (bCell.textContent || '').trim().toLowerCase();
      }
      if (aVal < bVal) return isAsc ? -1 : 1;
      if (aVal > bVal) return isAsc ? 1 : -1;
      return 0;
    });
    rows.forEach(function (row) { tbody.appendChild(row); });
  }
  var stuckTable = document.getElementById('stuck-table');
  if (stuckTable) {
    var headers = Array.from(stuckTable.querySelectorAll('thead th.sortable'));
    headers.forEach(function (th, index) {
      th.addEventListener('click', function () {
        sortStuckTable(index, th.classList.contains('sort-numeric'));
      });
    });
    var daysHeader = stuckTable.querySelector('thead th.sort-initial-desc');
    if (daysHeader) {
      var daysIndex = headers.indexOf(daysHeader);
      if (daysIndex >= 0) daysHeader.classList.add('sort-desc');
    }
  }
})();
