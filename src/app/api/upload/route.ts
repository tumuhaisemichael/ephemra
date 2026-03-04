import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const sessionId = formData.get('sessionId') as string;

        if (!file || !sessionId) {
            return NextResponse.json({ error: 'Missing file or sessionId' }, { status: 400 });
        }

        // Verify session exists
        const session = await prisma.chatSession.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const uploadsDir = path.join(process.cwd(), 'public', 'uploads', sessionId);
        await fs.mkdir(uploadsDir, { recursive: true });

        const filename = `${uuidv4()}-${file.name}`;
        const filePath = path.join(uploadsDir, filename);
        await fs.writeFile(filePath, buffer);

        const media = await prisma.media.create({
            data: {
                sessionId,
                filename,
                fileType: file.type,
            },
        });

        return NextResponse.json({
            id: media.id,
            url: `/uploads/${sessionId}/${filename}`,
            type: media.fileType
        });
    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
