# JIRA Regression Ticket Manager

A web-based tool for scheduling JIRA regression test tickets from an Excel test case management sheet (TCM.xlsx).

## Features

- **Team dashboard** — landing page shows all teams with scheduled/pending stats and progress bars
- **Test case table** — per-team view with sortable, filterable DataTable
- **Inline editing** — change assignee (dropdown from BaseData), estimate, and Schedule? (Y/N toggle) directly in the table
- **Smart select** — Select All only picks Y (scheduled) rows; N rows must be manually checked
- **Floating Schedule button** — appears when rows are selected, shows count
- **JIRA sub-task creation** — creates Sub-tasks linked to parent tickets with description copied from parent
- **Success state** — modal switches to a list of created ticket URLs after scheduling
- **Copy URLs** — one-click copy of all created ticket URLs to clipboard
- **Download CSV** — exports created tickets as a tab-separated file (Excel-friendly)
- **LocalStorage** — remembers email, due date, and release across sessions (never saves API token)

## Prerequisites

- Node.js 18+
- A `TCM.xlsx` file placed in the project root (see Excel format below)
- A Maxxton JIRA account with API token access

## Setup

```bash
npm install
```

## Running

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## TCM.xlsx Format

The workbook must have the following sheets:

| Sheet | Purpose |
|-------|---------|
| `BaseData` | Name → JIRA Account ID mapping (used for assignee dropdown) |
| `Instructions` | Ignored |
| `Summary` | Ignored |
| `Template` | Ignored |
| Any other sheet | Treated as a team sheet |

### Team sheet structure

- **Rows 0–5**: Metadata (release name, API token placeholder, stats)
- **Header row**: The first row where column 0 = `Key`
- **Data rows**: One ticket per row after the header

Expected columns (in order): `Key`, `Summary`, `Priority`, `Component`, `Epic Link`, `Assignee`, `Estimate`, `Schedule?`, `Execution Priority`, `Execution By`, `Test Result Ticket`, `Comments`

### BaseData sheet structure

| Column A | Column B |
|----------|----------|
| Name | JIRA Account ID |

## Project Structure

```
JIRA/
├── server.js           # Express server + JIRA API proxy
├── package.json
├── TCM.xlsx            # Test case management workbook (required, not committed)
└── public/
    ├── index.html      # Single-page UI
    ├── css/
    │   └── style.css   # Custom styles
    └── js/
        └── app.js      # Frontend logic
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/teams` | List all teams with stats |
| `GET` | `/api/teams/:name` | Get tickets + baseData for a team |
| `POST` | `/api/schedule` | Create JIRA sub-tasks for selected tickets |

## Scheduling

1. Select tickets using checkboxes (or **Select All** for Y rows)
2. Click **Schedule Selected** (header button or floating pill)
3. Enter your Maxxton email and JIRA API token
4. Set due date and confirm the release name
5. Click **Schedule** — sub-tasks are created as children of each parent ticket

The JIRA base URL is hardcoded to `https://maxxton.atlassian.net`.

## Notes

- API tokens are **never** saved to localStorage or persisted anywhere
- The tool creates **Sub-task** issue types only
- Sub-task description is copied from the parent ticket automatically
- Summary format: `Test Result for {parent summary} - Release {release}`
