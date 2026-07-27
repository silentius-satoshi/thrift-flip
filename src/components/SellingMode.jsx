import { useState } from 'react';
import { getHistory, deleteHistoryEntry, clearHistory } from '../utils/historyStore';
import { useToast } from '../contexts/ToastContext';
import { useUser } from '../contexts/UserContext';
import FourDotMark from './ui/FourDotMark';
import './SellingMode.css';

function formatSentDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3L21 2m-4 4l3 3m-6-6l3 3" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  );
}

export default function SellingMode({ onOpenSettings }) {
  const { showToast } = useToast();
  const { user } = useUser(); // TODO: filter history by user.id when multi-user
  const [history, setHistory] = useState(() => getHistory());
  const [pendingDelete, setPendingDelete] = useState(null);
  const [clearAllPending, setClearAllPending] = useState(false);

  function handleDelete(id) {
    if (pendingDelete === id) {
      deleteHistoryEntry(id);
      setHistory(getHistory());
      setPendingDelete(null);
    } else {
      setPendingDelete(id);
      showToast('Tap again to confirm delete');
      setTimeout(() => setPendingDelete(prev => prev === id ? null : prev), 3000);
    }
  }

  function handleClearAll() {
    if (clearAllPending) {
      clearHistory();
      setHistory([]);
      setClearAllPending(false);
    } else {
      setClearAllPending(true);
      showToast('Tap again to clear everything');
      setTimeout(() => setClearAllPending(false), 3000);
    }
  }

  const totalItems = history.length;
  const totalProfit = history.reduce((s, e) => s + (e.estProfit || 0), 0);
  const avgProfit = totalItems > 0 ? totalProfit / totalItems : 0;
  const bestFlip = history.reduce((best, e) => (!best || e.estProfit > best.estProfit) ? e : best, null);

  const header = (withClear) => (
    <div className="selling-header">
      <div className="selling-title-group">
        <FourDotMark />
        <span className="selling-title">Selling</span>
      </div>
      <div className="selling-header-actions">
        <button className="selling-settings-btn" onClick={onOpenSettings} aria-label="Settings"><KeyIcon /></button>
        {withClear && (
          <button className="selling-clear-btn" onClick={handleClearAll}>
            {clearAllPending ? 'Confirm?' : 'Clear all'}
          </button>
        )}
      </div>
    </div>
  );

  if (history.length === 0) {
    return (
      <div className="screen">
        {header(false)}
        <div className="selling-empty">
          <span className="selling-empty-icon"><ClipboardIcon /></span>
          <p>No listings yet — send your first draft from Listing Mode</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      {header(true)}

      <div className="selling-summary-grid">
        <div className="selling-summary-card">
          <div className="summary-value">{totalItems}</div>
          <div className="summary-label">Items sent</div>
        </div>
        <div className="selling-summary-card">
          <div className="summary-value green">${totalProfit.toFixed(2)}</div>
          <div className="summary-label">Total est. profit</div>
        </div>
        <div className="selling-summary-card">
          <div className="summary-value">${avgProfit.toFixed(2)}</div>
          <div className="summary-label">Avg per item</div>
        </div>
        <div className="selling-summary-card">
          <div className="summary-value green">${(bestFlip?.estProfit ?? 0).toFixed(2)}</div>
          <div className="summary-label">
            Best flip{bestFlip ? `: ${bestFlip.title.slice(0, 18)}…` : ''}
          </div>
        </div>
      </div>

      <div className="selling-list">
        {history.map(entry => (
          <div key={entry.id} className="selling-card">
            <div className="selling-card-top">
              <span className="selling-card-title">{entry.title}</span>
              <button
                className={`remove-btn${pendingDelete === entry.id ? ' pending' : ''}`}
                onClick={() => handleDelete(entry.id)}
              >Remove</button>
            </div>
            <div className="selling-card-date">{formatSentDate(entry.sentAt)}</div>
            <div className="selling-card-price-row">
              Listed at ${entry.price.toFixed(2)} · Paid ${entry.goodwillPrice.toFixed(2)} ·{' '}
              <span className="selling-profit">Profit ${entry.estProfit.toFixed(2)}</span>
            </div>
            <div className="selling-card-pills">
              <span className="selling-pill">{entry.condition}</span>
              <span className="selling-pill">{entry.category}</span>
              <span className="selling-status-pill">Draft sent</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
