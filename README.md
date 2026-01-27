# The Blame Game

Docker-based Express app that connects to `Jira` and `GitHub` to provide views for tracking ticket progress, sprint load, and pull request reviews.

## Why did you build this? `Jira` already has reports.

JQL reports / queries are useful, but sometimes you need a little more biz logic and a read-only view that you aren't constantly losing because of reactive SaaS nonsense.

I don't want/need a full-fat `Jira` interface to know what my team is working on. 

Also, I wanted to see how good Cursor was at making my life easier. I wrote some prompts, did some testing, fixed a bunch of things the LLM messed up on (sprint filtering being a big one). But - overall, the AI wrote all this and it's better than what I would have come up with on my own. 

## Reports
**Slow Motion** (`/slow`) - Shows tickets that have been stuck in the same status for 7+ days

**Completed Tickets** (`/done`) - Shows all tickets completed in a selected time period

**Backlog** (`/backlog`) - Shows backlog issues (not in active or upcoming sprints), **default sorted newest → oldest**, with click-to-sort columns

**Progress** (`/progress`) - Track recent progress by viewing issues that have changed status in a selected time period

**Pull Requests** (`/pr`) - View all open pull requests across your GitHub organization with review status (This is WIP / requires a separate GitHub API key with access to your org's repos)

**Load** (`/load`) - Shows ticket load per team member for the current sprint (by board column) and upcoming sprints

**Sweat** (`/sweat`) - The report that should make you sweat. Developer productivity by sprint: assigned vs completed per person, one row per assignee and one column per sprint.

## How It Works

### Slow Motion

The `/slow` route:

- **Finds the current/latest sprint** for your `Jira` board
- **Filters tickets** to only show those in the current sprint
- **Tracks status duration** by analyzing `changelog` history to determine how long each ticket has been in its current status
- **Displays tickets** grouped by status in a clean, color-coded interface
- **Color-codes badges** based on how long tickets have been stuck:
  - **Grey**: Less than 1 sprint duration
  - **Yellow**: 1 sprint or more
  - **Red**: 2 sprints or more
- **Allows filtering** by assignee to see who's responsible for stagnant work
- **Shows PR information** including review status for tickets with linked pull requests

### Completed Tickets

The `/done` route:

- **Shows completed tickets** (Done or Won't Do) in a selected time period
- **Time period options**: Today, Yesterday, This Week, Last 7 Days, This Month, Last Month
- **Displays completion metrics**: How long each ticket took from creation to completion
- **Shows assignee and reporter** information
- **Visual issue type indicators** (bug, story, task, epic, subtask, spike)
- **Sorts by ticket ID** (most recent first)

### Backlog

The `/backlog` route:

- **Shows all backlog issues** (not Done, Won't Do, or in current/active sprint) from your board
- **Displays age** in human-readable format (days, weeks, or months with decimals)
- **Shows current status** and creation date for each issue
- **Visual issue type indicators** (bug, story, task, epic, subtask, spike)
- **Statistics at the top**: Total number of issues, median age, and average age
- **Defaults to newest → oldest** (creation date)
- **Supports column sorting** by clicking the header row (key, summary, status, created, reporter, age)

### Load

The `/load` route:

- **Current sprint load**: counts issues per assignee across the board's columns for the active sprint (`openSprints()`)
- **Upcoming sprint load**: counts issues per assignee for future sprints (`futureSprints()`)
- **Assignee filtering**: tables are limited to assignees seen in the current active sprint (plus **Unassigned**)
- **Avatars**: uses `Jira` avatars where available; Unassigned gets a default placeholder avatar
- **Client-side sorting**: click numeric columns to sort high ↔ low

## Prerequisites

- `Node.js` 18+ (or Docker)
- A `Jira` account with API access
- A `Jira` API token (see setup below)

## Setup

### 1. Get Your `Jira` API Token

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a label (e.g., "`Jira` Shame App")
4. Copy the token (you won't be able to see it again)

### 1a. Get Your GitHub Personal Access Token (Optional - for Pull Requests route)

To use the `/pr` route, you'll need a GitHub personal access token:

#### Recommended: Fine-grained token

Create a **fine-grained** PAT with:

- **Resource owner**: your org (or your user, if you only need personal repos)
- **Repository access**: the repos you want included (or “All repositories”)
- **Repository permissions**:
  - **Pull requests**: Read-only
  - **Contents**: Read-only (needed for repo metadata in some org setups)
  - **Metadata**: Read-only (typically required)

Then add it to your `.env` as `GITHUB_TOKEN`.

#### Alternative: Classic token

If you prefer a classic PAT:

- Use `repo` (private repos) or `public_repo` (public-only)

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your `Jira` and GitHub credentials:

```env
JIRA_HOST=your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token-here
BOARD_ID=7
GITHUB_TOKEN=your-github-personal-access-token
GITHUB_ORG=your-github-org-name
PORT=3000
NODE_ENV=development
DEBUG=true
```

**Required Variables:**
- `JIRA_HOST`: Your `Jira` instance hostname (without `https://`)
- `JIRA_EMAIL`: Your `Jira` account email address
- `JIRA_API_TOKEN`: The API token you created in step 1
- `BOARD_ID`: Your `Jira` board ID (defaults to `7`)

**Optional Variables:**
- `GITHUB_TOKEN`: Your GitHub personal access token (required for `/pr`)
- `GITHUB_ORG`: Your GitHub organization name (required for `/pr`)
- `PORT`: Port to run the server on (defaults to `3000`)
- `NODE_ENV`: Defaults to whatever your runtime provides; used to default debug logging (debug is on unless `NODE_ENV=production`)
- `DEBUG`: Set to `true` to enable debug logging; set to `false` to silence debug logs
- `TZ`: Timezone for sprint dates and reports (e.g. `America/New_York`). Defaults to `America/New_York`.

#### Docker Compose note: `JIRA_BOARD_ID`

`docker-compose.yaml` maps `BOARD_ID` inside the container from `JIRA_BOARD_ID` on your host:

- Set **either** `BOARD_ID` (for local runs) **or** `JIRA_BOARD_ID` (for docker-compose), or set both to the same value.

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

### Docker (Development)

Build and run with Docker Compose:

```bash
docker-compose up --build
```

By default, docker-compose maps the container's port 3000 to `http://localhost:1337`.

Or build and run manually:

```bash
docker build -t jira-shame .
docker run -p 3000:3000 --env-file .env jira-shame
```

### Production Deployment

For production deployment, see [PRODUCTION.md](PRODUCTION.md) for detailed instructions including:
- Production Docker setup
- PM2 process management
- Reverse proxy configuration (Nginx/Apache)
- Security considerations
- Monitoring and scaling options

## Development

### Project Structure

```
jira-shame/
├── config/           # Configuration management
├── routes/           # Express route handlers
├── services/        # API service layer (Jira, GitHub)
├── transformers/    # Data transformation utilities
├── utils/           # Shared utilities (logger, API client, etc.)
├── templates/       # EJS templates
├── public/          # Static assets (CSS, JS, images)
└── server.js        # Express app entry point
```

### Hot Reload

The application uses `nodemon` for hot reload during development. The `nodemon.json` configuration watches:
- `server.js`
- `routes/`, `services/`, `utils/`, `config/` directories
- `templates/` directory
- Files with extensions: `.js`, `.json`, `.ejs`

Run `npm run dev` to start the development server with hot reload.

## Notes

- **Debug logging**: this app gates verbose logging behind `DEBUG`. If `DEBUG` is not set, it defaults to **on** unless `NODE_ENV=production`.
- **Navigation**: some routes (like `/pr`) may be intentionally hidden from the nav/landing page until configured, but the route still exists.
- **HTMX Navigation**: All navigation uses HTMX for SPA-like behavior without full page reloads. Query parameters are preserved across navigation.
- **Lazy Loading**: Images are lazy-loaded for better performance.
- **Error Handling**: Comprehensive error handling with retry logic and user-friendly error messages.

## License

This project is licensed under the **GNU `Affero` General Public License v3.0 (or later)**. See `LICENSE`.

## Routes

- `GET /` - Main dashboard with links to all reports
- `GET /slow` - Slow Motion report showing stagnant tickets
- `GET /done` - Completed tickets report (supports `?period=today|yesterday|this-week|last-7-days|this-month|last-month`)
- `GET /backlog` - Backlog report showing all issues not in active sprint, sorted by creation date
- `GET /progress` - Progress report showing issues that changed status in a selected time period
- `GET /pr` - Pull Requests report showing all open pull requests with review status across GitHub organization
- `GET /load` - Load report showing current sprint board-column load + future sprint load per assignee
- `GET /sweat` - Sweat: developer productivity by sprint (assigned vs completed per person)

## Architecture

The application follows a modular architecture:

- **Routes** (`routes/`) - Express route handlers, one file per route
- **Services** (`services/`) - API interaction layer for Jira and GitHub
- **Transformers** (`transformers/`) - Data transformation utilities (date formatting, duration calculations, issue processing)
- **Utils** (`utils/`) - Shared utilities (API client, logger, error handling, caching)
- **Config** (`config/`) - Centralized configuration management
- **Templates** (`templates/`) - EJS templates for server-side rendering
- **Public** (`public/`) - Static assets (CSS, JavaScript, images)

### Key Features

- **HTMX-powered SPA**: Single-page application experience without full page reloads
- **Server-side rendering**: EJS templates for fast initial page loads
- **Error handling**: Comprehensive error boundaries and retry logic
- **Loading indicators**: Progress indicators for long-running operations
- **Dark mode**: Solarized dark theme with persistence
- **Client-side caching**: Session storage for improved performance
- **Parallel API requests**: Optimized API calls using Promise.all()
- **Rate limiting**: Graceful handling of API rate limits
- **Retry logic**: Exponential backoff for transient failures

## Technologies Used

- **`express`** - Web server framework
- **`ejs`** - Template engine for server-side rendering
- **`htmx`** - SPA-like navigation without full page reloads
- **`axios`** - HTTP client for `Jira` and GitHub API requests
- **`moment`** - Date manipulation and calculations
- **`dotenv`** - Environment variable management

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

