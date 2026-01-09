# Server Setup - AWS Cognito OIDC Authentication

This server uses OpenID Connect (OIDC) with AWS Cognito for authentication.

## Dependencies Added

- `express-session` - Session management
- `openid-client` - OpenID Connect client library
- `ejs` - Template engine (if needed for views)

## Configuration

1. Create a `.env` file in the `server` directory with the following variables:

```env
PORT=3001
NODE_ENV=development
SESSION_SECRET=your-session-secret-key-change-this-in-production

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000

# AWS Cognito Configuration
AWS_USER_POOL_ID=your-user-pool-id-here
AWS_USER_POOL_CLIENT_ID=your-client-id-here
AWS_REGION=us-east-1
AWS_COGNITO_DOMAIN=your-domain.auth.region.amazoncognito.com

# OIDC Redirect URIs (must match Cognito App Client settings)
REDIRECT_URI=http://localhost:3001/auth/callback
REDIRECT_URI_LOGOUT=http://localhost:3000

# AWS Cognito Client Credentials
AWS_CLIENT_ID=your-client-id-here
AWS_CLIENT_SECRET=your-client-secret-here

# AWS S3 Configuration (for storing Parquet files)
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_S3_BUCKET_NAME=your-bucket-name

# PostgreSQL Database Configuration
# For Local PostgreSQL:
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=data_dashboard
# DB_USER=your-postgres-username
# DB_PASSWORD=your-postgres-password
# DB_SSL=false

# For Amazon RDS PostgreSQL:
DB_HOST=your-rds-endpoint.xxxxx.us-east-2.rds.amazonaws.com
DB_PORT=5432
DB_NAME=data_dashboard
DB_USER=your-rds-username
DB_PASSWORD=your-rds-password
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
```

2. Configure your Cognito App Client:
   - Enable "Authorization code grant" flow
   - Add `http://localhost:3001/auth/callback` to allowed callback URLs
   - Add `http://localhost:3000` to allowed sign-out URLs
   - Enable "openid", "email", and "profile" scopes

## Authentication Routes

- `GET /auth/login` - Initiates OIDC login flow (redirects to Cognito)
- `GET /auth/callback` - Handles OIDC callback from Cognito
- `GET /auth/logout` - Logs out user and redirects to Cognito logout
- `GET /auth/user` - Returns current user information if authenticated

## Usage

The authentication routes are set up but require proper Cognito configuration. Once configured, users can:

1. Visit `/auth/login` to start the authentication flow
2. Be redirected to Cognito for login
3. Be redirected back to `/auth/callback` after authentication
4. Session will be stored with user information
5. Use `/auth/user` to check authentication status

## Protected Routes

Use the `requireAuth` middleware from `routes/auth.js` to protect routes:

```javascript
import { requireAuth } from './routes/auth.js';

app.get('/api/protected', requireAuth, (req, res) => {
  res.json({ message: 'This is a protected route', user: req.session.user });
});
```

