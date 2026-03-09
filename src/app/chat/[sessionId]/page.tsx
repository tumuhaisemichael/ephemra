'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  Send,
  Paperclip,
  Copy,
  Check,
  Phone,
  PhoneOff,
  Lock,
  Zap,
  ShieldOff,
  PhoneCall,
  X,
  FileText,
  Download,
  AlertCircle
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
  replyToId?: string;
  sender: 'me' | 'other' | 'system';
  timestamp: number;
}

interface ReplyTarget {
  id: string;
  preview: string;
}

interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

function getIceServers(): RTCIceServer[] {
  const fallback: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fallback;
    }
    return parsed as RTCIceServer[];
  } catch (error) {
    console.warn('Invalid NEXT_PUBLIC_ICE_SERVERS JSON. Falling back to default STUN.', error);
    return fallback;
  }
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
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const [callState, setCallState] = useState<'idle' | 'ringing' | 'connecting' | 'active'>('idle');

  // Voice/Video state
  const [incomingSignal, setIncomingSignal] = useState<any>(null);
  const [incomingFromId, setIncomingFromId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const isCallActive = callState === 'connecting' || callState === 'active';
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const peerRef = useRef<Peer.Instance | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callStateRef = useRef(callState);
  const callConnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const pushToast = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2800);
  }, []);

  const getPreviewText = useCallback((message: Message): string => {
    if (message.text) {
      return message.text.length > 70 ? `${message.text.slice(0, 70)}...` : message.text;
    }
    if (message.fileName) {
      return `File: ${message.fileName}`;
    }
    if (message.mediaType?.startsWith('image')) {
      return 'Image attachment';
    }
    if (message.mediaType?.startsWith('video')) {
      return 'Video attachment';
    }
    return 'Attachment';
  }, []);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // Anti-Copy Logic
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 's' || e.key === 'u' || e.key === 'p')) {
        e.preventDefault();
      }
      if (e.key === 'PrintScreen' || (e.ctrlKey && e.key === 'p')) {
        e.preventDefault();
        pushToast('Screenshots and print are blocked in secure mode.', 'info');
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [pushToast]);

  // Initialize E2EE and Socket
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;

    let socketInstance: Socket | null = null;
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
        socketInstance = newSocket;

        // Log connection events for debugging
        newSocket.on('connect', () => {
          setIsSocketConnected(true);
          console.log('[Socket] Connected to server');
          newSocket.emit('join-session', sessionId);
        });

        newSocket.on('connect_error', (error) => {
          setIsSocketConnected(false);
          console.error('[Socket] Connection error:', error);
        });

        newSocket.on('disconnect', () => {
          setIsSocketConnected(false);
          pushToast('Connection lost. Reconnecting to secure channel...', 'error');
          console.log('[Socket] Disconnected from server');
        });

        setSocket(newSocket);

        newSocket.on('session-peers', (peerIds: string[]) => {
          if (peerIds.length > 0) {
            setRemotePeerId(peerIds[0]);
          }
        });

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

        newSocket.on('user-joined', (peerId: string) => {
          setRemotePeerId(peerId);
          setMessages(prev => [
            ...prev,
            { id: 'sys-' + Date.now(), text: 'SECURE_CHANNEL_ESTABLISHED: NEW_PEER_CONNECTED', sender: 'system', timestamp: Date.now() }
          ]);
        });

        newSocket.on('user-left', (peerId: string) => {
          setRemotePeerId((prev) => (prev === peerId ? null : prev));
          endCall(false);
          setMessages(prev => [
            ...prev,
            { id: 'sys-' + Date.now(), text: 'PEER_DISCONNECTED', sender: 'system', timestamp: Date.now() }
          ]);
        });

        newSocket.on('signal', ({ signal, from }) => {
          if (signal?.type === 'call-ended') {
            endCall(false);
            pushToast('Call ended by peer.', 'info');
            return;
          }
          if (signal?.type === 'call-declined') {
            endCall(false);
            pushToast('Peer declined the call.', 'info');
            return;
          }
          if (signal?.type === 'call-busy') {
            endCall(false);
            pushToast('Peer is busy on another call.', 'info');
            return;
          }

          if (peerRef.current) {
            try {
              peerRef.current.signal(signal);
            } catch (err) {
              console.warn("Signal handled while stable or redundant.");
            }
          } else if (signal.type === 'offer') {
            if (callStateRef.current !== 'idle') {
              newSocket?.emit('signal', { sessionId, to: from, signal: { type: 'call-busy' } });
              return;
            }
            setRemotePeerId(from);
            setIncomingFromId(from);
            setIncomingSignal(signal);
            setCallState('ringing');
          }
        });

      } catch (err) {
        pushToast('Unable to initialize secure channel.', 'error');
        console.error('Initialization failed', err);
      }
    };

    init();
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (callConnectTimeoutRef.current) {
        clearTimeout(callConnectTimeoutRef.current);
      }
      socketInstance?.disconnect();
    };
  }, [sessionId, pushToast, router]);

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
    const outgoingMessage = {
      id: msgId,
      text: encryptedText,
      timestamp: Date.now(),
      replyToId: replyingTo?.id
    };
    socket.emit('send-message', { sessionId, message: outgoingMessage });
    setMessages(prev => [...prev, { id: msgId, text: inputText, sender: 'me', timestamp: Date.now(), replyToId: replyingTo?.id }]);
    setInputText('');
    setReplyingTo(null);
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
      if (!res.ok) {
        throw new Error('Upload request failed');
      }
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
        pushToast(`${file.name} uploaded securely.`, 'success');
      }
    } catch (err) {
      console.error('Upload failed', err);
      pushToast('File upload failed. Please retry.', 'error');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
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

  const startCall = async (initiator: boolean, signalToSignal?: any, callTarget?: string) => {
    if (!socket) {
      pushToast('No active socket connection for call setup.', 'error');
      return;
    }

    const target = callTarget || remotePeerId;
    if (!target) {
      pushToast('No peer connected yet.', 'info');
      return;
    }

    setCallState('connecting');
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setIsAudioOnly(false);
      } catch (mediaError) {
        console.warn('Video+audio capture failed, retrying audio only', mediaError);
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setIsAudioOnly(true);
        pushToast('Video unavailable. Starting secure audio call.', 'info');
      }
      setLocalStream(stream);

      const peer = new Peer({
        initiator,
        trickle: true,
        stream,
        config: { iceServers: getIceServers() }
      });

      peer.on('signal', (data) => {
        socket.emit('signal', { sessionId, signal: data, to: target });
      });

      peer.on('stream', (remote) => {
        setRemoteStream(remote);
        setCallState('active');
        if (callConnectTimeoutRef.current) {
          clearTimeout(callConnectTimeoutRef.current);
          callConnectTimeoutRef.current = null;
        }
      });

      peer.on('connect', () => {
        setCallState('active');
        pushToast('Secure call connected.', 'success');
        if (callConnectTimeoutRef.current) {
          clearTimeout(callConnectTimeoutRef.current);
          callConnectTimeoutRef.current = null;
        }
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
      setIncomingFromId(null);

      // If ICE negotiation never completes, stop and surface a clear error.
      callConnectTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current !== 'active') {
          pushToast('Call connection timed out. TURN may be required for mobile networks.', 'error');
          endCall(false);
        }
      }, 20000);
    } catch (err) {
      console.error('Start call failed:', err);
      pushToast('Could not access media devices. Check camera/mic permissions.', 'error');
      setCallState('idle');
      setIncomingSignal(null);
      setIncomingFromId(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setIsCopied(true);
      pushToast('Secure invite link copied.', 'success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Copy failed', error);
      pushToast('Could not copy link on this device.', 'error');
    }
  };

  const handlePurge = async () => {
    setShowPurgeConfirm(false);
    socket?.emit('destroy-session', sessionId);
    setIsPurging(true);
    try {
      const res = await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setTimeout(() => router.push('/'), 2000);
    } catch (err) {
      console.error('Purge failed', err);
      pushToast('Session purge request failed. Try again.', 'error');
      setIsPurging(false);
    }
  };

  const endCall = (notifyPeer = true) => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (e) { }
    }
    if (callConnectTimeoutRef.current) {
      clearTimeout(callConnectTimeoutRef.current);
      callConnectTimeoutRef.current = null;
    }
    const callTarget = remotePeerId || incomingFromId;
    if (notifyPeer && socket && callTarget) {
      socket.emit('signal', { sessionId, to: callTarget, signal: { type: 'call-ended' } });
    }
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsAudioOnly(false);
    setCallState('idle');
    setIncomingSignal(null);
    setIncomingFromId(null);
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
            <h1 className="font-mono tracking-tighter">EPHEMRA SECURE CHAT</h1>
            <div className="flex items-center gap-2">
              <span className="badge-secure">AES-256 E2EE</span>
              <span className="text-xs opacity-40 font-mono">NODE_{String(sessionId).slice(0, 4)}</span>
            </div>
          </div>
        </div>
        <div className="header-right">
          <button
            className={`btn-secondary ${isCallActive ? 'active' : ''}`}
            onClick={() => isCallActive ? endCall() : startCall(true, undefined, remotePeerId || undefined)}
            title={isCallActive ? 'End call' : 'Start call'}
            aria-label={isCallActive ? 'End call' : 'Start call'}
            disabled={!isCallActive && !remotePeerId}
          >
            {isCallActive ? <PhoneOff size={18} /> : <Phone size={18} />}
          </button>
          <button className="btn-secondary" onClick={handleCopyLink} title="Copy secure link" aria-label="Copy secure link">
            {isCopied ? <Check size={18} className="text-accent" /> : <Copy size={18} />}
          </button>
          <button className="btn-danger" onClick={() => setShowPurgeConfirm(true)} title="Total Purge" aria-label="Total Purge">
            <ShieldOff size={18} />
          </button>
        </div>
      </header>

      {!isSocketConnected && (
        <div className="status-banner">
          <AlertCircle size={16} />
          Secure link temporarily offline. Attempting reconnect...
        </div>
      )}

      <div className="message-area overflow-hidden">
        {messages.length === 0 && (
          <div className="welcome-empty">
            <Lock size={64} className="opacity-10 mb-6 mx-auto" strokeWidth={0.5} />
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-30 empty-state-copy">
              Secure layer established<br />
              Waiting for peer connection
            </div>
            <p className="empty-state-tip">
              Share the link and send the first encrypted message to begin.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`msg-row ${msg.sender}`} id={`msg-${msg.id}`}>
            <div className="msg-bubble glass no-copy">
              {msg.replyToId && (
                <div className="reply-preview">
                  ↳ {messages.find((m) => m.id === msg.replyToId)?.text || messages.find((m) => m.id === msg.replyToId)?.fileName || 'Replied message'}
                </div>
              )}
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
              {msg.sender !== 'system' && (
                <button
                  className="reply-btn"
                  onClick={() => setReplyingTo({ id: msg.id, preview: getPreviewText(msg) })}
                  title="Reply to this message"
                >
                  Reply
                </button>
              )}
            </div>
          </div>
        ))}
        {isOtherTyping && <div className="typing-dots"><span></span><span></span><span></span></div>}
        <div ref={scrollRef} />
      </div>

      <footer className="chat-input-area glass">
        {replyingTo && (
          <div className="replying-chip">
            <div>
              Replying to: <span>{replyingTo.preview}</span>
            </div>
            <button onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
              <X size={14} />
            </button>
          </div>
        )}
        <button className="input-action" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          {isUploading ? <Zap className="animate-spin text-accent" size={20} /> : <Paperclip size={20} />}
        </button>
        <input type="file" ref={fileInputRef} hidden onChange={handleFileUpload} accept="*/*" />
        <input
          type="text"
          placeholder={isOtherTyping ? "Peer is typing..." : "Write encrypted message..."}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button className="btn-send" onClick={sendMessage} disabled={!inputText.trim()}><Send size={20} /></button>
      </footer>

      {showPurgeConfirm && (
        <div className="purge-modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm purge">
          <div className="purge-modal glass">
            <h2>Total Purge</h2>
            <p>This permanently deletes this session and all uploaded files.</p>
            <div className="purge-modal-actions">
              <button className="btn-secondary" onClick={() => setShowPurgeConfirm(false)}>Cancel</button>
              <button className="btn-danger" onClick={handlePurge}>Purge now</button>
            </div>
          </div>
        </div>
      )}

      {/* Incoming Call Notification */}
      {incomingSignal && !isCallActive && (
        <div className="incoming-modal glass">
          <div className="pulse-icon"><PhoneCall size={32} className="text-accent" /></div>
          <p className="font-mono text-sm">SECURE_LINK_REQUESTED...</p>
          <div className="modal-actions">
            <button className="btn-accent circular" onClick={() => startCall(false, incomingSignal, incomingFromId || undefined)}><Phone size={24} /></button>
            <button
              className="btn-danger circular"
              onClick={() => {
                if (socket && incomingFromId) {
                  socket.emit('signal', { sessionId, to: incomingFromId, signal: { type: 'call-declined' } });
                }
                setIncomingSignal(null);
                setIncomingFromId(null);
                setCallState('idle');
              }}
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}

      {/* Active Call Overlay */}
      {isCallActive && (
        <div className="call-overlay glass">
          <p className="call-status">
            {callState === 'connecting'
              ? 'ESTABLISHING_P2P_LINK...'
              : isAudioOnly
                ? 'SECURE_AUDIO_CALL_ACTIVE'
                : 'SECURE_CALL_ACTIVE'}
          </p>
          <div className="video-grid">
            <div className="video-container local"><video ref={localVideoRef} autoPlay muted playsInline /><span>LOCAL_FEED</span></div>
            <div className="video-container remote">{remoteStream ? <video ref={remoteVideoRef} autoPlay playsInline /> : <div className="font-mono text-xs animate-pulse">ESTABLISHING_P2P_LINK...</div>}<span>REMOTE_TUNNEL</span></div>
          </div>
          <button className="btn-danger circular" onClick={() => endCall()}><PhoneOff size={24} /></button>
        </div>
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-item ${toast.tone}`}>
            <span>{toast.text}</span>
          </div>
        ))}
      </div>

      <style jsx>{`
        .chat-layout { position: relative; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
        .message-area { flex: 1; overflow-y: auto; padding-top: 1rem; }
        .reply-preview {
          border-left: 2px solid rgba(99, 102, 241, 0.8);
          padding-left: 0.45rem;
          margin-bottom: 0.35rem;
          font-size: 0.74rem;
          opacity: 0.82;
        }
        .reply-btn {
          margin-top: 0.3rem;
          font-size: 0.72rem;
          padding: 2px 7px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(2, 6, 23, 0.45);
          color: #cbd5e1;
          cursor: pointer;
        }
        .reply-btn:hover {
          border-color: rgba(99, 102, 241, 0.55);
          color: #e2e8f0;
        }
        .replying-chip {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          font-size: 0.8rem;
          padding: 0.45rem 0.6rem;
          border-radius: 0.6rem;
          border: 1px solid rgba(99, 102, 241, 0.35);
          background: rgba(30, 41, 59, 0.45);
        }
        .replying-chip span {
          color: #c7d2fe;
        }
        .replying-chip button {
          border: none;
          background: transparent;
          color: #cbd5e1;
          cursor: pointer;
          display: flex;
          align-items: center;
        }
        .status-banner {
          margin: 0 0.8rem;
          padding: 0.6rem 0.85rem;
          border-radius: 0.85rem;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          color: #fda4af;
          background: rgba(190, 24, 93, 0.18);
          border: 1px solid rgba(244, 114, 182, 0.25);
          font-size: 0.85rem;
          width: fit-content;
        }
        .empty-state-copy {
          font-size: 0.72rem;
          line-height: 1.9;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .empty-state-tip {
          margin-top: 0.9rem;
          font-size: 0.92rem;
          color: rgba(241, 245, 249, 0.75);
          max-width: 300px;
          line-height: 1.45;
        }
        .incoming-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 500; display: flex; flex-direction: column; align-items: center; padding: 2rem; border-radius: 2rem; gap: 1.5rem; text-align: center; border: 1px solid var(--accent); }
        .pulse-icon { animation: ring 1.5s infinite; }
        @keyframes ring { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.5; } 100% { transform: scale(1); opacity: 1; } }
        .modal-actions { display: flex; gap: 2rem; }
        .call-overlay { position: fixed; inset: 20px; z-index: 100; border-radius: 2rem; display: flex; flex-direction: column; padding: 1.5rem; }
        .call-status {
          margin-bottom: 0.7rem;
          font-size: 0.78rem;
          letter-spacing: 0.08em;
          opacity: 0.75;
          font-family: var(--font-mono), monospace;
        }
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
        :global(.chat-input-area) {
          flex-wrap: wrap;
        }
        .purge-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 350;
          background: rgba(2, 6, 23, 0.72);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .purge-modal {
          width: min(420px, 100%);
          border-radius: 1rem;
          padding: 1.2rem;
          border: 1px solid rgba(248, 113, 113, 0.35);
        }
        .purge-modal h2 {
          margin: 0 0 0.4rem;
          font-size: 1.2rem;
        }
        .purge-modal p {
          font-size: 0.92rem;
          color: rgba(241, 245, 249, 0.8);
          margin-bottom: 0.9rem;
        }
        .purge-modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.55rem;
        }
        .toast-stack {
          position: fixed;
          right: 1rem;
          bottom: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          z-index: 420;
          max-width: min(92vw, 380px);
        }
        .toast-item {
          font-size: 0.86rem;
          padding: 0.7rem 0.85rem;
          border-radius: 0.75rem;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.9);
        }
        .toast-item.success {
          border-color: rgba(16, 185, 129, 0.4);
          color: #86efac;
        }
        .toast-item.error {
          border-color: rgba(248, 113, 113, 0.5);
          color: #fca5a5;
        }
        .toast-item.info {
          border-color: rgba(99, 102, 241, 0.45);
          color: #c7d2fe;
        }
        @media (max-width: 820px) {
          .call-overlay {
            inset: 0.5rem;
            border-radius: 1.2rem;
            padding: 0.9rem;
          }
          .video-grid {
            grid-template-columns: 1fr;
          }
          .status-banner {
            width: auto;
            margin: 0 0.55rem;
          }
          .toast-stack {
            right: 0.55rem;
            left: 0.55rem;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem);
            max-width: none;
          }
        }
      `}</style>
    </div>
  );
}
