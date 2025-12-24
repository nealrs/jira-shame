# The Blame Game

Express app that connects to JIRA and GitHub to provide views for tracking ticket progress and pull request reviews:

**Slow Motion** (`/slow`) - Shows tickets that have been stuck in the same status for 7+ days

**Completed Tickets** (`/done`) - Shows all tickets completed in a selected time period

**Backlog** (`/backlog`) - Shows all issues currently in the backlog (not in active sprint), sorted by creation date

**Progress** (`/progress`) - Track recent progress by viewing issues that have changed status in a selected time period

**Pull Requests** (`/pr`) - View all open pull requests across your GitHub organization with review status

## How It Works

### Slow Motion Route

The `/slow` route:

- **Finds the current/latest sprint** for your Jira board
- **Filters tickets** to only show those in the current sprint
- **Tracks status duration** by analyzing changelog history to determine how long each ticket has been in its current status
- **Displays tickets** grouped by status in a clean, color-coded interface
- **Color-codes badges** based on how long tickets have been stuck:
  - **Grey**: Less than 1 sprint duration
  - **Yellow**: 1 sprint or more
  - **Red**: 2 sprints or more
- **Allows filtering** by assignee to see who's responsible for stagnant work
- **Shows PR information** including review status for tickets with linked pull requests

### Completed Tickets Route

The `/done` route:

