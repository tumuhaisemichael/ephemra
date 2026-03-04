'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  Send,
  Image as ImageIcon,
  ShieldCheck,
  Trash2,
  Paperclip,
  Copy,
  Check,
  Phone,
  PhoneOff,
  AlertCircle
} from 'lucide-react';
import { generateKey, encryptMessage, decryptMessage, encryptFile, decryptFile } from '@/lib/crypto';

interface Message {
  id: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string; // e.g. 'image/png'
  sender: 'me' | 'other';
  timestamp: number;
}

export default function ChatPage() {
  const { sessionId } = useParams();
  const router = useRouter();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize E2EE and Socket
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;

    const init = async () => {
      try {
        const key = await generateKey(hash);
        setCryptoKey(key);

        const newSocket = io();
        setSocket(newSocket);
        newSocket.emit('join-session', sessionId);

        newSocket.on('receive-message', async (encryptedMsg: any) => {
          try {
            let decryptedText = '';
            let decryptedUrl = '';

            if (encryptedMsg.text) {
              decryptedText = await decryptMessage(encryptedMsg.text, key);
            } else if (encryptedMsg.mediaUrl) {
              const res = await fetch(encryptedMsg.mediaUrl);
              const blob = await res.blob();
              decryptedUrl = await decryptFile(blob, key, encryptedMsg.mediaType);
            }

            setMessages(prev => {
              if (prev.some(m => m.id === encryptedMsg.id)) return prev;
              return [...prev, {
                ...encryptedMsg,
                text: decryptedText || undefined,
                mediaUrl: decryptedUrl || undefined,
                sender: 'other'
              }];
            });
          } catch (e) {
            console.error('Decryption failed', e);
          }
        });

        newSocket.on('session-terminated', () => {
          alert("This session has been permanently destroyed by a participant.");
          router.push('/');
        });

        console.log("🔒 Ephemra: End-to-End Encryption Active.");
      } catch (err) {
        console.error('Initialization failed', err);
      }
    };

    init();
    return () => {
      // Important: Use local variable for cleanup to avoid dependency issues
      const s = socket;
      if (s) s.disconnect();
    };
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!inputText.trim() || !socket || !cryptoKey) return;

    const msgId = Math.random().toString(36).substr(2, 9);
    const encryptedText = await encryptMessage(inputText, cryptoKey);

    socket.emit('send-message', {
      sessionId,
      message: { id: msgId, text: encryptedText, timestamp: Date.now() }
    });

    setMessages(prev => [...prev, {
      id: msgId, text: inputText, sender: 'me', timestamp: Date.now()
    }]);
    setInputText('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socket || !cryptoKey) return;

    setIsUploading(true);
    try {
      const encryptedBlob = await encryptFile(file, cryptoKey);
      const formData = new FormData();
      formData.append('file', encryptedBlob, file.name);
      formData.append('sessionId', sessionId as string);

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.url) {
        const msgId = Math.random().toString(36).substr(2, 9);
        socket.emit('send-message', {
          sessionId,
          message: { id: msgId, mediaUrl: data.url, mediaType: file.type, timestamp: Date.now() }
        });

        setMessages(prev => [...prev, {
          id: msgId, mediaUrl: URL.createObjectURL(file), mediaType: file.type, sender: 'me', timestamp: Date.now()
        }]);
      }
    } catch (err) {
      alert('Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const destroySession = async () => {
    if (confirm("Permanently delete ALL messages and media for ALL participants? This cannot be undone.")) {
      if (socket) socket.emit('destroy-session', sessionId);
      await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
      router.push('/');
    }
  };

  const copyInvite = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="chat-layout">
      <header className="chat-header glass">
        <div className="header-left">
          <ShieldCheck className="text-accent" size={24} />
          <div>
            <h1>Secure Chat</h1>
            <span className="badge-secure">E2EE Active</span>
          </div>
        </div>
        <div className="header-right">
          <button className="btn-secondary" onClick={copyInvite}>
            {isCopied ? <Check size={18} /> : <Copy size={18} />}
            <span>Invite</span>
          </button>
          <button className="btn-danger" onClick={destroySession} title="Destroy Session">
            <Trash2 size={18} />
          </button>
        </div>
      </header>

      <div className="message-area">
        {messages.length === 0 && (
          <div className="welcome-empty">
            <AlertCircle size={48} className="opacity-20 mb-4" />
            <p>No messages yet. Send an invite link to start chatting.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`msg-row ${msg.sender}`}>
            <div className="msg-bubble glass">
              {msg.text && <p>{msg.text}</p>}
              {msg.mediaUrl && (
                <div className="media-preview">
                  {msg.mediaType?.startsWith('image') ? (
                    <img src={msg.mediaUrl} alt="shared" />
                  ) : (
                    <video src={msg.mediaUrl} controls />
                  )}
                </div>
              )}
              <span className="msg-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      <footer className="chat-input-area glass">
        <button className="input-action" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          <Paperclip size={20} />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          hidden
          onChange={handleFileUpload}
          accept="image/*,video/*"
        />
        <input
          type="text"
          placeholder={isUploading ? "Encrypting media..." : "Type a secure message..."}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button className="btn-send" onClick={sendMessage} disabled={!inputText.trim()}>
          <Send size={20} />
        </button>
      </footer>
    </div>
  );
}
