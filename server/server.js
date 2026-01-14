import express from 'express';
import cors from 'cors';
import session from 'express-session';
import authRoutes, { initializeOIDCClient } from './routes/auth.js';
import datasetRoutes from './routes/dataset.js';
import { testConnection, initializeSchema } from './config/database.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// load env vars
config({ path: join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// setup sessions to track logged in users
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'dashboard.sid', // cookie name
  cookie: {
    secure: false, // set true when using https
    httpOnly: true, // prevents js from reading cookie
    sameSite: 'lax', // needed for cognito redirects
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/' // available on all paths
  }
}));

// allow frontend to make requests
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true // required for cookies
}));
// handle large csv uploads
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

// simple routes
app.get('/api', (req, res) => {
  res.json({ message: 'Welcome to Data Dashboard API' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// auth routes
app.use('/auth', authRoutes);

// dataset routes
app.use('/api/dataset', datasetRoutes);

// connect to database
testConnection().then(async (connected) => {
  if (connected) {
    await initializeSchema();
  }
}).catch(err => {
  console.error('Database initialization failed. The server will continue but database features will not work.');
});

// setup cognito, make sure .env has the keys
initializeOIDCClient().catch(err => {
  console.error('Failed to initialize OIDC client. Make sure your Cognito configuration is correct.');
  console.error('You can still run the server, but authentication routes will not work.');
});

// start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Make sure to configure your Cognito OIDC settings in server/config/cognito-oidc.js`);
});

