import { useState } from 'react';
import { getDrafts, deleteDraft, clearDrafts } from '../utils/draftsStore';
import { useToast } from '../contexts/ToastContext';
import Button from './ui/Button';
import Card from './ui/Card';
import IconButton from './ui/IconButton';
import StatusTag from './ui/StatusTag';
import './DraftsMode.css';

function NoteIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

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
        <IconButton label="Back" size="sm" className="drafts-back-btn" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </IconButton>
        <span className="drafts-title">Saved Drafts</span>
        {drafts.length > 0 ? (
          <Button variant="plain" onClick={handleClearAll}>
            {clearAllPending ? 'Confirm?' : 'Clear all'}
          </Button>
        ) : (
          <span className="drafts-header-spacer" />
        )}
      </div>

      {drafts.length === 0 ? (
        <div className="drafts-empty">
          <span className="drafts-empty-icon"><NoteIcon /></span>
          <p>No saved drafts — tap Save draft in Listing Mode to save your work</p>
        </div>
      ) : (
        <div className="drafts-list">
          {drafts.map(draft => (
            <Card key={draft.id} className="draft-card">
              <div className="draft-card-top">
                <span className="draft-card-title">{draft.title || 'Untitled draft'}</span>
                <Button
                  variant="danger"
                  size="sm"
                  className={pendingDelete === draft.id ? 'pending' : ''}
                  onClick={() => handleDelete(draft.id)}
                >{pendingDelete === draft.id ? 'Confirm?' : 'Remove'}</Button>
              </div>
              <div className="draft-card-meta-row">
                <StatusTag tone={draft.source === 'auto-saved' ? 'yellow' : 'blue'}>
                  {draft.source === 'auto-saved' ? 'Auto-saved' : 'Saved'}
                </StatusTag>
                <span className="draft-card-date">{formatSavedDate(draft.savedAt)}</span>
              </div>
              <div className="draft-card-price-row">
                Listed at ${(draft.price ?? 0).toFixed(2)} · Paid ${(draft.goodwillPrice ?? 0).toFixed(2)} ·{' '}
                <span className="draft-profit">Est. profit ${(draft.estProfit ?? 0).toFixed(2)}</span>
              </div>
              <div className="draft-card-pills">
                {draft.condition && <StatusTag tone="mute">{draft.condition}</StatusTag>}
                {draft.category && <StatusTag tone="mute">{draft.category}</StatusTag>}
              </div>
              <div className="draft-card-actions">
                <Button variant="success" size="sm" full onClick={() => onRestoreDraft(draft)}>
                  Restore to listing
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
