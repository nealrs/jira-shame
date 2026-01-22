function sortBacklogColumn(sortKey, sortType, headerEl) {
  const container = document.querySelector('.issues-container');
  if (!container) return;
  
  const items = Array.from(container.querySelectorAll('.issue'));
  const headers = document.querySelectorAll('.header-row .sortable');
  
  headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
  
  const isCurrentlyDesc = headerEl.classList.contains('sort-desc');
  const isDesc = !isCurrentlyDesc;
  headerEl.classList.add(isDesc ? 'sort-desc' : 'sort-asc');
  
  items.sort((a, b) => {
    let aValue = a.dataset[sortKey] || '';
    let bValue = b.dataset[sortKey] || '';
    
    if (sortType === 'number') {
      aValue = parseFloat(aValue) || 0;
      bValue = parseFloat(bValue) || 0;
    } else {
      aValue = aValue.toString().toLowerCase();
      bValue = bValue.toString().toLowerCase();
    }
    
    if (aValue < bValue) return isDesc ? 1 : -1;
    if (aValue > bValue) return isDesc ? -1 : 1;
    return 0;
  });
  
  items.forEach(item => container.appendChild(item));
}

function initBacklogSorting() {
  document.querySelectorAll('.header-row .sortable').forEach(header => {
    header.addEventListener('click', () => {
      const sortKey = header.getAttribute('data-sort-key');
      const sortType = header.getAttribute('data-sort-type') || 'text';
      sortBacklogColumn(sortKey, sortType, header);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBacklogSorting);
} else {
  initBacklogSorting();
}
