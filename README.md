# ITEX 2.0 competition dashboard

Run `npm install` then `npm start` (Node.js 20 or newer). Open `/admin` for competition control, `/display` for the audience screen, and `/rules` for the course briefing. Both screens must use the same server address; use the server computer’s LAN address from other devices. This is a trusted-LAN event tool; the control panel has no login.

## Competition workflow

1. Select a team. Rename the placeholder team and robot as needed, or add another team.
2. Start the optional two-minute calibration. It is available once per team, before the run window. You can start the run window early if calibration finishes early.
3. Start the continuous ten-minute run window. It cannot be paused or restarted; calibration expiry does **not** start it automatically.
4. Start and stop each robot attempt. Each start uses one of four attempts. Between attempts the ten-minute window keeps running. At expiry, an active attempt stops automatically and is marked incomplete pending judges’ scores.
5. Enter all three judges’ totals and indicate whether the course was completed. Save the attempt before starting another. Zero is a valid score. No section-by-section entry is required. Use **Edit** to correct a saved score, completion status, or recorded time.
6. Use **Show map & rules** for the team briefing, or **Show live timing** during the competition. Timers continue in either display view.
7. Announce results after active windows end and all attempts are scored. Teams without a scored attempt are unranked. Export results downloads a JSON snapshot of every team, attempt, judge total, and session.

Each attempt’s combined score is the **sum** of the three judges’ totals. A team’s highest combined attempt score is used for ranking. Ties compare the shortest **completion time among attempts at that highest score**. A faster attempt with lower marks does not affect the tie-break. Incomplete attempts retain their marks but have no eligible completion time; a completed attempt wins a score tie against an incomplete attempt. Exact score-and-time ties share the rank and can produce shared first place.

## SQLite persistence

The database is created automatically at `data/competition.sqlite`. Teams, four attempt records, judge totals, scores, times, calibration/run deadlines, the selected team, and the public display mode survive restarts. Timers use absolute server deadlines and continue through browser disconnects and server restarts. An expired active attempt is settled on recovery. A successful save message is sent only after the SQLite transaction commits.

Set `DB_PATH` to override the database location and `PORT` to change the port (default 3000). Back up the database with SQLite’s backup mechanism, or stop the server before copying `data/`; include WAL files if present. Keep the database out of version control. Exported JSON is a portable results snapshot, not a database restore file.

`docker compose up --build -d` runs the dashboard with a named `itex-data` volume at `/app/data`, preserving scores when the container is rebuilt. Do not remove the volume if you need to retain event data.

The source map is `ITEX-Line-Following-Score-Sheet.jpg`; its public copy is `public/assets/competition-map.jpg`.

## Verification

Run `npm test` for scoring, tie-breaks, attempt limits, calibration, deadline expiry, stale edits, and SQLite persistence tests. Run `npm run test:integration` for a real WebSocket and server-restart check using an isolated temporary database on port 3003.
