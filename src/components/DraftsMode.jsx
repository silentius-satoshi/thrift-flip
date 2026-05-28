import { useState } from 'react';
import { getDrafts, deleteDraft, clearDrafts } from '../utils/draftsStore';
import { useToast } from '../contexts/ToastContext';
import './DraftsMode.css';

function formatSavedDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

export default function DraftsMode({ onBack, onRestoreDraft }) {
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState(() => getDrafts());
  const [pendingDelete, setPendingDelete] = useState(null);
  const [clearAllPending, setClearAllPending] = useState(false);

  function handleDelete(id) {
    if (pendingDelete === id) {
      deleteDraft(id);
      setDrafts(getDrafts());
      setPendingDelete(null);
    } else {
      setPendingDelete(id);
      showToast('Tap again to confirm delete');
      setTimeout(() => setPendingDelete(prev => prev === id ? null : prev), 3000);
    }
  }

  function handleClearAll() {
    if (clearAllPending) {
      clearDrafts();
      setDrafts([]);
      setClearAllPending(false);
    } else {
      setClearAllPending(true);
      showToast('Tap again to clear all drafts');
      setTimeout(() => setClearAllPending(false), 3000);
    }
  }

  return (
    <div className="screen">
      <div className="drafts-header">
        <button className="drafts-back-btn" onClick={onBack}>←</button>
        <span className="drafts-title">Saved Drafts</span>
        {drafts.length > 0 ? (
          <button className="drafts-clear-btn" onClick={handleClearAll}>
            {clearAllPending ? 'Confirm?' : 'Clear all'}
          </button>
        ) : (
          <span style={{ width: 56 }} />
        )}
      </div>

      {drafts.length === 0 ? (
        <div className="drafts-empty">
          <span className="drafts-empty-icon">📝</span>
          <p>No saved drafts — tap 🔖 in Listing Mode to save your work</p>
        </div>
      ) : (
        <div className="drafts-list">
          {drafts.map(draft => (
            <div key={draft.id} className="draft-card">
              <div className="draft-card-top">
                <span className="draft-card-title">{draft.title || 'Untitled draft'}</span>
                <button
                  className={`draft-delete-btn${pendingDelete === draft.id ? ' pending' : ''}`}
                  onClick={() => handleDelete(draft.id)}
                >🗑</button>
              </div>
              <div className="draft-card-meta-row">
                <span className={`draft-source-badge ${draft.source === 'auto-saved' ? 'amber' : 'blue'}`}>
                  {draft.source === 'auto-saved' ? 'Auto-saved' : 'Manually saved'}
                </span>
                <span className="draft-card-date">{formatSavedDate(draft.savedAt)}</span>
              </div>
              <div className="draft-card-price-row">
                Listed at ${(draft.price ?? 0).toFixed(2)} · Paid ${(draft.goodwillPrice ?? 0).toFixed(2)} ·{' '}
                <span className="draft-profit">Est. profit ${(draft.estProfit ?? 0).toFixed(2)}</span>
              </div>
              <div className="draft-card-pills">
                {draft.condition && <span className="draft-pill">{draft.condition}</span>}
                {draft.category && <span className="draft-pill">{draft.category}</span>}
              </div>
              <div className="draft-card-actions">
                <button
                  className="btn btn-red btn-sm"
                  onClick={() => handleDelete(draft.id)}
                >
                  {pendingDelete === draft.id ? 'Confirm?' : 'Delete'}
                </button>
                <button
                  className="btn btn-green btn-sm"
                  onClick={() => onRestoreDraft(draft)}
                >
                  Restore to listing ↗
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
