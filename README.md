# Jira Shame - SLOW MOTION

Express app that connects to JIRA and shows you tickets which have been stuck in the same status for an extended period of time. The app focuses on tickets in the current sprint and highlights those that have been stagnant for 7+ days.

## What It Does

This application:

- **Finds the current/latest sprint** for your Jira board
- **Filters tickets** to only show those in the current sprint
- **Tracks status duration** by analyzing changelog history to determine how long each ticket has been in its current status
- **Displays tickets** grouped by status in a clean, color-coded interface
- **Color-codes badges** based on how long tickets have been stuck:
  - **Grey**: Less than 1 sprint duration
  - **Yellow**: 1 sprint or more
  - **Red**: 2 sprints or more

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

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your Jira credentials:

```env
JIRA_HOST=your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token-here
BOARD_ID=7
PORT=3000
```

**Required Variables:**
- `JIRA_HOST`: Your Jira instance hostname (without `https://`)
- `JIRA_EMAIL`: Your Jira account email address
- `JIRA_API_TOKEN`: The API token you created in step 1

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

1. **Sprint Detection**: Fetches all sprints for the specified board and identifies the current active sprint by checking if today's date falls between the sprint's start and end dates. If no active sprint is found, it uses the most recent sprint.

2. **Issue Filtering**: Queries Jira for tickets that:
   - Are in the current sprint
   - Have one of the target statuses (To Do, Ready for Development, In Progress, In Review)
   - Have been in their current status for at least 7 days

3. **Status Duration Calculation**: For each ticket, the app:
   - Fetches the changelog history
   - Finds the earliest time the ticket entered its current status
   - Calculates the number of days since that transition
   - If no transition is found, uses the ticket creation date

4. **Badge Styling**: Badges are colored based on sprint duration:
   - Calculates the current sprint's duration in days
   - Compares ticket duration to 1x and 2x sprint duration
   - Applies appropriate color class

## API Endpoints

- `GET /` - Main dashboard displaying stagnant tickets

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
