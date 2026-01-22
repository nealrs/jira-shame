// Use shared filter function from common.js
// Override with route-specific options for done page
(function() {
  function setupDoneFilter() {
    // Wait for common.js filter function to be available
    if (typeof window.filterByAssignee === 'undefined') {
      // Retry after a short delay
      setTimeout(setupDoneFilter, 50);
      return;
    }
    
    const originalFilter = window.filterByAssignee;
    
    if (!originalFilter) {
      console.error('filterByAssignee not available');
      return;
    }
    
    // Override the global function
    window.filterByAssignee = function(assignee, event, options) {
      // Use selector that finds .ticket elements with data-assignee
      const ticketSelector = '.done-page .ticket[data-assignee], .tickets-container .ticket[data-assignee], .tickets-list .ticket[data-assignee], .ticket[data-assignee]';
      
      // Merge with any provided options
      const mergedOptions = {
        ticketSelector: ticketSelector,
        onUpdate: function() {
          if (typeof window.updateTicketCount === 'function') {
            window.updateTicketCount();
          }
        },
        ...options
      };
      
      originalFilter(assignee, event, mergedOptions);
    };
  }
  
  // Try to setup immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDoneFilter);
  } else {
    setupDoneFilter();
  }
  
  // Make setup function globally available for re-initialization
  window.setupDoneFilter = setupDoneFilter;
  
  // Re-initialize after HTMX swaps
  document.body.addEventListener('htmx:afterSwap', function(evt) {
    if (evt.detail.target.id === 'main-content') {
      setTimeout(setupDoneFilter, 10);
    }
  });
})();
