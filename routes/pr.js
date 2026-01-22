const express = require('express');
const moment = require('moment');
const router = express.Router();
const { isHtmxRequest, debugLog, debugWarn, debugError, githubClient, config } = require('./_helpers');

router.get('/pr', async (req, res) => {
  try {
    debugLog(`[pr] Starting PR report fetch for org: ${config.github.org || 'missing'}`);
    if (!config.github.token || !config.github.org) {
      debugWarn('[pr] Missing GitHub configuration', {
        hasToken: Boolean(config.github.token),
        hasOrg: Boolean(config.github.org)
      });
      const styles = `
        <style>
          .error-message {
            background: white;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 600px;
            margin: 40px auto;
          }
          .error-message h2 {
            color: #DE350B;
            margin-bottom: 20px;
          }
          .error-message p {
            color: #6B778C;
            line-height: 1.6;
            margin-bottom: 15px;
          }
          .error-message code {
            background: #F4F5F7;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
            color: #172B4D;
          }
          .error-message ul {
            text-align: left;
            display: inline-block;
            margin: 20px 0;
          }
          .error-message li {
            margin: 10px 0;
            color: #6B778C;
          }
        </style>
      `;
      
      const missingVars = [];
      if (!config.github.token) missingVars.push('GITHUB_TOKEN');
      if (!config.github.org) missingVars.push('GITHUB_ORG');
      
      if (isHtmxRequest(req)) {
        return res.render('pr', {
          error: true,
          missingVars: missingVars,
          githubOrg: config.github.org
        }, (err, html) => {
          if (err) {
            debugError('Error rendering PR template:', err);
            return res.status(500).send('Error rendering page');
          }
          const response = `<title hx-swap-oob="true">Pull Requests</title>
<script src="/js/pr.js" data-route-script></script>
${html}`;
          res.send(response);
        });
      } else {
        return res.render('base', {
          title: 'Pull Requests',
          template: 'pr',
          templateData: {
            error: true,
            missingVars: missingVars,
            githubOrg: config.github.org
          },
          stylesheet: '/css/routes/pr.css',
          script: '/js/pr.js'
        });
      }
    }

    // Fetch all repositories in the org
    let allRepos = [];
    let page = 1;
    let hasMore = true;
    let repoPages = 0;
    
    while (hasMore) {
      try {
        const reposResponse = await githubClient.get(`/orgs/${config.github.org}/repos`, {
          params: {
            type: 'all',
            per_page: 100,
            page: page,
            sort: 'updated'
          }
        });
        repoPages += 1;
        const remaining = reposResponse.headers?.['x-ratelimit-remaining'];
        const reset = reposResponse.headers?.['x-ratelimit-reset'];
        debugLog(`[pr] Repos page ${page}: ${reposResponse.data.length} repos (rate remaining: ${remaining || 'n/a'}, reset: ${reset || 'n/a'})`);
        
        if (reposResponse.data.length === 0) {
          hasMore = false;
        } else {
          allRepos = allRepos.concat(reposResponse.data);
          page++;
          if (reposResponse.data.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        debugError(`[pr] Error fetching repos page ${page}:`, error.message, {
          status: error.response?.status,
          data: error.response?.data
        });
        hasMore = false;
      }
    }

    debugLog(`[pr] Found ${allRepos.length} repositories in org ${config.github.org} across ${repoPages} page(s)`);

    // Fetch all open PRs from all repos in parallel batches
    const allPRs = [];
    const batchSize = 10; // Process 10 repos at a time to avoid overwhelming the API
    
    for (let i = 0; i < allRepos.length; i += batchSize) {
      const repoBatch = allRepos.slice(i, i + batchSize);
      
      // Fetch PRs from this batch of repos in parallel
      const batchResults = await Promise.allSettled(
        repoBatch.map(async (repo) => {
          const repoPRs = [];
          let prPage = 1;
          let hasMorePRs = true;
          let repoPRCount = 0;
          
          while (hasMorePRs) {
            const prsResponse = await githubClient.get(`/repos/${repo.full_name}/pulls`, {
              params: {
                state: 'open',
                per_page: 100,
                page: prPage,
                sort: 'updated',
                direction: 'desc'
              }
            });
            const remaining = prsResponse.headers?.['x-ratelimit-remaining'];
            const reset = prsResponse.headers?.['x-ratelimit-reset'];
            debugLog(`[pr] ${repo.full_name} PR page ${prPage}: ${prsResponse.data.length} PRs (rate remaining: ${remaining || 'n/a'}, reset: ${reset || 'n/a'})`);
            
            if (prsResponse.data.length === 0) {
              hasMorePRs = false;
            } else {
              // Process all PRs from this page in parallel
              const prPromises = prsResponse.data.map(async (pr) => {
                // Fetch reviews and review requests in parallel
                const [reviewsResponse, reviewRequestsResponse] = await Promise.allSettled([
                  githubClient.get(`/repos/${repo.full_name}/pulls/${pr.number}/reviews`),
                  githubClient.get(`/repos/${repo.full_name}/pulls/${pr.number}/requested_reviewers`)
                ]);
                
                const reviews = reviewsResponse.status === 'fulfilled' ? reviewsResponse.value.data : [];
                const reviewRequestsData = reviewRequestsResponse.status === 'fulfilled' ? reviewRequestsResponse.value.data : { users: [], teams: [] };
                const reviewRequests = [
                  ...(reviewRequestsData.users || []),
                  ...(reviewRequestsData.teams || [])
                ];
                
                if (reviewsResponse.status === 'fulfilled') {
                  debugLog(`[pr] ${repo.full_name}#${pr.number} reviews: ${reviews.length}`);
                }
                if (reviewRequestsResponse.status === 'fulfilled') {
                  debugLog(`[pr] ${repo.full_name}#${pr.number} requested reviewers: ${reviewRequests.length}`);
                }
                
                // Extract ticket number from PR title or branch name
                const ticketPattern = /([A-Z]+)[-_]?(\d+)/i;
                const titleMatch = pr.title.match(ticketPattern);
                const branchMatch = pr.head.ref.match(ticketPattern);
                const ticketNumber = titleMatch ? `${titleMatch[1].toUpperCase()}-${titleMatch[2]}` : 
                                    (branchMatch ? `${branchMatch[1].toUpperCase()}-${branchMatch[2]}` : null);
                
                // Process reviews to get reviewer status
                const reviewerStatuses = {};
                const reviewerAvatars = {};
                
                // Add requested reviewers who haven't reviewed yet
                reviewRequests.forEach(req => {
                  const reviewerName = req.login || req.slug || (req.name || 'Unknown');
                  if (!reviewerStatuses[reviewerName]) {
                    reviewerStatuses[reviewerName] = { status: 'requested', state: null };
                  }
                  if (req && req.login && req.avatar_url) {
                    reviewerAvatars[req.login] = req.avatar_url;
                  }
                });
                
                // Process actual reviews
                reviews.forEach(review => {
                  const reviewerName = review.user.login;
                  const state = review.state.toLowerCase();
                  
                  if (!reviewerStatuses[reviewerName] || reviewerStatuses[reviewerName].state === null) {
                    reviewerStatuses[reviewerName] = { status: state, state: state };
                  } else if (state === 'approved' || state === 'changes_requested') {
                    reviewerStatuses[reviewerName] = { status: state, state: state };
                  }

                  if (review.user && review.user.login && review.user.avatar_url) {
                    reviewerAvatars[review.user.login] = review.user.avatar_url;
                  }
                });
                
                return {
                  number: pr.number,
                  title: pr.title,
                  author: pr.user.login,
                  authorAvatarUrl: pr.user.avatar_url,
                  repo: repo.name,
                  repoFullName: repo.full_name,
                  url: pr.html_url,
                  ticketNumber: ticketNumber,
                  isDraft: pr.draft,
                  createdAt: moment(pr.created_at),
                  updatedAt: moment(pr.updated_at),
                  reviewerStatuses: reviewerStatuses,
                  reviewerAvatars: reviewerAvatars,
                  reviewRequests: reviewRequests,
                  reviews: reviews
                };
              });
              
              const processedPRs = await Promise.all(prPromises);
              repoPRs.push(...processedPRs);
              repoPRCount += processedPRs.length;
              
              prPage++;
              if (prsResponse.data.length < 100) {
                hasMorePRs = false;
              }
            }
          }
          
          debugLog(`[pr] ${repo.full_name}: total open PRs collected: ${repoPRCount}`);
          return repoPRs;
        })
      );
      
      // Collect successful results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          allPRs.push(...result.value);
        } else {
          debugError(`[pr] Error fetching PRs from ${repoBatch[index].full_name}:`, result.reason?.message || 'Unknown error');
        }
      });
    }

    // Sort by updated date (most recent first)
    allPRs.sort((a, b) => b.updatedAt.valueOf() - a.updatedAt.valueOf());
    debugLog(`[pr] Total open PRs collected: ${allPRs.length}`);

    const styles = `
      <style>
        .prs-list {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .pr {
          display: grid;
          grid-template-columns: 220px 1fr 150px 200px 1fr;
          gap: 15px;
          padding: 15px 0;
          border-bottom: 1px solid #e0e0e0;
          font-size: 13px;
          font-weight: 400;
          color: #172B4D;
          align-items: start;
        }
        .pr:last-child {
          border-bottom: none;
        }
        .pr-header {
          display: grid;
          grid-template-columns: 220px 1fr 150px 200px 1fr;
          gap: 15px;
          padding: 10px 0;
          border-bottom: 2px solid #172B4D;
          font-weight: bold;
          color: #172B4D;
          margin-bottom: 10px;
        }
        .pr-header .sortable {
          cursor: pointer;
          user-select: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .pr-header .sortable:hover {
          color: #0052CC;
        }
        .pr-header .sort-indicator {
          font-size: 11px;
          color: #6B778C;
        }
        .pr-header .sort-asc .sort-indicator::after {
          content: '▲';
          color: #0052CC;
        }
        .pr-header .sort-desc .sort-indicator::after {
          content: '▼';
          color: #0052CC;
        }
        .pr-number {
          font-weight: 500;
        }
        .pr-number a {
          color: #0052CC;
          text-decoration: none;
        }
        .pr-number a:hover {
          text-decoration: underline;
        }
        .pr-number .repo-link {
          color: #6B778C;
          text-decoration: none;
          margin-left: 6px;
          font-weight: 500;
        }
        .pr-number .repo-link:hover {
          color: #0052CC;
          text-decoration: underline;
        }
        .gh-avatar {
          width: 32px;
          height: 32px;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .pr-title {
          font-weight: 400;
          font-size: 13px;
        }
        .pr-title a {
          color: inherit;
          text-decoration: none;
        }
        .pr-title a:hover {
          color: #0052CC;
          text-decoration: underline;
        }
        .pr-repo {
          font-size: 12px;
          color: #6B778C;
          word-break: break-word;
        }
        .pr-branch {
          font-family: monospace;
          font-size: 12px;
          color: #6B778C;
        }
        .pr-author {
          color: #172B4D;
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .pr-dates {
          font-size: 12px;
          color: #6B778C;
        }
        .pr-reviewers {
          display: flex;
          flex-direction: column;
          gap: 5px;
          align-items: flex-start;
        }
        .reviewer-item {
          display: flex;
          align-items: flex-start;
          gap: 5px;
          font-size: 12px;
        }
        .review-status {
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 500;
        }
        .review-status.approved {
          background: #E3FCEF;
          color: #006644;
        }
        .review-status.changes_requested {
          background: #FFEBE6;
          color: #BF2600;
        }
        .review-status.commented {
          background: #DEEBFF;
          color: #0052CC;
        }
        .review-status.requested {
          background: #F4F5F7;
          color: #6B778C;
        }
        .review-status.dismissed {
          background: #F4F5F7;
          color: #6B778C;
          text-decoration: line-through;
        }
        .no-reviewers {
          color: #FF5630;
          font-weight: 500;
          font-size: 12px;
        }
        .draft-badge {
          background: #F4F5F7;
          color: #6B778C;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 500;
          display: inline-block;
          margin-left: 5px;
        }
        .ticket-number {
          background: #0052CC;
          color: white;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 500;
          display: inline-block;
          margin-right: 5px;
        }
        .ticket-number-link {
          color: inherit;
          text-decoration: none;
        }
        .ticket-number-link:hover .ticket-number {
          filter: brightness(1.1);
          text-decoration: underline;
        }
      </style>
      <script>
        function sortPrColumn(sortKey, sortType, headerEl) {
          const container = document.querySelector('.prs-container');
          if (!container) return;
          
          const items = Array.from(container.querySelectorAll('.pr'));
          const headers = document.querySelectorAll('.pr-header .sortable');
          
          headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
          
          const isCurrentlyDesc = headerEl.classList.contains('sort-desc');
          const isDesc = !isCurrentlyDesc; // toggle
          headerEl.classList.add(isDesc ? 'sort-desc' : 'sort-asc');
          
          items.sort((a, b) => {
            let aValue = a.dataset[sortKey] ?? '';
            let bValue = b.dataset[sortKey] ?? '';
            
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
        
        function initPrSorting() {
          document.querySelectorAll('.pr-header .sortable').forEach(header => {
            header.addEventListener('click', () => {
              const sortKey = header.getAttribute('data-sort-key');
              const sortType = header.getAttribute('data-sort-type') || 'text';
              sortPrColumn(sortKey, sortType, header);
            });
          });
        }
        
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initPrSorting);
        } else {
          initPrSorting();
        }
      </script>
    `;

    const now = moment();
    const content = `
      <h1>Pull Requests</h1>
      <p class="summary">Open Pull Requests in ${config.github.org}</p>
      
      <div class="prs-list">
        <div class="pr-header">
          <div class="sortable" data-sort-key="number" data-sort-type="number">PR, Repo <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="title" data-sort-type="text">Title <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="author" data-sort-type="text">Author <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="ageDays" data-sort-type="number">Age <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="reviewerCount" data-sort-type="number">Reviewers <span class="sort-indicator"></span></div>
        </div>
        <div class="prs-container">
        ${allPRs.length === 0 ? '<p>No open pull requests found.</p>' : allPRs.map(pr => {
          const reviewersHtml = Object.keys(pr.reviewerStatuses).length === 0 && !pr.isDraft
            ? '<span class="no-reviewers">⚠️ No reviewers assigned</span>'
            : Object.entries(pr.reviewerStatuses).map(([reviewer, status]) => {
                const avatarUrl = pr.reviewerAvatars && pr.reviewerAvatars[reviewer] ? pr.reviewerAvatars[reviewer] : null;
                const statusClass = status.status === 'approved' ? 'approved' :
                                  status.status === 'changes_requested' ? 'changes_requested' :
                                  status.status === 'commented' ? 'commented' :
                                  status.status === 'requested' ? 'requested' :
                                  status.status === 'dismissed' ? 'dismissed' : 'requested';
                const statusLabel = status.status === 'approved' ? '✓ Approved' :
                                  status.status === 'changes_requested' ? '✗ Changes Requested' :
                                  status.status === 'commented' ? '💬 Commented' :
                                  status.status === 'requested' ? '⏳ Requested' :
                                  status.status === 'dismissed' ? 'Dismissed' : 'Pending';
                return `
                  <div class="reviewer-item">
                    ${avatarUrl ? `<img class="gh-avatar" src="${avatarUrl}" alt="${reviewer}"/>` : ''}
                    <span>${reviewer}</span>
                    <span class="review-status ${statusClass}">${statusLabel}</span>
                  </div>
                `;
              }).join('');
          
          const repoDisplay = pr.repo || (pr.repoFullName ? pr.repoFullName.split('/').pop() : '');
          const repoUrl = pr.repoFullName ? `https://github.com/${pr.repoFullName}` : (pr.repo ? `https://github.com/${config.github.org}/${pr.repo}` : '');
          const reviewerCount = Object.keys(pr.reviewerStatuses || {}).length;
          const ageDays = now.diff(pr.createdAt, 'days', true);
          
          let ageText = '';
          if (ageDays < 7) {
            ageText = `${Math.max(0, Math.round(ageDays))}d`;
          } else if (ageDays < 30) {
            ageText = `${(ageDays / 7).toFixed(1)}w`;
          } else if (ageDays < 365) {
            ageText = `${(ageDays / 30).toFixed(1)}mo`;
          } else {
            ageText = `${(ageDays / 365).toFixed(1)}y`;
          }
          
          return `
            <div class="pr"
              data-number="${pr.number}"
              data-repo="${repoDisplay.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"
              data-title="${String(pr.title || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"
              data-author="${String(pr.author || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"
              data-age-days="${ageDays}"
              data-reviewer-count="${reviewerCount}">
              <div class="pr-number">
                <a href="${pr.url}" target="_blank">#${pr.number}</a>
                ${pr.isDraft ? '<span class="draft-badge">Draft</span>' : ''}
                ${repoUrl ? `, <a class="repo-link" href="${repoUrl}" target="_blank" rel="noreferrer">${repoDisplay}</a>` : (repoDisplay ? `, <span class="pr-repo">${repoDisplay}</span>` : '')}
              </div>
              <div class="pr-title">
                ${pr.ticketNumber ? `<a class="ticket-number-link" href="https://${config.jira.host}/browse/${pr.ticketNumber}" target="_blank" rel="noreferrer"><span class="ticket-number">${pr.ticketNumber}</span></a>` : ''}
                <a href="${pr.url}" target="_blank" rel="noreferrer">${pr.title}</a>
              </div>
              <div class="pr-author">
                ${pr.authorAvatarUrl ? `<img class="gh-avatar" src="${pr.authorAvatarUrl}" alt="${pr.author}"/>` : ''}
                <span>${pr.author}</span>
              </div>
              <div class="pr-dates">
                <div><strong>${ageText}</strong></div>
                <div>Opened: ${pr.createdAt.format('MM/DD/YY')}</div>
              </div>
              <div class="pr-reviewers">
                ${reviewersHtml}
              </div>
            </div>
          `;
        }).join('')}
        </div>
      </div>
    `;

    // Format PRs for template
    const formattedPRs = allPRs.map(pr => {
      const repoDisplay = pr.repo || (pr.repoFullName ? pr.repoFullName.split('/').pop() : '');
      const repoUrl = pr.repoFullName ? `https://github.com/${pr.repoFullName}` : (pr.repo ? `https://github.com/${config.github.org}/${pr.repo}` : '');
      const reviewerCount = Object.keys(pr.reviewerStatuses || {}).length;
      const ageDays = now.diff(pr.createdAt, 'days', true);
      
      let ageText = '';
      if (ageDays < 7) {
        ageText = `${Math.max(0, Math.round(ageDays))}d`;
      } else if (ageDays < 30) {
        ageText = `${(ageDays / 7).toFixed(1)}w`;
      } else if (ageDays < 365) {
        ageText = `${(ageDays / 30).toFixed(1)}mo`;
      } else {
        ageText = `${(ageDays / 365).toFixed(1)}y`;
      }
      
      return {
        ...pr,
        repoDisplay,
        repoUrl,
        reviewerCount,
        ageDays,
        ageText,
        createdAtFormatted: pr.createdAt.format('MM/DD/YY'),
        reviewers: Object.entries(pr.reviewerStatuses).map(([reviewer, status]) => ({
          name: reviewer,
          status: status.status,
          avatarUrl: pr.reviewerAvatars && pr.reviewerAvatars[reviewer] ? pr.reviewerAvatars[reviewer] : null
        }))
      };
    });
    
    if (isHtmxRequest(req)) {
      return res.render('pr', {
        error: false,
        prs: formattedPRs,
        githubOrg: config.github.org,
        jiraHost: config.jira.host
      }, (err, html) => {
        if (err) {
          debugError('Error rendering PR template:', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Pull Requests</title>
<link rel="stylesheet" href="/css/routes/pr.css" hx-swap-oob="true" id="route-stylesheet">
<script src="/js/pr.js" hx-swap-oob="true" id="route-script"></script>
${html}`;
        res.send(response);
      });
    } else {
      return res.render('base', {
        title: 'Pull Requests',
        template: 'pr',
        templateData: {
          error: false,
          prs: formattedPRs,
          githubOrg: config.github.org,
          jiraHost: config.jira.host
        },
        stylesheet: '/css/routes/pr.css',
        script: '/js/pr.js'
      });
    }

  } catch (error) {
    debugError('Error in /pr route:', error);
    if (error.response) {
      debugError('Response status:', error.response.status);
      debugError('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    if (isHtmxRequest(req)) {
      return res.render('pr', {
        error: true,
        errorMessage: error.message,
        errorStatus: error.response?.status
      }, (err, html) => {
        if (err) {
          debugError('Error rendering PR template:', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Pull Requests</title>
<link rel="stylesheet" href="/css/routes/pr.css" hx-swap-oob="true" id="route-stylesheet">
<script src="/js/pr.js" hx-swap-oob="true" id="route-script"></script>
${html}`;
        res.send(response);
      });
    } else {
      return res.render('base', {
        title: 'Pull Requests',
        template: 'pr',
        templateData: {
          error: true,
          errorMessage: error.message,
          errorStatus: error.response?.status
        },
        stylesheet: '/css/routes/pr.css',
        script: '/js/pr.js'
      });
    }
  }
});

module.exports = router;
