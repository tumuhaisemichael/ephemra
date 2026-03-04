const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    });

    const io = new Server(server, {
        cors: { origin: "*", methods: ["GET", "POST"] },
        maxHttpBufferSize: 1e8 // 100mb for media transfers
    });

    io.on('connection', (socket) => {
        socket.on('join-session', (sessionId) => {
            socket.join(sessionId);
            console.log(`[Socket] User ${socket.id} joined session ${sessionId}`);
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
