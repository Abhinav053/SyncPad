const { Pool } = require('pg');
const mongoose = require('mongoose');

console.log(`[PostgreSQL Config] Connecting host=${process.env.POSTGRES_HOST || 'localhost'} port=${process.env.POSTGRES_PORT || 5432} db=${process.env.POSTGRES_DB || 'syncpad'} user=${process.env.POSTGRES_USER || 'syncpad_user'}`);

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'syncpad',
  user: process.env.POSTGRES_USER || 'syncpad_user',
  password: process.env.POSTGRES_PASSWORD || 'syncpad_password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function connectMongoDB() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/syncpad';
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000
    });
    console.log('[MongoDB] Connected successfully to', mongoUri);
  } catch (err) {
    console.warn('[MongoDB Warning] Could not connect to MongoDB:', err.message);
  }
}

async function initPostgresSchema() {
  const fs = require('fs');
  const path = require('path');
  try {
    const schemaPath = path.join(__dirname, '../models/postgres/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pgPool.query(sql);
    console.log('[PostgreSQL] Database tables & indexes initialized.');
  } catch (err) {
    console.warn('[PostgreSQL Warning] Schema initialization skipped/failed:', err.message);
  }
}

module.exports = {
  pgPool,
  connectMongoDB,
  initPostgresSchema
};
