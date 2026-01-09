import express from 'express';
import cors from 'cors';
import session from 'express-session';
import authRoutes, { initializeOIDCClient } from './routes/auth.js';
import datasetRoutes from './routes/dataset.js';
import { testConnection, initializeSchema } from './config/database.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the server directory
config({ path: join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'dashboard.sid', // Custom session name
  cookie: {
    secure: false, // Set to false for localhost (set to true in production with HTTPS)
    httpOnly: true, // Prevent XSS attacks
    sameSite: 'lax', // Allow cookie to be sent on cross-site requests (needed for Cognito redirect)
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/' // Ensure cookie is available for all paths
  }
}));

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true // Allow cookies to be sent
}));
// Increase body parser limit to handle large CSV files (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


const checkAuth = (req, res, next) => {
  if (!req.session.userInfo) {
      req.isAuthenticated = false;
  } else {
      req.isAuthenticated = true;
  }
  next();
};

app.get('/', (req, res) => {
  res.json({ 
    message: 'Data Dashboard API',
    frontend: 'http://localhost:3000',
    endpoints: {
      health: '/api/health',
      auth: '/auth',
      dataset: '/api/dataset'
    }
  });
});

// Routes
app.get('/api', (req, res) => {
  res.json({ message: 'Welcome to Data Dashboard API' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authentication routes
app.use('/auth', authRoutes);

// Dataset routes
app.use('/api/dataset', datasetRoutes);

// Initialize database connection and schema
testConnection().then(async (connected) => {
  if (connected) {
    await initializeSchema();
  }
}).catch(err => {
  console.error('Database initialization failed. The server will continue but database features will not work.');
});

// Initialize OIDC client on startup
// Note: Make sure to set up your environment variables before starting the server
initializeOIDCClient().catch(err => {
  console.error('Failed to initialize OIDC client. Make sure your Cognito configuration is correct.');
  console.error('You can still run the server, but authentication routes will not work.');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Make sure to configure your Cognito OIDC settings in server/config/cognito-oidc.js`);
});

