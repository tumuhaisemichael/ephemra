# Ephemra Deployment Guide

## Environment Setup

Before deploying Ephemra to your server with a real database, create a `.env` file in the project root with the following variables:

### Required Configuration

```bash
# Database connection details (example shows PostgreSQL)
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://username:password@host:5432/ephemra?schema=public

# Server port (optional, defaults to 3002)
PORT=3002

# Environment (set to 'production' for deployment)
NODE_ENV=production
```

### Supported Databases

The app supports any database that Prisma supports:
- **PostgreSQL** (recommended for production)
- **MySQL**
- **SQLite** (suitable for development/small deployments)
- **SQL Server**
- **MongoDB**

### Example Connection Strings

**PostgreSQL:**
```
postgresql://user:password@localhost:5432/ephemra?schema=public
```

**MySQL:**
```
mysql://user:password@localhost:3306/ephemra
```

**SQLite (file-based):**
```
file:./prod.db
```

## Database Initialization

The application automatically handles database setup on startup:

1. **Automatic Schema Sync**: When the server starts, it runs Prisma migrations to ensure the database schema is in place.
   - In **production** (`NODE_ENV=production`), migrations are formally applied using `prisma migrate deploy`
   - In **development**, the schema is synced directly using `prisma db push`

2. **Tables Created**: The following tables are automatically created if they don't exist:
   - `ChatSession` - Stores ephemeral chat session metadata
   - `Media` - Stores media file references linked to sessions

## Getting Started

### Local Development

1. Copy `.env.example` to `.env` and update with your database credentials:
   ```bash
   cp .env.example .env
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

   The server will:
   - Load environment variables from `.env`
   - Run database schema sync
   - Start on the configured PORT

### Production Deployment

1. Ensure `.env` is configured on your server with valid database credentials

2. Install dependencies:
   ```bash
   npm install --production
   ```

3. Build the Next.js app:
   ```bash
   npm run build
   ```

4. Start the server:
   ```bash
   npm start
   ```
   Or use Node directly:
   ```bash
   node server.js
   ```

## Logo Usage

The app uses `public/logo.png` in the following locations:
- **Home page**: Hero section logo
- **Chat header**: Navigation area logo

Ensure `public/logo.png` exists before deployment.

## Features

✅ End-to-End Encrypted (AES-256)
✅ Ephemeral Sessions (auto-cleanup)
✅ Real-time Chat & Calls
✅ Image & File Sharing
✅ No Account Required
✅ Automatic Database Setup

## Notes

- All messages and media are encrypted client-side; the server never has access to plaintext data
- Sessions automatically expire and are purged after the configured duration
- The application will attempt schema sync on every startup; this is safe for production
