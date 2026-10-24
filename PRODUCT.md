# ITEX 2.0 competition dashboard

An on-site line-following competition tool for operators, judges, coordinators and the audience. It runs as one Node.js server on a trusted event LAN. Staff control and APIs are unauthenticated; coordinator permissions limit actions on that connection, not access to event data.

## Surfaces and responsibilities

- `/admin`: manage teams and running order, calibration, run timing, attempt records, judges' marks, standings, resets and winner announcements.
- `/coordinator`: scan every team's marks in running order; independently select a team to view marks and best attempts alongside live standings. Corrections to saved marks, completion and time unlock only after rounds finish and judges save marks for every recorded attempt. Original marks remain the judges’ responsibility in competition control; coordinator connections accept only eligible `EDIT_ATTEMPT` corrections. The coordinator navigation omits Control. Selection here never switches the team at competition control or interrupts its timer. Changes appear on both staff screens.
- `/display`: audience team order with a precompetition shuffle button, timing, attempt times, course briefing and announced winner names. Admin can select the team-list view with Show team list on display. Display connections can only shuffle while that view is active; no other writes are permitted. The Winners & rankings section in control has a Show scores on display button. The score display shows only first, second and third place; Announce winner continues to show first place only. Only the selected rankings view publishes team places, best combined totals and best-attempt times to the audience; all other audience views omit scores and rankings. Individual judge marks remain excluded from every audience view. This display separation is not authentication.
- `/rules`: course map and competition briefing. `/` links to the event surfaces.

## Competition rules

Fresh competitions start with five teams. Operators may rename teams and use Add team; robot names have no UI fields or labels. A full reset restores the five-team roster only when explicitly selected. Startup reduces an untouched legacy 32-team placeholder roster; entered names, scores, attempts and timing data prevent that automatic replacement.

Before any calibration or run starts, operators may shuffle the team order. The server draws and broadcasts one shared order, persists it in SQLite, and places later additions at the end. Starting calibration or a run locks shuffling until competition data is reset. The draw reveal respects reduced motion. The public team list animates the new order in place.

Each team has optional two-minute calibration, a ten-minute run window and at most four attempts. Calibration and the run window can be paused and resumed; calibration does not start the run automatically. Starting an attempt consumes one attempt. Stopping stores time immediately, allowing marks to be entered later. Run expiry stops an active attempt and leaves it incomplete pending marks.

Each attempt's combined score is three judges' totals plus a single 100-mark bonus when entire-course completion is checked. Zero is valid. Completion is never inferred from stopping a timer. Ranking uses each team's highest combined score; ties use its shortest recorded time at that same score. Completion status affects the bonus; recorded time breaks equal-score ties regardless of completion status. Exact ties share rank. Only saved scored attempts count, and operators can announce results at any point without stopping active timers.

A team’s rounds finish once all four attempts have stopped or its run window ends. A paused window with unused attempts remains ongoing. Coordinator corrections require at least one recorded attempt, no running attempt, and saved judge marks for every recorded attempt; the server enforces these rules.

## Persistence and correction safeguards

SQLite preserves roster order, selected team, attempts, marks, deadlines, paused time and display state. Running deadlines remain authoritative across disconnects and restarts. Saves acknowledge only after the transaction commits. Attempt revisions reject stale concurrent corrections; team generations and competition reset versions reject submissions from before a reset. Team reset retains the name while clearing that team's timing and marks. Full reset clears competition data, optionally restores the default roster, and requires explicit confirmation. JSON export is a results snapshot, not a restore format.

## Identity and imagery provenance

Retain the supplied event assets unchanged: `public/assets/itex-logo.png`, `school-logo.png` and `ICTnew.png` are existing ITEX, school and ICT Society identity artwork. `public/assets/competition-map.jpg` is the public copy of the supplied root `ITEX-Line-Following-Score-Sheet.jpg`. `public/assets/UI_Admin.png` and `UI_Display.png` are existing README interface previews, not new event imagery. No new shipping raster imagery was created for the coordinator extension.

The four files in `.impeccable/review/` (`desktop.jpg`, `mobile.jpg`, `admin-desktop.jpg`, `admin-mobile.jpg`) are development review captures of the implemented coordinator/admin surfaces, using synthetic sample scores in an isolated temporary database. They are preview evidence, not shipping content or real competition results.

## Implementation references

`README.md` owns operator setup and workflow detail. `server/competition.js` owns competition rules; `server/store.js` owns persistence; `server/index.js` and `server/public-state.js` own staff/audience delivery. `public/app.js` implements shared client behavior. `DESIGN.md` records the observed visual system; `.impeccable/surfaces/staff-review.md` records this extension's surface direction. Keep existing event data and user-managed `public/display-settings.css` settings intact when extending the tool.

## Audience event presentation

The public draw rolls names before locking each position in the server-confirmed order, with optional tick, lock and completion sounds. Animation is presentation only; shared ordering remains server-owned. Live timing keeps stable numerals, uses track motion while running and gold paused states. The winner stage has a first-place device, gold names, bounded confetti and an optional synthesized fanfare. Winner visuals repeat every seven seconds while visible, without changing results or replaying the fanfare; there is no celebration button. The winner name remains steady during repeated confetti and first-place accents. Each admin announcement increments an announcement version so reannouncing the same winner is a new event; ordinary state and clock broadcasts do not replay it. Sound requires an explicit enable gesture and remains muteable. Hidden tabs cancel decorative work and scheduled audio. Reduced-motion preference immediately presents final draw names, suppresses spatial animation and confetti, and preserves event information.
