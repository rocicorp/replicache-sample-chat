// @ts-check

import {db} from '../../../db.js';
import {computeHash} from '../../index.js';
import {webcrypto} from 'crypto';

// @ts-ignore
global.crypto = webcrypto;

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * @param {import("next").NextApiRequest} req
 * @param {import("next").NextApiResponse<any>} res
 */
export default async (req, res) => {
  switch (req.method) {
    case 'PUT':
      putBlob(req, res);
      break;
    case 'GET':
      getBlob(req, res);
      break;
    default:
      res.status(405).send(`Method '${req.method}' Not Allowed`);
  }
};

/**
 * @param {import("next").NextApiRequest} req
 * @param {import("next").NextApiResponse<any>} res
 */
async function putBlob(req, res) {
  const {hash} = req.query;

  if (typeof hash !== 'string' || hash.length !== 64) {
    res.status(404).send(`Invalid hash`);
    return;
  }

  const chunks = [];
  for await (let chunk of req) {
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  const h = await computeHash(data);
  if (h !== hash) {
    res.status(500).send(`Hash does not match`);
    return;
  }

  // You might want to only "upload" the blob to the database if it isn't alrady
  // there.
  await db.none(
    'INSERT INTO blob (hash, data) VALUES($1, $2) ON CONFLICT DO NOTHING',
    [hash, data],
  );

  res.status(201).send(`Uploaded`);
}

/**
 * @param {import("next").NextApiRequest} req
 * @param {import("next").NextApiResponse} res
 */
async function getBlob(req, res) {
  const {hash} = req.query;

  if (typeof hash !== 'string' || hash.length !== 64) {
    res.status(404).send(`Invalid hash`);
    return;
  }

  const r = await db.oneOrNone('SELECT data FROM blob WHERE hash = $1', hash);

  if (!r?.data) {
    res.status(404).send('Not Found');
    return;
  }

  const h = await computeHash(r.data);
  if (h !== hash) {
    res.status(500).send(`Hash does not match`);
    return;
  }

  res.status(200).send(r.data);
}