- **Shows completed tickets** (Done or Won't Do) in a selected time period
- **Time period options**: Today, Yesterday, This Week, Last 7 Days, This Month, Last Month
- **Displays completion metrics**: How long each ticket took from creation to completion
- **Shows assignee and reporter** information
- **Visual issue type indicators** (bug, story, task, epic, subtask, spike)
- **Sorts by ticket ID** (most recent first)

### Backlog Route

The `/backlog` route:

- **Shows all backlog issues** (not Done, Won't Do, or in current/active sprint) from your board
- **Displays age** in human-readable format (days, weeks, or months with decimals)
- **Shows current status** and creation date for each issue
- **Visual issue type indicators** (bug, story, task, epic, subtask, spike)
- **Statistics at the top**: Total number of issues, median age, and average age
- **Sorts by creation date** (oldest first) to show the longest-lingering tickets

## Tracked Statuses

The app monitors tickets in these statuses:
- To Do
- Ready for Development
- In Progress
- In Review

## Prerequisites

- Node.js 18+ (or Docker)
- A Jira account with API access
- A Jira API token (see setup below)

## Setup

### 1. Get Your Jira API Token

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a label (e.g., "Jira Shame App")
4. Copy the token (you won't be able to see it again)

### 1a. Get Your GitHub Personal Access Token (Optional - for Pull Requests route)

To use the `/pr` route, you'll need a GitHub personal access token:

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a label (e.g., "Jira Shame Review")
4. Select scopes: `repo` (for private repos) or `public_repo` (for public repos only)
5. Click "Generate token"
6. Copy the token (you won't be able to see it again)
7. Add it to your `.env` file as `GITHUB_TOKEN`

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your Jira and GitHub credentials:

```env
JIRA_HOST=your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token-here
BOARD_ID=7
GITHUB_TOKEN=your-github-personal-access-token
GITHUB_ORG=your-github-org-name
PORT=3000
```

**Required Variables:**
- `JIRA_HOST`: Your Jira instance hostname (without `https://`)
- `JIRA_EMAIL`: Your Jira account email address
- `JIRA_API_TOKEN`: The API token you created in step 1
- `GITHUB_TOKEN`: Your GitHub personal access token (required for `/pr` route)
- `GITHUB_ORG`: Your GitHub organization name (required for `/pr` route)

**Optional Variables:**
- `BOARD_ID`: The ID of your Jira board (defaults to `7`)
- `PORT`: Port to run the server on (defaults to `3000`)

### 3. Install Dependencies

```bash
npm install
```

## Running the Application

### Local Development

```bash
npm start
```

Or with auto-reload during development:

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Docker

Build and run with Docker Compose:

```bash
docker-compose up --build
```

Or build and run manually:

```bash
docker build -t jira-shame .
docker run -p 3000:3000 --env-file .env jira-shame
```

## How It Works

### Slow Motion Route (`/slow`)

1. **Sprint Detection**: Fetches all sprints for the specified board and identifies the current active sprint by checking if today's date falls between the sprint's start and end dates. If no active sprint is found, it uses the most recent sprint.

2. **Issue Filtering**: Queries Jira for tickets that:
   - Are in the current sprint
   - Have one of the target statuses (To Do, Ready for Development, In Progress, In Review)
   - Have been in their current status for at least 7 days

3. **Status Duration Calculation**: For each ticket, the app:
   - Fetches the changelog history
   - Builds a timeline of all status changes
   - Sums only the periods when the ticket was in its current status (not counting time in other statuses)
   - Calculates the total days in the current status

4. **Badge Styling**: Badges are colored based on sprint duration:
   - Calculates the current sprint's duration in days
   - Compares ticket duration to 1x and 2x sprint duration
   - Applies appropriate color class

5. **PR Integration**: For tickets with linked pull requests:
   - Fetches PR information from Jira's development panel and remote links
   - Shows PR review status (needs review if there are assigned reviewers who haven't completed reviews)

### Completed Tickets Route (`/done`)

1. **Date Range Calculation**: Determines the start and end dates based on the selected period (today, yesterday, this week, this month, or last month).

2. **Issue Query**: Queries Jira for tickets that:
   - Have status "Done" or "Won't Do"
   - Have a resolution date within the selected period (with a small buffer for edge cases)

3. **Completion Time Calculation**: For each ticket:
   - Fetches the changelog to find the exact moment it was marked Done or Won't Do
   - Calculates the duration from ticket creation to completion
   - Formats duration as hours, days, or weeks/days

4. **Resolution Status**: Determines whether the ticket was marked "Done" or "Won't Do" by checking:
   - The resolution field (most reliable)
   - The current status field
   - The changelog history (fallback)

5. **Display**: Shows tickets in a table format with:
   - Issue type badges
   - Assignee and reporter information
   - Completion duration
   - Completion date formatted as (MM/DD/YY)

### Backlog Route (`/backlog`)

1. **Sprint Detection**: Fetches all sprints for the specified board and identifies the current active sprint by checking if today's date falls between the sprint's start and end dates. If no active sprint is found, it uses the most recent sprint.

2. **Issue Query**: Queries Jira for all tickets that:
   - Have status not in "Done" or "Won't Do"
   - Are not in the current/active sprint
   - Are ordered by creation date (oldest first)

3. **Age Calculation**: For each ticket:
   - Calculates time since creation
   - Formats age in human-readable format:
     - Days (if less than 1 week)
     - Weeks with 1 decimal (if less than 1 month)
     - Months with 1 decimal (if 1 month or more)

4. **Statistics Calculation**: Calculates:
   - Total number of backlog issues
   - Median age (middle value when sorted)
   - Average age (mean of all ages)

5. **Display**: Shows tickets in a table format with:
   - Statistics summary at the top
   - Issue type badges
   - Current status
   - Creation date (MM/DD/YY)
   - Age (formatted)

## Routes

- `GET /` - Main dashboard with links to all reports
- `GET /slow` - Slow Motion report showing stagnant tickets
- `GET /done` - Completed tickets report (supports `?period=today|yesterday|this-week|last-7-days|this-month|last-month`)
- `GET /backlog` - Backlog report showing all issues not in active sprint, sorted by creation date
- `GET /progress` - Progress report showing issues that changed status in a selected time period
- `GET /pr` - Pull Requests report showing all open pull requests with review status across GitHub organization

## Technologies Used

- **Express.js** - Web server framework
- **Axios** - HTTP client for Jira API requests
- **Moment.js** - Date manipulation and calculations
- **dotenv** - Environment variable management

## Troubleshooting

### 401 Unauthorized Error

- Verify your `JIRA_EMAIL` and `JIRA_API_TOKEN` are correct
- Ensure your API token hasn't expired
- Check that your account has access to the specified board

### 0 Tickets Returned

- Verify the `BOARD_ID` is correct
- Check that there are tickets in the current sprint
- Ensure tickets have been in their current status for at least 7 days
- Verify the status names match exactly (case-sensitive)

### 404 Not Found

- Verify your `JIRA_HOST` is correct (should be just the domain, e.g., `your-domain.atlassian.net`)

