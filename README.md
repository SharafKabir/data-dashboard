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
- **Database** RDS PostgreSQL server
- **Styling**: CSS3 with modern design

Currently working on deploying using AWS EC2 and CloudFront!
