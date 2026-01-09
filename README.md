# Data Dashboard

A modern data visualization dashboard built with React (Vite) and Node.js/Express.

## Project Structure

```
Data Dashboard/
├── client/          # React frontend (Vite)
├── server/          # Express backend
└── package.json     # Root package.json for running both
```

## Getting Started

### Installation

Install all dependencies (root, server, and client):

```bash
npm run install:all
```

### Development

Run both frontend and backend concurrently:

```bash
npm run dev
```

Or run them separately:

```bash
# Terminal 1 - Backend
npm run dev:server

# Terminal 2 - Frontend
npm run dev:client
```

### Access

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

## Tech Stack

- **Frontend**: React 18, Vite, React Router
- **Backend**: Node.js, Express.js
- **Authentication**: AWS Cognito (via AWS Amplify)
- **Styling**: CSS3 with modern design

## AWS Cognito Setup

1. Create an AWS Cognito User Pool:
   - Go to AWS Console → Cognito → User Pools
   - Create a new User Pool
   - Note your User Pool ID and App Client ID

2. Configure environment variables:
   - Copy `client/.env.example` to `client/.env`
   - Fill in your AWS Cognito credentials:
     ```
     VITE_AWS_USER_POOL_ID=your-user-pool-id
     VITE_AWS_USER_POOL_CLIENT_ID=your-client-id
     VITE_AWS_REGION=us-east-1
     ```

3. Configure Cognito App Client:
   - Enable "ALLOW_USER_PASSWORD_AUTH" authentication flow
   - Enable "ALLOW_REFRESH_TOKEN_AUTH" authentication flow

## API Endpoints

- `GET /api` - Welcome message
- `GET /api/health` - Health check endpoint

## Routes

- `/` - Home page
- `/login` - Login/Sign up page

