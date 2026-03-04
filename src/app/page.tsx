'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Trash2, Zap, MessageSquare, Camera, Phone } from 'lucide-react';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const createSession = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/session', { method: 'POST' });
      const { sessionId, sharedSecret } = await res.json();
      // We append the sharedSecret to the hash so it's not sent to the server in subsequent requests
      router.push(`/chat/${sessionId}#${sharedSecret}`);
    } catch (error) {
      console.error('Failed to create session:', error);
      alert('Failed to create secure session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container">
      <div className="hero-section glass">
        <div className="logo-container">
          {/* actual logo file placed in public/; update name if you use a different
              filename (PNG, SVG, etc.) */}
          <img src="/logo.png" alt="Ephemra logo" className="logo-img" width={64} height={64} />
          <h1>Ephemra</h1>
          <p className="subtitle">Secure, Ephemeral, End-to-End Encrypted Messaging</p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <Lock size={24} className="feature-icon" />
            <h3>True E2EE</h3>
            <p>Messages are encrypted in your browser. Even we can't read them.</p>
          </div>
          <div className="feature-card">
            <Trash2 size={24} className="feature-icon" />
            <h3>No Persistence</h3>
            <p>All data is permanently deleted the moment the session ends.</p>
          </div>
          <div className="feature-card">
            <Zap size={24} className="feature-icon" />
            <h3>Real-time</h3>
            <p>Instant messaging, image sharing, and voice calls.</p>
          </div>
        </div>

        <div className="action-container">
          <button
            className="btn-primary"
            onClick={createSession}
            disabled={loading}
          >
            {loading ? 'Securing Environment...' : 'Start Secure Chat'}
          </button>
          <p className="hint">No accounts. No logs. No trace.</p>
        </div>
      </div>

      <style jsx global>{`
        .container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }

        .hero-section {
          max-width: 800px;
          width: 100%;
          padding: 60px;
          text-align: center;
          animation: fadeIn 0.8s ease-out;
        }

        .logo-container h1 {
          font-size: 3.5rem;
          margin: 20px 0 10px;
          background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -1px;
        }

        .logo-icon {
          color: #6366f1;
          filter: drop-shadow(0 0 15px rgba(99, 102, 241, 0.5));
        }

        .logo-img {
          display: block;
          margin: 0 auto;
          filter: drop-shadow(0 0 15px rgba(99, 102, 241, 0.5));
        }

        .subtitle {
          font-size: 1.25rem;
          color: #94a3b8;
          margin-bottom: 40px;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 50px;
        }

        .feature-card {
          padding: 24px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: all 0.3s ease;
        }

        .feature-card:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(99, 102, 241, 0.3);
          transform: translateY(-5px);
        }

        .feature-icon {
          color: #6366f1;
          margin-bottom: 12px;
        }

        .feature-card h3 {
          margin-bottom: 8px;
          font-size: 1.1rem;
        }

        .feature-card p {
          color: #64748b;
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .action-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
        }

        .btn-primary {
          font-size: 1.2rem;
          padding: 16px 40px;
          width: 100%;
          max-width: 300px;
        }

        .hint {
          font-size: 0.85rem;
          color: #475569;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 640px) {
          .hero-section {
            padding: 40px 20px;
          }
          .logo-container h1 {
            font-size: 2.5rem;
          }
        }
      `}</style>
    </main>
  );
}
