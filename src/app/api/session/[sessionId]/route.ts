import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs/promises';
import path from 'path';

export async function DELETE(
    req: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    const { sessionId } = params;

    try {
        // 1. Delete files from disk
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads', sessionId);
        try {
            await fs.rm(uploadsDir, { recursive: true, force: true });
        } catch (e) {
            console.warn(`Could not delete directory for session ${sessionId}`, e);
        }

        // 2. Delete from DB (Cascade will handle Media records)
        await prisma.chatSession.delete({
            where: { id: sessionId },
        });

        return NextResponse.json({ success: true, message: 'Session and all data permanently deleted' });
    } catch (error) {
        console.error('Session deletion error:', error);
        return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
    }
}
