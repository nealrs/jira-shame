const axios = require('axios');
const config = require('../config');
const { createApiClient, handleRateLimit } = require('../utils/api-client');

/**
 * Jira API Service
 */
class JiraService {
  constructor() {
    this.client = createApiClient({
      baseURL: `https://${config.jira.host}`,
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64')}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get board information
   */
  async getBoard(boardId = config.jira.boardId) {
    try {
      const response = await this.client.get(`/rest/agile/1.0/board/${boardId}`);
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
   * Get issues from board with JQL
   */
  async getBoardIssues(jql, options = {}) {
    const {
      fields = 'key',
      startAt = 0,
      maxResults = 100,
    } = options;

    try {
      const response = await this.client.get(`/rest/agile/1.0/board/${config.jira.boardId}/issue`, {
        params: {
          jql,
          fields,
          startAt,
          maxResults,
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
   * Search issues using JQL
   */
  async searchIssues(jql, options = {}) {
    const {
      fields = ['key'],
      startAt = 0,
      maxResults = 100,
    } = options;

    try {
      const response = await this.client.post('/rest/api/3/search/jql', {
        jql,
        fields,
        startAt,
        maxResults,
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
   * Get issue details
   */
  async getIssue(issueKey, fields = null) {
    try {
      const params = fields ? { fields: fields.join(',') } : {};
      const response = await this.client.get(`/rest/api/3/issue/${issueKey}`, { params });
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
   * Get issue changelog
   */
  async getIssueChangelog(issueKey) {
    try {
      const response = await this.client.get(`/rest/api/3/issue/${issueKey}/changelog`, {
        params: {
          maxResults: 100,
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
   * Get sprints for board
   */
  async getSprints(boardId = config.jira.boardId, options = {}) {
    const {
      state = 'active,closed,future',
      startAt = 0,
      maxResults = 50,
    } = options;

    try {
      const response = await this.client.get(`/rest/agile/1.0/board/${boardId}/sprint`, {
        params: {
          state,
          startAt,
          maxResults,
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
   * Get issues in sprint
   */
  async getSprintIssues(sprintId, options = {}) {
    const {
      fields = 'key',
      startAt = 0,
      maxResults = 100,
    } = options;

    try {
      const response = await this.client.get(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
        params: {
          fields,
          startAt,
          maxResults,
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
   * Get board configuration (columns)
   */
  async getBoardConfiguration(boardId = config.jira.boardId) {
    try {
      const response = await this.client.get(`/rest/agile/1.0/board/${boardId}/configuration`);
      return response.data;
    } catch (error) {
      const rateLimit = handleRateLimit(error);
      if (rateLimit.isRateLimited) {
        throw new Error(rateLimit.message);
      }
      throw error;
    }
  }
}

module.exports = new JiraService();
