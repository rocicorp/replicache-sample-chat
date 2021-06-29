import pgInit from 'pg-promise';

const pgp = pgInit();
export const db = pgp(process.env.REPLICHAT_DB_CONNECTION_STRING);
