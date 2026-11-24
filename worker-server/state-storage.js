'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function stateStorage(filename, databaseUrl) {
  let client;
  async function readFile() {
    try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  }
  return {
    async load() {
      if (!databaseUrl) return readFile();
      const {Client} = require('pg');
      client = new Client({connectionString: databaseUrl});
      await client.connect();
      // The coordinator owns an in-memory queue. Only one writer may serve it.
      const lock = await client.query('SELECT pg_try_advisory_lock(1727341, 1) AS acquired');
      if (!lock.rows[0].acquired) throw Error('Another coordinator owns this database');
      await client.query('CREATE TABLE IF NOT EXISTS pocketmind_state (id smallint PRIMARY KEY, snapshot jsonb NOT NULL)');
      const saved = await client.query('SELECT snapshot FROM pocketmind_state WHERE id = 1');
      if (saved.rowCount) return saved.rows[0].snapshot;
      const legacy = await readFile();
      if (legacy) await this.save(JSON.stringify(legacy));
      return legacy;
    },
    async save(snapshot) {
      if (databaseUrl) {
        await client.query('INSERT INTO pocketmind_state VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot', [snapshot]);
        return;
      }
      await fs.mkdir(path.dirname(filename), {recursive:true});
      await fs.writeFile(filename + '.tmp', snapshot, {mode:0o600});
      await fs.rename(filename + '.tmp', filename);
    },
    async close() { if (client) await client.end(); },
  };
}
module.exports = {stateStorage};
