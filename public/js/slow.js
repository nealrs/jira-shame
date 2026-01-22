// Use shared filter function from common.js
// Override with route-specific options for slow page
(function() {
  function setupSlowFilter() {
    // Wait for common.js filter function to be available
    if (typeof window.filterByAssignee === 'undefined') {
      // Retry after a short delay
      setTimeout(setupSlowFilter, 50);
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
      // The ticket div has class="ticket" and data-assignee attribute
      const ticketSelector = '.slow-page .ticket[data-assignee], .status-columns .ticket[data-assignee], .status-content .ticket[data-assignee], .status-group .ticket[data-assignee], .ticket[data-assignee]';
      
      // Merge with any provided options
      const mergedOptions = {
        ticketSelector: ticketSelector,
        onUpdate: function() {
          if (typeof window.updateTicketCounts === 'function') {
            window.updateTicketCounts();
          }
        },
        ...options
      };
      
      originalFilter(assignee, event, mergedOptions);
    };
  }
  
  // Try to setup immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupSlowFilter);
  } else {
    setupSlowFilter();
  }
  
  // Make setup function globally available for re-initialization
  window.setupSlowFilter = setupSlowFilter;
  
  // Re-initialize after HTMX swaps
  document.body.addEventListener('htmx:afterSwap', function(evt) {
    if (evt.detail.target.id === 'main-content') {
      setTimeout(setupSlowFilter, 10);
    }
  });
})();
