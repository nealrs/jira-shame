function sortTable(tableId, columnIndex, isNumeric = false) {
  const table = document.getElementById(tableId);
  if (!table) return;
  
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr:not(.total-row)'));
  const header = table.querySelectorAll('thead th')[columnIndex];
  
  // Remove sort classes from all headers
  table.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
  });
  
  // Determine sort direction (toggle: no sort -> asc -> desc -> asc)
  const isCurrentlyDesc = header.classList.contains('sort-desc');
  const isCurrentlyAsc = header.classList.contains('sort-asc');
  header.classList.remove('sort-asc', 'sort-desc');
  
  // If currently descending, switch to ascending; if ascending, switch to descending; if no sort, start ascending
  const isAsc = isCurrentlyDesc || (!isCurrentlyAsc && !isCurrentlyDesc);
  header.classList.add(isAsc ? 'sort-asc' : 'sort-desc');
  
  // Sort rows
  rows.sort((a, b) => {
    const aCell = a.cells[columnIndex];
    const bCell = b.cells[columnIndex];
    
    let aValue, bValue;
    
    if (isNumeric) {
      // Extract numeric value (handle strong tags, etc.)
      aValue = parseFloat(aCell.textContent.trim()) || 0;
      bValue = parseFloat(bCell.textContent.trim()) || 0;
    } else {
      // Text comparison
      aValue = aCell.textContent.trim().toLowerCase();
      bValue = bCell.textContent.trim().toLowerCase();
    }
    
    if (aValue < bValue) return isAsc ? 1 : -1;
    if (aValue > bValue) return isAsc ? -1 : 1;
    return 0;
  });
  
  // Re-append sorted rows (excluding total row)
  const totalRow = tbody.querySelector('.total-row');
  rows.forEach(row => tbody.appendChild(row));
  if (totalRow) {
    tbody.appendChild(totalRow);
  }
}

// Initialize sortable headers on page load
function initTableSorting() {
  document.querySelectorAll('.load-table').forEach((table) => {
    const headers = Array.from(table.querySelectorAll('thead th.sortable'));
    headers.forEach((th, index) => {
      th.addEventListener('click', function() {
        const tableId = table.id;
        const isNumeric = this.classList.contains('sort-numeric');
        sortTable(tableId, index, isNumeric);
      });
    });
  });
}

// Run on DOMContentLoaded and also immediately (in case DOM is already loaded)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTableSorting);
} else {
  initTableSorting();
}
