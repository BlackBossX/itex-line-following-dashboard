const { initialState, normalizeScores } = require('./competition');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
function openStore(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL, robot_name TEXT NOT NULL, session TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 4), data TEXT NOT NULL, PRIMARY KEY(team_id, number));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const save = db.transaction(state => {
    // The complete competition is small; one transaction keeps roster, attempts and timers consistent.
    db.prepare('DELETE FROM attempts').run(); db.prepare('DELETE FROM teams').run();
    const teamInsert = db.prepare('INSERT INTO teams VALUES (?, ?, ?, ?)');
    const attemptInsert = db.prepare('INSERT INTO attempts VALUES (?, ?, ?)');
    for (const t of state.teams) {
      teamInsert.run(t.id, t.name, t.robotName, JSON.stringify(t.session));
      for (const a of t.attempts) attemptInsert.run(t.id, a.number, JSON.stringify(a));
    }
    const { teams, ...settings } = state;
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('competition', ?)").run(JSON.stringify(settings));
  });
  function load() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'competition'").get();
    if (!row) {
      const state = initialState();
      save(state); return state;
    }
    const attempts = db.prepare('SELECT * FROM attempts ORDER BY number').all();
    const state = { ...JSON.parse(row.value), teams: db.prepare('SELECT * FROM teams ORDER BY id').all().map(t => ({ id: t.id, name: t.name, robotName: t.robot_name, session: JSON.parse(t.session), attempts: attempts.filter(a => a.team_id === t.id).map(a => JSON.parse(a.data)) })) };
    if (normalizeScores(state)) save(state);
    return state;
  }
  return { db, load, save };
}
module.exports = { openStore };
