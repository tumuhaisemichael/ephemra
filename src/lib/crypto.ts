/**
 * Simple E2EE wrapper using Web Crypto API (AES-GCM)
 */

export async function generateKey(secret: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: enc.encode('ephemra-salt'), // In production, use a unique salt
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptMessage(message: string, key: CryptoKey): Promise<string> {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(message)
    );

    // Combine IV and Ciphertext for transport
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...Array.from(combined)));
}

export async function decryptMessage(encryptedBase64: string, key: CryptoKey): Promise<string> {
    const combined = new Uint8Array(
        atob(encryptedBase64)
            .split('')
            .map((c) => c.charCodeAt(0))
    );

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );

    return new TextDecoder().decode(decrypted);
}

// For media files
export async function encryptFile(file: File, key: CryptoKey): Promise<Blob> {
    const buffer = await file.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        buffer
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return new Blob([combined], { type: 'application/octet-stream' });
}

export async function decryptFile(blob: Blob, key: CryptoKey, mimeType: string): Promise<string> {
    const combined = new Uint8Array(await blob.arrayBuffer());
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );

    const decryptedBlob = new Blob([decrypted], { type: mimeType });
    return URL.createObjectURL(decryptedBlob);
}
