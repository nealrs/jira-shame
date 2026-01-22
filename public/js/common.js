// Common filtering and sorting utilities for all routes

/**
 * Generic filter function for filtering tickets/issues by assignee
 * @param {string} assignee - The assignee name to filter by, or 'all' to show all
 * @param {Event} event - The click event (optional)
 * @param {Object} options - Configuration options
 * @param {string} options.ticketSelector - CSS selector for tickets (default: '.ticket')
 * @param {Function} options.onUpdate - Callback function to call after filtering (e.g., updateTicketCount)
 */
function filterByAssignee(assignee, event, options = {}) {
  event = event || window.event;
  
  // Update active filter label
  document.querySelectorAll('.filter-label').forEach(label => {
    label.classList.remove('active');
  });
  
  if (event && event.target) {
    event.target.classList.add('active');
  } else {
    const filterValue = assignee === 'all' ? 'all' : assignee.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    const label = document.querySelector('.filter-label[data-filter="' + filterValue + '"]');
    if (label) label.classList.add('active');
  }
  
  // Get ticket selector - try page-specific first, then fallback
  const ticketSelector = options.ticketSelector || '.ticket[data-assignee]';
  let tickets = document.querySelectorAll(ticketSelector);
  
  // If no tickets found with primary selector, try common fallbacks
  if (tickets.length === 0) {
    const fallbackSelectors = [
      '.slow-page .ticket[data-assignee]',
      '.done-page .ticket[data-assignee]',
      '.status-columns .ticket[data-assignee]',
      '.status-content .ticket[data-assignee]',
      '.status-group .ticket[data-assignee]',
      '.tickets-container .ticket[data-assignee]',
      '.tickets-list .ticket[data-assignee]',
      '.issues-container .ticket[data-assignee]',
      '.ticket[data-assignee]',
      '.ticket',  // Fallback to any .ticket element
      '[data-assignee]'  // Most permissive - find any element with data-assignee
    ];
    
    for (const selector of fallbackSelectors) {
      tickets = document.querySelectorAll(selector);
      if (tickets.length > 0) {
        // Found tickets, use this selector
        break;
      }
    }
  }
  
  // Final fallback: find ALL elements with data-assignee attribute that are tickets
  if (tickets.length === 0) {
    // Try finding .ticket elements first, then check if they have data-assignee
    const allTickets = document.querySelectorAll('.ticket');
    tickets = Array.from(allTickets).filter(t => t.hasAttribute('data-assignee'));
    if (tickets.length === 0) {
      // Last resort: any element with data-assignee
      tickets = document.querySelectorAll('[data-assignee]');
    }
  }
  
  if (tickets.length === 0) {
    return; // Can't filter if no tickets found
  }
  
  // Helper function to normalize assignee names for comparison
  function normalizeAssignee(name) {
    if (!name) return '';
    return String(name)
      // Handle JavaScript escaping (backslashes)
      .replace(/\\(.)/g, '$1')  // Remove backslash escapes: \' -> ', \" -> "
      // Handle HTML entities
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }
  
  // Filter tickets
  let visibleCount = 0;
  const normalizedFilterAssignee = assignee === 'all' ? 'all' : normalizeAssignee(assignee);
  
  tickets.forEach(ticket => {
    if (assignee === 'all') {
      ticket.classList.remove('hidden');
      visibleCount++;
    } else {
      const ticketAssignee = ticket.getAttribute('data-assignee');
      if (!ticketAssignee) {
        ticket.classList.add('hidden');
        return;
      }
      
      // Normalize both values for comparison
      const normalizedTicketAssignee = normalizeAssignee(ticketAssignee);
      
      // Compare normalized values (case-sensitive exact match)
      if (normalizedTicketAssignee === normalizedFilterAssignee) {
        ticket.classList.remove('hidden');
        visibleCount++;
      } else {
        ticket.classList.add('hidden');
      }
    }
  });
  
  // Call update callback if provided
  if (options.onUpdate && typeof options.onUpdate === 'function') {
    options.onUpdate();
  }
}

// Make filter function globally available
window.filterByAssignee = filterByAssignee;

/**
 * Update ticket count for done/progress routes
 * @param {string} periodLabel - The period label to display
 */
function updateTicketCount(periodLabel) {
  const visibleTickets = document.querySelectorAll('.ticket:not(.hidden)').length;
  const summaryElement = document.querySelector('.summary');
  if (summaryElement) {
    const label = periodLabel || summaryElement.getAttribute('data-period-label');
    if (label) {
      summaryElement.textContent = visibleTickets + ' ticket' + (visibleTickets !== 1 ? 's' : '') + ' completed in ' + label;
    }
  }
}

/**
 * Update ticket counts for slow route (per status group)
 */
function updateTicketCounts() {
  const statusGroups = document.querySelectorAll('.status-group');
  statusGroups.forEach(group => {
    const visibleTickets = group.querySelectorAll('.ticket:not(.hidden)').length;
    const countSpan = group.querySelector('.status-header span:last-child');
    if (countSpan) {
      countSpan.textContent = visibleTickets + ' tickets';
    }
  });
}

// Make update functions globally available
window.updateTicketCount = updateTicketCount;
window.updateTicketCounts = updateTicketCounts;

// Set up event delegation for filter buttons
function setupFilterDelegation() {
  // Remove any existing listeners to prevent duplicates
  document.body.removeEventListener('click', handleFilterClick);
  // Add event delegation for filter clicks
  document.body.addEventListener('click', handleFilterClick);
}

function handleFilterClick(event) {
  const filterLabel = event.target.closest('.filter-label');
  if (!filterLabel) return;
  
  event.preventDefault();
  event.stopPropagation();
  
  const assignee = filterLabel.getAttribute('data-assignee');
  if (!assignee) return;
  
  // For 'all', pass it as-is. For others, decode HTML entities
  const decodedAssignee = assignee === 'all' ? 'all' : assignee
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  
  // Call the filter function
  if (typeof window.filterByAssignee === 'function') {
    window.filterByAssignee(decodedAssignee, event);
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupFilterDelegation);
} else {
  setupFilterDelegation();
}

// Re-initialize after htmx swap
document.body.addEventListener('htmx:afterSwap', function(evt) {
  if (evt.detail.target.id === 'main-content') {
    // Ensure functions are available after swap
    window.filterByAssignee = filterByAssignee;
    window.updateTicketCount = updateTicketCount;
    window.updateTicketCounts = updateTicketCounts;
    
    // Re-setup event delegation
    setupFilterDelegation();
    
    // Re-initialize route-specific filter overrides if they exist
    // This allows route-specific scripts to re-setup their filter overrides
    if (typeof window.setupSlowFilter === 'function') {
      setTimeout(() => window.setupSlowFilter(), 50);
    }
    if (typeof window.setupDoneFilter === 'function') {
      setTimeout(() => window.setupDoneFilter(), 50);
    }
  }
});
