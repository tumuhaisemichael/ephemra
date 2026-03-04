'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  Send,
  ShieldCheck,
  Trash2,
  Paperclip,
  Copy,
  Check,
  Phone,
  PhoneOff,
  AlertCircle,
  Lock,
  Zap,
  ShieldOff,
  Video as VideoIcon,
  Mic,
  MicOff,
  PhoneCall,
  X,
  FileText,
  Download,
  File as FileIcon
} from 'lucide-react';
import { generateKey, encryptMessage, decryptMessage, encryptFile, decryptFile } from '@/lib/crypto';
import Peer from 'simple-peer';

// Support for simple-peer in browser
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = require('buffer/').Buffer;
}

interface Message {
  id: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  sender: 'me' | 'other' | 'system';
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
  const [isPurging, setIsPurging] = useState(false);

  // Voice/Video state
  const [isCallActive, setIsCallActive] = useState(false);
  const [incomingSignal, setIncomingSignal] = useState<any>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const peerRef = useRef<Peer.Instance | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Anti-Copy Logic
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 's' || e.key === 'u' || e.key === 'p')) {
        e.preventDefault();
      }
      if (e.key === 'PrintScreen' || (e.ctrlKey && e.key === 'p')) {
        e.preventDefault();
        alert('Security protocol: Screenshots and printing are disabled.');
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Initialize E2EE and Socket
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;

    const init = async () => {
      try {
        const key = await generateKey(hash);
        setCryptoKey(key);

        // Connect to Socket.IO using explicit URL to ensure proper connection
        const newSocket = io(window.location.origin, {
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: 5
        });

        // Log connection events for debugging
        newSocket.on('connect', () => {
          console.log('[Socket] Connected to server');
          newSocket.emit('join-session', sessionId);
        });

        newSocket.on('connect_error', (error) => {
          console.error('[Socket] Connection error:', error);
        });

        newSocket.on('disconnect', () => {
          console.log('[Socket] Disconnected from server');
        });

        setSocket(newSocket);

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
          setIsPurging(true);
          setTimeout(() => router.push('/'), 2500);
        });

        newSocket.on('user-joined', () => {
          setMessages(prev => [
            ...prev,
            { id: 'sys-' + Date.now(), text: 'SECURE_CHANNEL_ESTABLISHED: NEW_PEER_CONNECTED', sender: 'system', timestamp: Date.now() }
          ]);
        });

        newSocket.on('signal', ({ signal }) => {
          if (peerRef.current) {
            try {
              peerRef.current.signal(signal);
            } catch (err) {
              console.warn("Signal handled while stable or redundant.");
            }
          } else if (signal.type === 'offer') {
            setIncomingSignal(signal);
          }
        });

      } catch (err) {
        console.error('Initialization failed', err);
      }
    };

    init();
    return () => {
      socket?.disconnect();
    };
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOtherTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (!socket) return;
    socket.emit('typing', sessionId);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit('stop-typing', sessionId), 2000);
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
        socket.emit('send-message', {
          sessionId,
          message: {
            id: msgId,
            mediaUrl: data.url,
            mediaType: file.type,
            fileName: file.name,
            timestamp: Date.now()
          }
        });
        setMessages(prev => [...prev, {
          id: msgId,
          mediaUrl: URL.createObjectURL(file),
          mediaType: file.type,
          fileName: file.name,
          sender: 'me',
          timestamp: Date.now()
        }]);
      }
    } catch (err) { alert('Upload failed'); } finally { setIsUploading(false); }
  };

  useEffect(() => {
    if (isCallActive && localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [isCallActive, localStream]);

  useEffect(() => {
    if (isCallActive && remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [isCallActive, remoteStream]);

  const startCall = async (initiator: boolean, signalToSignal?: any) => {
    setIsCallActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);

      const peer = new Peer({
        initiator,
        trickle: false,
        stream,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
      });

      peer.on('signal', (data) => {
        socket?.emit('signal', { sessionId, signal: data });
      });

      peer.on('stream', (remote) => {
        setRemoteStream(remote);
      });

      peer.on('error', (err) => {
        console.error('Peer error:', err);
        endCall();
      });

      if (signalToSignal) {
        setTimeout(() => {
          try {
            peer.signal(signalToSignal);
          } catch (e) {
            console.warn("Signal failed", e);
          }
        }, 300);
      }

      peerRef.current = peer;
      setIncomingSignal(null);
    } catch (err) {
      console.error('Start call failed:', err);
      alert("Camera/Mic access required for secure calls.");
      setIsCallActive(false);
      setIncomingSignal(null);
    }
  };

  const endCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (e) { }
    }
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsCallActive(false);
    setIncomingSignal(null);
  };

  if (isPurging) {
    return (
      <div className="purge-overlay">
        <div className="purge-glitch">PURGE_ACTIVE</div>
        <div className="purge-progress"><div className="purge-bar"></div></div>
        <div className="purge-log">
          [SYSTEM] SCRUBBING_VOIDS...<br />
          [MEMORY] OVERWRITING_BYTES...<br />
          [NETWORK] SEVERING_HANDSHAKES...
        </div>
      </div>
    );
  }

  return (
    <div className="chat-layout no-copy">
      <div className="scanline"></div>

      <header className="chat-header glass">
        <div className="header-left">
          <img src="/logo.png" alt="Ephemra" className="header-logo" width={24} height={24} />
          <div>
            <h1 className="font-mono tracking-tighter">EPHEMRA::SECURE</h1>
            <div className="flex items-center gap-2">
              <span className="badge-secure">AES-256 E2EE</span>
              <span className="text-xs opacity-40 font-mono">NODE_{String(sessionId).slice(0, 4)}</span>
            </div>
          </div>
        </div>
        <div className="header-right">
          <button className={`btn-secondary ${isCallActive ? 'active' : ''}`} onClick={() => isCallActive ? endCall() : startCall(true)}>
            {isCallActive ? <PhoneOff size={18} /> : <Phone size={18} />}
          </button>
          <button className="btn-secondary" onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
          }}>
            {isCopied ? <Check size={18} className="text-accent" /> : <Copy size={18} />}
          </button>
          <button className="btn-danger" onClick={() => {
            if (confirm("Execute total purge?")) {
              socket?.emit('destroy-session', sessionId);
              setIsPurging(true);
              fetch(`/api/session/${sessionId}`, { method: 'DELETE' }).then(() => setTimeout(() => router.push('/'), 2000));
            }
          }} title="Total Purge">
            <ShieldOff size={18} />
          </button>
        </div>
      </header>

      <div className="message-area overflow-hidden">
        {messages.length === 0 && (
          <div className="welcome-empty">
            <Lock size={64} className="opacity-10 mb-6 mx-auto" strokeWidth={0.5} />
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-30">
              -- Security Layer Established --<br />
              -- No Persistent Logs Active --
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`msg-row ${msg.sender}`}>
            <div className="msg-bubble glass no-copy">
              {msg.text && <p className={msg.sender === 'system' ? 'font-mono text-[10px]' : ''}>{msg.text}</p>}
              {msg.mediaUrl && (
                <div className="media-preview">
                  {msg.mediaType?.startsWith('image') ? (
                    <img src={msg.mediaUrl} alt="E2EE_BLOB" />
                  ) : msg.mediaType?.startsWith('video') ? (
                    <video src={msg.mediaUrl} controls />
                  ) : (
                    <div className="file-message">
                      <div className="file-info">
                        <FileText size={20} className="text-accent" />
                        <span className="file-name">{msg.fileName || 'document.pdf'}</span>
                      </div>
                      <a href={msg.mediaUrl} download={msg.fileName || 'download'} className="btn-download">
                        <Download size={16} />
                      </a>
                    </div>
                  )}
                </div>
              )}
              {msg.sender !== 'system' && (
                <span className="msg-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </div>
          </div>
        ))}
        {isOtherTyping && <div className="typing-dots"><span></span><span></span><span></span></div>}
        <div ref={scrollRef} />
      </div>

      <footer className="chat-input-area glass">
        <button className="input-action" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          {isUploading ? <Zap className="animate-spin text-accent" size={20} /> : <Paperclip size={20} />}
        </button>
        <input type="file" ref={fileInputRef} hidden onChange={handleFileUpload} accept="*/*" />
        <input
          type="text"
          placeholder={isOtherTyping ? "Peer is sending packets..." : "Transmit secure message..."}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button className="btn-send" onClick={sendMessage} disabled={!inputText.trim()}><Send size={20} /></button>
      </footer>

      {/* Incoming Call Notification */}
      {incomingSignal && !isCallActive && (
        <div className="incoming-modal glass">
          <div className="pulse-icon"><PhoneCall size={32} className="text-accent" /></div>
          <p className="font-mono text-sm">SECURE_LINK_REQUESTED...</p>
          <div className="modal-actions">
            <button className="btn-accent circular" onClick={() => startCall(false, incomingSignal)}><Phone size={24} /></button>
            <button className="btn-danger circular" onClick={() => setIncomingSignal(null)}><X size={24} /></button>
          </div>
        </div>
      )}

      {/* Active Call Overlay */}
      {isCallActive && (
        <div className="call-overlay glass">
          <div className="video-grid">
            <div className="video-container local"><video ref={localVideoRef} autoPlay muted playsInline /><span>LOCAL_FEED</span></div>
            <div className="video-container remote">{remoteStream ? <video ref={remoteVideoRef} autoPlay playsInline /> : <div className="font-mono text-xs animate-pulse">ESTABLISHING_P2P_LINK...</div>}<span>REMOTE_TUNNEL</span></div>
          </div>
          <button className="btn-danger circular" onClick={endCall}><PhoneOff size={24} /></button>
        </div>
      )}

      <style jsx>{`
        .chat-layout { position: relative; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
        .message-area { flex: 1; overflow-y: auto; padding-top: 1rem; }
        .incoming-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 500; display: flex; flex-direction: column; align-items: center; padding: 2rem; border-radius: 2rem; gap: 1.5rem; text-align: center; border: 1px solid var(--accent); }
        .pulse-icon { animation: ring 1.5s infinite; }
        @keyframes ring { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.5; } 100% { transform: scale(1); opacity: 1; } }
        .modal-actions { display: flex; gap: 2rem; }
        .call-overlay { position: fixed; inset: 20px; z-index: 100; border-radius: 2rem; display: flex; flex-direction: column; padding: 1.5rem; }
        .video-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; min-height: 0; }
        .video-container { position: relative; background: #000; border-radius: 1rem; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1); }
        .video-container video { width: 100%; height: 100%; object-fit: cover; }
        .video-container span { position: absolute; bottom: 10px; left: 10px; font-size: 10px; font-family: monospace; background: rgba(0,0,0,0.8); padding: 2px 8px; border-radius: 4px; color: var(--accent); }
        .circular { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; padding: 0; }
        .btn-accent { background: var(--accent); color: #fff; border: none; cursor: pointer; }
        .flex { display: flex; } .items-center { align-items: center; } .gap-2 { gap: 0.5rem; } .mx-auto { margin: 0 auto; } .mb-6 { margin-bottom: 1.5rem; }
        .file-message { display: flex; align-items: center; gap: 1rem; padding: 0.5rem; background: rgba(0,0,0,0.2); border-radius: 8px; min-width: 200px; }
        .file-info { display: flex; align-items: center; gap: 0.75rem; flex: 1; overflow: hidden; }
        .file-name { font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .btn-download { color: var(--accent); opacity: 0.6; transition: opacity 0.2s; }
        .btn-download:hover { opacity: 1; }
      `}</style>
    </div>
  );
}
