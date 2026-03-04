'use client';

import { useEffect, useState, useRef } from 'react';
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
  Video as VideoIcon,
  Mic,
  MicOff,
  AlertCircle,
  Zap,
  Lock
} from 'lucide-react';
import { generateKey, encryptMessage, decryptMessage, encryptFile, decryptFile } from '@/lib/crypto';
import Peer from 'simple-peer';

interface Message {
  id: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
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
  const [isOtherTyping, setIsOtherTyping] = useState(false);

  // Voice/Video state
  const [isCallActive, setIsCallActive] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerRef = useRef<Peer.Instance | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

        newSocket.on('user-typing', () => setIsOtherTyping(true));
        newSocket.on('user-stop-typing', () => setIsOtherTyping(false));

        newSocket.on('session-terminated', () => {
          alert("This session has been permanently destroyed.");
          router.push('/');
        });

        // WebRTC Signaling
        newSocket.on('signal', ({ signal, from }) => {
          if (peerRef.current) {
            peerRef.current.signal(signal);
          } else {
            // Incoming call
            setIsCallActive(true);
            startCall(false, signal);
          }
        });

      } catch (err) {
        console.error('Initialization failed', err);
      }
    };

    init();
    return () => { socket?.disconnect(); };
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOtherTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (!socket) return;

    socket.emit('typing', sessionId);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop-typing', sessionId);
    }, 2000);
  };

  const sendMessage = async () => {
    if (!inputText.trim() || !socket || !cryptoKey) return;
    const msgId = Math.random().toString(36).substr(2, 9);
    const encryptedText = await encryptMessage(inputText, cryptoKey);
    socket.emit('send-message', { sessionId, message: { id: msgId, text: encryptedText, timestamp: Date.now() } });
    setMessages(prev => [...prev, { id: msgId, text: inputText, sender: 'me', timestamp: Date.now() }]);
    setInputText('');
    socket.emit('stop-typing', sessionId);
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
        socket.emit('send-message', { sessionId, message: { id: msgId, mediaUrl: data.url, mediaType: file.type, timestamp: Date.now() } });
        setMessages(prev => [...prev, { id: msgId, mediaUrl: URL.createObjectURL(file), mediaType: file.type, sender: 'me', timestamp: Date.now() }]);
      }
    } catch (err) { alert('Upload failed'); } finally { setIsUploading(false); }
  };

  const startCall = async (initiator: boolean, incomingSignal?: any) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const peer = new Peer({
        initiator,
        trickle: false,
        stream
      });

      peer.on('signal', (data) => {
        socket?.emit('signal', { sessionId, signal: data });
      });

      peer.on('stream', (remoteStream) => {
        setRemoteStream(remoteStream);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      });

      if (incomingSignal) peer.signal(incomingSignal);
      peerRef.current = peer;
      setIsCallActive(true);
    } catch (err) {
      console.error("Failed to get media devices", err);
      alert("Could not access camera/microphone.");
    }
  };

  const endCall = () => {
    localStream?.getTracks().forEach(track => track.stop());
    peerRef.current?.destroy();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsCallActive(false);
  };

  const copyInvite = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="chat-layout">
      <div className="scanline"></div>

      <header className="chat-header glass">
        <div className="header-left">
          <div className="secure-pulse">
            <ShieldCheck className="text-accent" size={24} />
          </div>
          <div>
            <h1>EPHEMRA v1.0</h1>
            <div className="flex items-center gap-2">
              <span className="badge-secure">AES-256 E2EE</span>
              <span className="text-xs opacity-40">SESSION_ID: {String(sessionId).slice(0, 8)}</span>
            </div>
          </div>
        </div>
        <div className="header-right">
          <button className={`btn-secondary ${isCallActive ? 'active' : ''}`} onClick={() => isCallActive ? endCall() : startCall(true)}>
            {isCallActive ? <PhoneOff size={18} /> : <Phone size={18} />}
          </button>
          <button className="btn-secondary" onClick={copyInvite}>
            {isCopied ? <Check size={18} className="text-accent" /> : <Copy size={18} />}
          </button>
          <button className="btn-danger" onClick={() => {
            if (confirm("Destroy all data for everyone?")) {
              socket?.emit('destroy-session', sessionId);
              fetch(`/api/session/${sessionId}`, { method: 'DELETE' }).then(() => router.push('/'));
            }
          }}>
            <Trash2 size={18} />
          </button>
        </div>
      </header>

      {isCallActive && (
        <div className="call-overlay glass">
          <div className="video-grid">
            <div className="video-container local">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <span>You (Local)</span>
            </div>
            <div className="video-container remote">
              {remoteStream ? <video ref={remoteVideoRef} autoPlay playsInline /> : <div className="loading-peer">Connecting to peer...</div>}
              <span>Peer (Secure)</span>
            </div>
          </div>
          <button className="btn-danger circular" onClick={endCall}><PhoneOff size={24} /></button>
        </div>
      )}

      <div className="message-area">
        {messages.length === 0 && (
          <div className="welcome-empty">
            <Lock size={48} className="opacity-20 mb-4 mx-auto" strokeWidth={1} />
            <p className="font-mono text-sm uppercase tracking-widest opacity-40">Encryption initialized. Safe to communicate.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`msg-row ${msg.sender}`}>
            <div className="msg-bubble glass">
              {msg.text && <p className="leading-relaxed">{msg.text}</p>}
              {msg.mediaUrl && (
                <div className="media-preview">
                  {msg.mediaType?.startsWith('image') ? <img src={msg.mediaUrl} alt="secure" /> : <video src={msg.mediaUrl} controls />}
                </div>
              )}
              <span className="msg-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        ))}
        {isOtherTyping && (
          <div className="typing-dots">
            <span></span><span></span><span></span>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <footer className="chat-input-area glass">
        <button className="input-action" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          {isUploading ? <Zap className="animate-pulse text-accent" size={20} /> : <Paperclip size={20} />}
        </button>
        <input type="file" ref={fileInputRef} hidden onChange={handleFileUpload} accept="image/*,video/*" />
        <input
          type="text"
          placeholder={isOtherTyping ? "Other is typing..." : "Type an encrypted message..."}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button className="btn-send" onClick={sendMessage} disabled={!inputText.trim()}><Send size={20} /></button>
      </footer>

      <style jsx>{`
        .secure-pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
        .flex { display: flex; }
        .items-center { align-items: center; }
        .gap-2 { gap: 0.5rem; }
        .mx-auto { margin-left: auto; margin-right: auto; }
        .mb-4 { margin-bottom: 1rem; }
        .call-overlay { position: fixed; inset: 20px; z-index: 100; border-radius: 2rem; display: flex; flex-direction: column; padding: 1.5rem; }
        .video-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; min-height: 0; }
        .video-container { position: relative; background: #000; border-radius: 1rem; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .video-container video { width: 100%; height: 100%; object-fit: cover; }
        .video-container span { position: absolute; bottom: 10px; left: 10px; font-size: 0.7rem; background: rgba(0,0,0,0.5); padding: 2px 8px; border-radius: 4px; }
        .circular { width: 60px; height: 60px; border-radius: 50%; margin: 1rem auto 0; padding: 0; }
      `}</style>
    </div>
  );
}
