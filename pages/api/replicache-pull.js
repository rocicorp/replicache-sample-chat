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
        'select id, sender, content, ord, attachment from message where version > $1',
        parseInt(pull.cookie ?? 0),
      );
      const cookie = (
        await t.one('select max(version) as version from message')
      ).version;
      console.log({cookie, lastMutationID, changed});

      const attachments = [];
      const patch = changed.map(row => {
        if (row.attachment) {
          attachments.push(row.attachment);
        }
        return {
          op: 'put',
          key: `message/${row.id}`,
          value: {
            from: row.sender,
            content: row.content,
            order: parseInt(row.ord),
            attachment: row.attachment,
          },
        };
      });

      for (const attachment of attachments) {
        const res = await t.oneOrNone(
          `SELECT 1 as present FROM blob WHERE hash = $1`,
          attachment,
        );
        if (res) {
          patch.push({
            op: 'put',
            key: `blob/${attachment}`,
            value: {uploaded: true},
          });
        }
      }

      res.json({
        lastMutationID,
        cookie,
        patch,
      });
      res.end();
    });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.toString());
  }
};
