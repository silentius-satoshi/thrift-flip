import { useState } from 'react';
import { getHistory, deleteHistoryEntry, clearHistory } from '../utils/historyStore';
import { useToast } from '../contexts/ToastContext';
import { useUser } from '../contexts/UserContext';
import { getDrafts } from '../utils/draftsStore';
import Button from './ui/Button';
import Card from './ui/Card';
import FourDotMark from './ui/FourDotMark';
import IconButton from './ui/IconButton';
import Row from './ui/Row';
import { StatGrid, Stat } from './ui/StatGrid';
import StatusTag from './ui/StatusTag';
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
  // Working = drafts not yet sent. The prototype's Sold section has no backing
  // data (entries carry one hardcoded status and no sale record), so it is not
  // built here — see docs; the real source lands at E3–E4.
  const [working] = useState(() => getDrafts());
  // Read the clock once per mount, not per render — the 90-day window does not
  // need to move mid-session, and Date.now() during render is impure.
  const [windowStart] = useState(() => Date.now() - 90 * 24 * 60 * 60 * 1000);

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

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const recent = history.filter(e => num(e.sentAt) > windowStart);
  const totalItems = recent.length;
  const totalProfit = recent.reduce((s, e) => s + num(e.estProfit), 0);
  const avgProfit = totalItems > 0 ? totalProfit / totalItems : 0;
  const bestFlip = recent.reduce((best, e) => (!best || num(e.estProfit) > num(best.estProfit)) ? e : best, null);

  const header = (withClear) => (
    <div className="selling-header">
      <div className="selling-title-group">
        <FourDotMark />
        <span className="selling-title">Selling</span>
      </div>
      <div className="selling-header-actions">
        <IconButton label="Settings" size="sm" onClick={onOpenSettings}><KeyIcon /></IconButton>
        {withClear && (
          <Button variant="plain" className="selling-clear-btn" onClick={handleClearAll}>
            {clearAllPending ? 'Confirm?' : 'Clear all'}
          </Button>
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

      <StatGrid className="selling-stats">
        <Stat value={totalItems} label="SENT · 90 DAYS" />
        <Stat value={`$${totalProfit.toFixed(2)}`} label="EST. PROFIT" tone="green" />
        <Stat value={`$${avgProfit.toFixed(2)}`} label="AVG PER ITEM" />
        <Stat value={`$${num(bestFlip?.estProfit).toFixed(2)}`} label={bestFlip ? `BEST: ${bestFlip.title.slice(0, 14)}…` : 'BEST FLIP'} tone="green" />
      </StatGrid>

      <div className="lbl selling-section">Sent to eBay</div>
      <Card className="selling-list">
        {history.map(entry => (
          <Row
            key={entry.id}
            title={entry.title}
            sub={`${formatSentDate(entry.sentAt)} · $${num(entry.price).toFixed(2)} · paid $${num(entry.goodwillPrice).toFixed(2)}`}
            trailing={
              <span className="selling-row-trailing">
                <b className="money selling-profit">+${num(entry.estProfit).toFixed(2)}</b>
                <Button
                  variant="danger"
                  size="sm"
                  className={pendingDelete === entry.id ? 'pending' : ''}
                  onClick={() => handleDelete(entry.id)}
                >{pendingDelete === entry.id ? 'Confirm?' : 'Remove'}</Button>
              </span>
            }
          />
        ))}
      </Card>

      {working.length > 0 && (
        <>
          <div className="lbl selling-section">Working</div>
          <Card className="selling-list">
            {working.map(d => (
              <Row
                key={d.id}
                title={d.title || 'Untitled draft'}
                sub={`Saved draft · $${num(d.price).toFixed(2)}`}
                trailing={<StatusTag tone={d.source === 'auto-saved' ? 'yellow' : 'blue'}>{d.source === 'auto-saved' ? 'Auto-saved' : 'Saved'}</StatusTag>}
              />
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
