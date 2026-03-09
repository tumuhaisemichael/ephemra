// load environment variables from .env so configuration is available
// regardless of where the server is started.  The deploy server should set
// individual database credentials (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD,
// DB_NAME, DATABASE_PROVIDER) which we will use to construct the connection URL.
require('dotenv').config();

// Construct the DATABASE_URL from individual credential environment variables
// if it's not already set. This allows the .env file to use individual credentials
// instead of a full connection string.
if (!process.env.DATABASE_URL && process.env.DB_HOST) {
    const provider = process.env.DATABASE_PROVIDER || 'mysql';
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || (provider === 'postgresql' ? 5432 : 3306);
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const database = process.env.DB_NAME;

    // Construct connection URL based on the database provider
    if (provider === 'mysql') {
        process.env.DATABASE_URL = `mysql://${user}:${password}@${host}:${port}/${database}`;
    } else if (provider === 'postgresql') {
        process.env.DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
    } else {
        throw new Error(`Unsupported DATABASE_PROVIDER: ${provider}. Use 'mysql' or 'postgresql'.`);
    }
    console.log(`[Database] Constructed DATABASE_URL for ${provider}`);
}

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// prior to spinning up the HTTP server we make sure the database schema is
// in place.  On an empty database this will create the tables defined in
// `prisma/schema.prisma`.  We call `prisma migrate deploy` which is safe to run
// in production; for development users `npm run dev` will also execute this
// (see package.json scripts).
app.prepare().then(async () => {
    try {
        console.log('[Database] running migrations / pushing schema');
        // `migrate deploy` applies any migrations that have not yet been
        // executed.  It will create the tables if they don't exist.  In
        // development we fall back to `db push` because migrations may not
        // have been generated yet.
        if (process.env.NODE_ENV === 'production') {
            execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        } else {
            execSync('npx prisma db push', { stdio: 'inherit' });
        }
    } catch (err) {
        console.warn('[Database] schema sync failed, continuing anyway', err);
    }

    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);

        // Serve static files from the public folder (especially for encrypted uploads)
        if (parsedUrl.pathname?.startsWith('/uploads/')) {
            const filePath = path.join(process.cwd(), 'public', parsedUrl.pathname);
            try {
                const fileStream = fsSync.createReadStream(filePath);
                fileStream.pipe(res);
                fileStream.on('error', () => {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('File not found');
                });
            } catch (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            }
            return;
        }

        // All other requests go through Next.js
        handle(req, res, parsedUrl);
    });

    const io = new Server(server, {
        cors: { origin: "*", methods: ["GET", "POST"] },
        maxHttpBufferSize: 1e8 // 100mb for media transfers
    });

    io.on('connection', (socket) => {
        let currentSessionId = null;

        socket.on('join-session', async (sessionId) => {
            socket.join(sessionId);
            currentSessionId = sessionId;
            console.log(`[Socket] User ${socket.id} joined session ${sessionId}`);

            const peers = Array.from(io.sockets.adapter.rooms.get(sessionId) || []).filter((id) => id !== socket.id);
            socket.emit('session-peers', peers);
            socket.to(sessionId).emit('user-joined', socket.id);
        });

        socket.on('send-message', ({ sessionId, message }) => {
            socket.to(sessionId).emit('receive-message', message);
        });

        socket.on('signal', ({ sessionId, signal, to }) => {
            if (to) {
                io.to(to).emit('signal', { signal, from: socket.id });
            } else {
                socket.to(sessionId).emit('signal', { signal, from: socket.id });
            }
        });

        socket.on('destroy-session', (sessionId) => {
            io.to(sessionId).emit('session-terminated');
        });

        socket.on('typing', (sessionId) => {
            socket.to(sessionId).emit('user-typing');
        });

        socket.on('stop-typing', (sessionId) => {
            socket.to(sessionId).emit('user-stop-typing');
        });

        socket.on('disconnect', () => {
            if (currentSessionId) {
                socket.to(currentSessionId).emit('user-left', socket.id);
            }
            console.log(`[Socket] User ${socket.id} disconnected`);
        });
    });

    // Cleanup task every 30 minutes
    setInterval(async () => {
        try {
            console.log('[Cleanup] Checking for expired sessions...');
            const expiredSessions = await prisma.chatSession.findMany({
                where: { expiresAt: { lt: new Date() } }
            });

            for (const session of expiredSessions) {
                const uploadsDir = path.join(process.cwd(), 'public', 'uploads', session.id);
                await fs.rm(uploadsDir, { recursive: true, force: true }).catch(() => { });
                await prisma.chatSession.delete({ where: { id: session.id } }).catch(() => { });
                console.log(`[Cleanup] Deleted expired session: ${session.id}`);
            }
        } catch (err) {
            console.error('[Cleanup] Error:', err);
        }
    }, 30 * 60 * 1000);

    const PORT = process.env.PORT || 3002;
    server.listen(PORT, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${PORT}`);
    });
});
