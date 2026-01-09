// Database configuration for PostgreSQL
import pg from 'pg';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file BEFORE reading environment variables
config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

// Database configuration
// For Amazon RDS, set DB_HOST to your RDS endpoint (e.g., mydb.xxxxx.us-east-2.rds.amazonaws.com)
// For local development, use localhost
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'data_dashboard',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased for RDS (network latency)
  // SSL configuration for RDS (required for production)
  ssl: process.env.DB_SSL === 'true' || process.env.DB_SSL === '1' ? (() => {
    const sslConfig = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' && process.env.DB_SSL_REJECT_UNAUTHORIZED !== '0'
    };
    
    // If CA certificate path is provided, use it for proper certificate validation
    if (process.env.DB_SSL_CA) {
      try {
        const caPath = process.env.DB_SSL_CA.startsWith('/') 
          ? process.env.DB_SSL_CA 
          : join(__dirname, '..', process.env.DB_SSL_CA);
        sslConfig.ca = readFileSync(caPath);
        console.log('✓ Using RDS CA certificate for SSL validation:', caPath);
      } catch (error) {
        console.warn('⚠️  Warning: Could not read SSL CA certificate file:', process.env.DB_SSL_CA);
        console.warn('   SSL connection will proceed without CA certificate validation.');
      }
    }
    
    return sslConfig;
  })() : false,
};

// Create connection pool
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test database connection
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✓ Database connected successfully');
    console.log('  Database time:', result.rows[0].now);
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    console.error('   Make sure PostgreSQL is running and the database exists.');
    console.error('   For RDS: Ensure your security group allows connections from your IP/EC2 instance.');
    console.error('   Connection config:', {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      ssl: dbConfig.ssl ? 'enabled' : 'disabled',
    });
    return false;
  }
}

// Initialize database schema
export async function initializeSchema() {
  try {
    const schemaPath = join(__dirname, '..', 'db', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    const client = await pool.connect();
    await client.query(schema);
    
    // Run migrations for existing tables
    try {
      const migrationsPath = join(__dirname, '..', 'db', 'migrations', 'add-prev-modification.sql');
      const migration = readFileSync(migrationsPath, 'utf8');
      await client.query(migration);
      console.log('✓ Migration: prev_modification column added (if needed)');
    } catch (migrationError) {
      // Migration file might not exist or column might already exist - that's okay
      console.log('  Migration check skipped or already applied');
    }
    
    client.release();
    
    console.log('✓ Database schema initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Error initializing database schema:', error.message);
    return false;
  }
}

// Execute a query
export async function query(text, params) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (error) {
    console.error('Query error:', error);
    throw error;
  }
}

// Get a client from the pool
export async function getClient() {
  return await pool.connect();
}

// Export the pool for direct access if needed
export { pool };

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database pool...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Closing database pool...');
  await pool.end();
  process.exit(0);
});

