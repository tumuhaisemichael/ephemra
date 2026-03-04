// If the connection URL hasn't been provided directly we can compose it
// from the individual DB_* environment variables.  Doing this in the module
// ensures that any import of `prisma` (e.g. within Next API routes) will
// already have a valid DATABASE_URL available.

import { PrismaClient } from '@prisma/client'

// Load dotenv if not already loaded (next build/start may not automatically
// load it before this file is evaluated)
if (!process.env.DATABASE_URL && process.env.DB_HOST) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config();
    const provider = process.env.DATABASE_PROVIDER || 'mysql';
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || (provider === 'postgresql' ? 5432 : 3306);
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const database = process.env.DB_NAME;

    if (provider === 'mysql') {
        process.env.DATABASE_URL = `mysql://${user}:${password}@${host}:${port}/${database}`;
    } else if (provider === 'postgresql') {
        process.env.DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
    } else {
        throw new Error(`Unsupported DATABASE_PROVIDER: ${provider}. Use 'mysql' or 'postgresql'.`);
    }
    console.log(`[Prisma] constructed DATABASE_URL for ${provider}`);
}

// Ensure the database schema is up-to-date when this module loads. This is a
// secondary safety net in case the `server.js` migration logic didn't run or
// the app is started in an environment where migrations haven't been applied.
// `prisma db push` will create missing tables but won't overwrite existing
// data.
try {
    if (typeof window === 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { execSync } = require('child_process');
        console.log('[Prisma] applying schema (db push)');
        execSync('npx prisma db push', { stdio: 'inherit' });
    }
} catch (err) {
    console.warn('[Prisma] schema push failed, continuing anyway', err);
}

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log: ['query'],
    })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
