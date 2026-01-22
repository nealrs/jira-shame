const config = require('../config');
const { createApiClient, handleRateLimit } = require('../utils/api-client');

/**
 * GitHub API Service
 */
class GitHubService {
  constructor() {
    if (!config.github.token) {
      this.client = null;
      return;
    }

    this.client = createApiClient({
      baseURL: 'https://api.github.com',
      headers: {
        'Authorization': `token ${config.github.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'jira-shame',
      },
    });
  }

  /**
   * Check if GitHub is configured
   */
  isConfigured() {
    return this.client !== null && config.github.org;
  }

  /**
   * Get all repositories for organization
   */
  async getRepositories() {
    if (!this.isConfigured()) {
      throw new Error('GitHub not configured');
    }

    try {
      const repos = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await this.client.get(`/orgs/${config.github.org}/repos`, {
          params: {
            per_page: 100,
            page,
            type: 'all',
          },
        });

        repos.push(...response.data);
        hasMore = response.data.length === 100;
        page++;
      }

      return repos;
    } catch (error) {
      const rateLimit = handleRateLimit(error);
      if (rateLimit.isRateLimited) {
        throw new Error(rateLimit.message);
      }
      throw error;
    }
  }

  /**
   * Get pull requests for a repository
   */
  async getPullRequests(repoFullName, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('GitHub not configured');
    }

    const {
      state = 'open',
      perPage = 100,
      page = 1,
    } = options;

    try {
      const response = await this.client.get(`/repos/${repoFullName}/pulls`, {
        params: {
          state,
          per_page: perPage,
          page,
          sort: 'updated',
          direction: 'desc',
        },
      });
      return response.data;
    } catch (error) {
      const rateLimit = handleRateLimit(error);
      if (rateLimit.isRateLimited) {
        throw new Error(rateLimit.message);
      }
      throw error;
    }
  }

  /**
   * Get pull request reviews
   */
  async getPullRequestReviews(repoFullName, prNumber) {
    if (!this.isConfigured()) {
      throw new Error('GitHub not configured');
    }

    try {
      const response = await this.client.get(`/repos/${repoFullName}/pulls/${prNumber}/reviews`);
      return response.data;
    } catch (error) {
      const rateLimit = handleRateLimit(error);
      if (rateLimit.isRateLimited) {
        throw new Error(rateLimit.message);
      }
      throw error;
    }
  }

  /**
   * Get rate limit status
   */
  async getRateLimitStatus() {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const response = await this.client.get('/rate_limit');
      return {
        remaining: response.data.rate.remaining,
        limit: response.data.rate.limit,
        reset: new Date(response.data.rate.reset * 1000),
      };
    } catch (error) {
      return null;
    }
  }
}

module.exports = new GitHubService();
