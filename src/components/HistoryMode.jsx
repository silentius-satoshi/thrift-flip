import { useState } from 'react';
import { getHistory, deleteHistoryEntry, clearHistory } from '../utils/historyStore';
import { useToast } from '../contexts/ToastContext';
import './HistoryMode.css';

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

export default function HistoryMode() {
  const { showToast } = useToast();
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
      showToast('Tap again to clear all history');
      setTimeout(() => setClearAllPending(false), 3000);
    }
  }

  const totalItems = history.length;
  const totalProfit = history.reduce((s, e) => s + (e.estProfit || 0), 0);
  const avgProfit = totalItems > 0 ? totalProfit / totalItems : 0;
  const bestFlip = history.reduce((best, e) => (!best || e.estProfit > best.estProfit) ? e : best, null);

  if (history.length === 0) {
    return (
      <div className="screen">
        <div className="history-header">
          <span className="history-title">History</span>
        </div>
        <div className="history-empty">
          <span className="history-empty-icon">📋</span>
          <p>No listings yet — send your first draft from Listing Mode</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="history-header">
        <span className="history-title">History</span>
        <button className="history-clear-btn" onClick={handleClearAll}>
          {clearAllPending ? 'Confirm?' : 'Clear all'}
        </button>
      </div>

      <div className="history-summary-grid">
        <div className="history-summary-card">
          <div className="summary-value">{totalItems}</div>
          <div className="summary-label">Items sent</div>
        </div>
        <div className="history-summary-card">
          <div className="summary-value green">${totalProfit.toFixed(2)}</div>
          <div className="summary-label">Total est. profit</div>
        </div>
        <div className="history-summary-card">
          <div className="summary-value">${avgProfit.toFixed(2)}</div>
          <div className="summary-label">Avg per item</div>
        </div>
        <div className="history-summary-card">
          <div className="summary-value green">${(bestFlip?.estProfit ?? 0).toFixed(2)}</div>
          <div className="summary-label">
            Best flip{bestFlip ? `: ${bestFlip.title.slice(0, 18)}…` : ''}
          </div>
        </div>
      </div>

      <div className="history-list">
        {history.map(entry => (
          <div key={entry.id} className="history-card">
            <div className="history-card-top">
              <span className="history-card-title">{entry.title}</span>
              <button
                className={`history-delete-btn${pendingDelete === entry.id ? ' pending' : ''}`}
                onClick={() => handleDelete(entry.id)}
              >🗑</button>
            </div>
            <div className="history-card-date">{formatSentDate(entry.sentAt)}</div>
            <div className="history-card-price-row">
              Listed at ${entry.price.toFixed(2)} · Paid ${entry.goodwillPrice.toFixed(2)} ·{' '}
              <span className="history-profit">Profit ${entry.estProfit.toFixed(2)}</span>
            </div>
            <div className="history-card-pills">
              <span className="history-pill">{entry.condition}</span>
              <span className="history-pill">{entry.category}</span>
              <span className="history-status-pill">Draft sent</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
