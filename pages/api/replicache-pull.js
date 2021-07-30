import {db} from '../../db.js';

export default async (req, res) => {
  const pull = req.body;
  console.log(`Processing pull`, JSON.stringify(pull));
  const t0 = Date.now();

  try {
    await db.tx(async t => {
      const lastMutationID = parseInt(
        (
          await t.oneOrNone(
            'select last_mutation_id from replicache_client where id = $1',
            pull.clientID,
          )
        )?.last_mutation_id ?? '0',
      );
      const changed = await t.manyOrNone(
        'select id, sender, content, ord from message where version > $1',
        parseInt(pull.cookie ?? 0),
      );
      const cookie = (
        await t.one('select max(version) as version from message')
      ).version;
      console.log({cookie, lastMutationID, changed});

      res.json({
        lastMutationID,
        cookie,
        patch: changed.map(row => ({
          op: 'put',
          key: `message/${row.id}`,
          value: {
            from: row.sender,
            content: row.content,
            order: parseInt(row.ord),
          },
        })),
      });
      res.end();
    });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.toString());
  }
};
