// Shared table sorting functionality
function getDataValue(el, key) {
  // Try camelCase first (e.g., dataAgeDays)
  if (el.dataset[key]) return el.dataset[key];
  // Try kebab-case (e.g., data-age-days)
  const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
  return el.getAttribute('data-' + kebabKey) || '';
}

function initTableSorting() {
  // Handle .header-row and .pr-header sorting (for done, progress, backlog, pr routes)
  document.querySelectorAll('.header-row .sortable, .pr-header .sortable').forEach(header => {
    // Remove existing listeners by cloning
    const newHeader = header.cloneNode(true);
    header.parentNode.replaceChild(newHeader, header);
    
    newHeader.addEventListener('click', function() {
      const sortKey = this.getAttribute('data-sort-key');
      const sortType = this.getAttribute('data-sort-type') || 'text';
      const container = this.closest('.tickets-list, .issues-list, .prs-list');
      if (!container) return;
      
      const items = Array.from(container.querySelectorAll('.ticket, .issue, .pr'));
      const headers = container.querySelectorAll('.header-row .sortable, .pr-header .sortable');
      
      // Check current state BEFORE removing classes
      const isCurrentlyDesc = this.classList.contains('sort-desc');
      const isCurrentlyAsc = this.classList.contains('sort-asc');
      
      // Remove all sort classes
      headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      
      // Toggle: no sort -> desc -> asc -> desc
      let isDesc;
      if (!isCurrentlyDesc && !isCurrentlyAsc) {
        // No current sort, start with desc
        isDesc = true;
      } else if (isCurrentlyDesc) {
        // Currently desc, switch to asc
        isDesc = false;
      } else {
        // Currently asc, switch to desc
        isDesc = true;
      }
      
      this.classList.add(isDesc ? 'sort-desc' : 'sort-asc');
      
      items.sort((a, b) => {
        let aValue, bValue;
        const aData = getDataValue(a, sortKey);
        const bData = getDataValue(b, sortKey);
        
        if (sortType === 'number') {
          aValue = parseFloat(aData || '0') || 0;
          bValue = parseFloat(bData || '0') || 0;
        } else {
          aValue = (aData || '').toString().toLowerCase();
          bValue = (bData || '').toString().toLowerCase();
        }
        
        if (aValue < bValue) return isDesc ? 1 : -1;
        if (aValue > bValue) return isDesc ? -1 : 1;
        return 0;
      });
      
      const containerEl = container.querySelector('.tickets-container, .issues-container, .prs-container');
      if (containerEl) {
        items.forEach(item => containerEl.appendChild(item));
      }
    });
  });
  
  // Handle .load-table sorting (for load route)
  document.querySelectorAll('.load-table').forEach((table) => {
    const headers = Array.from(table.querySelectorAll('thead th.sortable'));
    headers.forEach((th, index) => {
      // Remove existing listeners
      const newTh = th.cloneNode(true);
      th.parentNode.replaceChild(newTh, th);
      
      newTh.addEventListener('click', function() {
        const tableId = table.id;
        const isNumeric = this.classList.contains('sort-numeric');
        sortLoadTable(tableId, index, isNumeric);
      });
    });
  });

  // Handle any other table with thead th.sortable (e.g. .digest-table on retro)
  document.querySelectorAll('table').forEach((table) => {
    if (table.classList.contains('load-table')) return;
    const headers = Array.from(table.querySelectorAll('thead th.sortable'));
    if (headers.length === 0) return;
    let initialDescIndex = -1;
    let initialDescNumeric = false;
    headers.forEach((th, index) => {
      if (th.classList.contains('sort-initial-desc')) {
        initialDescIndex = index;
        initialDescNumeric = th.classList.contains('sort-numeric');
      }
      const newTh = th.cloneNode(true);
      th.parentNode.replaceChild(newTh, th);
      newTh.addEventListener('click', function() {
        const isNumeric = this.classList.contains('sort-numeric');
        sortTableByColumn(table, index, isNumeric);
      });
    });
    if (initialDescIndex >= 0) {
      const initialTh = table.querySelectorAll('thead th')[initialDescIndex];
      if (initialTh) {
        initialTh.classList.add('sort-desc');
        sortTableByColumn(table, initialDescIndex, initialDescNumeric);
      }
    }
  });
}

function sortTableByColumn(table, columnIndex, isNumeric) {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const headers = table.querySelectorAll('thead th');
  const th = headers[columnIndex];
  if (!th) return;
  table.querySelectorAll('thead th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
  const wasDesc = th.classList.contains('sort-desc');
  const isAsc = wasDesc;
  th.classList.add(isAsc ? 'sort-asc' : 'sort-desc');
  rows.sort((a, b) => {
    const aCell = a.cells[columnIndex];
    const bCell = b.cells[columnIndex];
    if (!aCell || !bCell) return 0;
    let aVal, bVal;
    if (isNumeric) {
      aVal = parseFloat(aCell.getAttribute('data-sort-numeric')) || parseFloat((aCell.textContent || '').replace(/[^0-9.-]/g, '')) || 0;
      bVal = parseFloat(bCell.getAttribute('data-sort-numeric')) || parseFloat((bCell.textContent || '').replace(/[^0-9.-]/g, '')) || 0;
    } else {
      aVal = (aCell.textContent || '').trim().toLowerCase();
      bVal = (bCell.textContent || '').trim().toLowerCase();
    }
    if (aVal < bVal) return isAsc ? -1 : 1;
    if (aVal > bVal) return isAsc ? 1 : -1;
    return 0;
  });
  rows.forEach(row => tbody.appendChild(row));
}

function sortLoadTable(tableId, columnIndex, isNumeric = false) {
  const table = document.getElementById(tableId);
  if (!table) return;
  
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr:not(.total-row)'));
  const header = table.querySelectorAll('thead th')[columnIndex];
  
  // Check current state BEFORE removing classes
  const isCurrentlyDesc = header.classList.contains('sort-desc');
  const isCurrentlyAsc = header.classList.contains('sort-asc');
  
  // Remove all sort classes
  table.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
  });
  
  // Toggle: no sort -> desc -> asc -> desc
  let isAsc;
  if (!isCurrentlyDesc && !isCurrentlyAsc) {
    // No current sort, start with desc
    isAsc = false;
  } else if (isCurrentlyDesc) {
    // Currently desc, switch to asc
    isAsc = true;
  } else {
    // Currently asc, switch to desc
    isAsc = false;
  }
  
  header.classList.add(isAsc ? 'sort-asc' : 'sort-desc');
  
  rows.sort((a, b) => {
    const aCell = a.cells[columnIndex];
    const bCell = b.cells[columnIndex];
    
    let aValue, bValue;
    
    if (isNumeric) {
      aValue = parseFloat(aCell.textContent.trim()) || 0;
      bValue = parseFloat(bCell.textContent.trim()) || 0;
    } else {
      aValue = aCell.textContent.trim().toLowerCase();
      bValue = bCell.textContent.trim().toLowerCase();
    }
    
    if (aValue < bValue) return isAsc ? 1 : -1;
    if (aValue > bValue) return isAsc ? -1 : 1;
    return 0;
  });
  
  const totalRow = tbody.querySelector('.total-row');
  rows.forEach(row => tbody.appendChild(row));
  if (totalRow) {
    tbody.appendChild(totalRow);
  }
}

// Initialize on load and after htmx swaps
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTableSorting);
} else {
  initTableSorting();
}

document.body.addEventListener('htmx:afterSwap', function(evt) {
  if (evt.detail.target.id === 'main-content') {
    initTableSorting();
  }
});
