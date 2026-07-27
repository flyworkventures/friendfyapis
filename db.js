const mysql = require('mysql2/promise');
const { createLogger } = require('./utils/logger');
require('dotenv').config();

const log = createLogger('DATABASE');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'flywork1_friendify',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_LIMIT, 10) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT_MS, 10) || 10000,
  dateStrings: ['DATE'],
});

async function testConnection() {
  const startedAt = Date.now();
  try {
    const conn = await pool.getConnection();
    log.info('MySQL bağlantısı OK');
    conn.release();
    return { ok: true, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    log.error('MySQL bağlantı hatası', err.message);
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      code: err.code || null,
      message: err.message,
    };
  }
}

testConnection();

async function getQuery(sql, values) {
  try {
    const [rows] = await pool.query(sql, values);
    return rows;
  } catch (error) {
    log.error('SQL getQuery hatası', error.message);
    throw error;
  }
}

async function query(sql, values) {
  try {
    await pool.query(sql, values);
    return true;
  } catch (error) {
    log.error('SQL query hatası', error.message);
    return false;
  }
}

async function insertQuery(sql, values) {
  try {
    const [result] = await pool.query(sql, values);
    return result?.insertId ?? null;
  } catch (error) {
    log.error('SQL insert hatası', error.message);
    return null;
  }
}

module.exports = { pool, getQuery, query, insertQuery, testConnection };
