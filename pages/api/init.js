import {db} from '../../db.js';

export default async (_, res) => {
  await db.task(async t => {
    await t.none('DROP TABLE IF EXISTS message');
    await t.none('DROP TABLE IF EXISTS replicache_client');
    await t.none('DROP SEQUENCE IF EXISTS version');
    // Stores chat messages
    await t.none(`CREATE TABLE message (
      id VARCHAR(21) PRIMARY KEY NOT NULL,
      sender VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      ord BIGINT NOT NULL,
      version BIGINT NOT NULL)`);
    // Stores last mutation ID for each Replicache client
    await t.none(`CREATE TABLE replicache_client (
      id VARCHAR(36) PRIMARY KEY NOT NULL,
      last_mutation_id BIGINT NOT NULL)`);
    // Will be used for computing diffs for pull response
    await t.none('CREATE SEQUENCE version');
  });
  res.send('ok');
};
