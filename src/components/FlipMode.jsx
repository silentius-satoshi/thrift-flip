import { useState, useRef, useEffect } from 'react';
import { getIndex, saveConversation, updateChatHistory, getConversation, deleteConversation, archiveConversation, unarchiveConversation, pinConversation } from '../utils/conversationStore';
import ChatThread from './ChatThread';
import Button from './ui/Button';
import Card from './ui/Card';
import IconButton from './ui/IconButton';
import MenuItem from './ui/MenuItem';
import Row from './ui/Row';
import StatusTag from './ui/StatusTag';
import './FlipMode.css';

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.8V4h6v6.8l2.6 3.2a1 1 0 01-.78 1.6H7.18a1 1 0 01-.78-1.6z" />
    </svg>
  );
}
function CartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.98-1.7l1.62-10.3H6" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}
function ArchiveIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="5" rx="1" />
      <path d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}
function ChatIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function formatAge(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function statusColor(status) {
  if (status === 'cart') return 'amber';
  if (status === 'listed') return 'blue';
  return 'gray';
}

export default function FlipMode({ cart, listingItem, onNavigateToCart, onNavigateToListing, targetConversationId, onTargetConsumed, returnScreen, onReturn }) {
  const [view, setView] = useState(() => {
    // Direct read — sync required for useState lazy init
    return localStorage.getItem('thrift-flip-view') ?? 'list';
  });
  const [conversations, setConversations] = useState(() => getIndex());
  const [selectedId, setSelectedId] = useState(() => {
    // Direct read — sync required for useState lazy init
    const saved = localStorage.getItem('thrift-flip-selected-id');
    return saved ? parseInt(saved, 10) : null;
  });
  const [activeConv, setActiveConv] = useState(() => {
    // Direct read — sync required for useState lazy init
    const savedView = localStorage.getItem('thrift-flip-view');
    const savedId = localStorage.getItem('thrift-flip-selected-id');
    if (savedView === 'chat' && savedId) {
      return getConversation(parseInt(savedId, 10)) ?? null;
    }
    return null;
  });
  const [chatHistory, setChatHistory] = useState(() => {
    // Direct read — sync required for useState lazy init
    const savedView = localStorage.getItem('thrift-flip-view');
    const savedId = localStorage.getItem('thrift-flip-selected-id');
    if (savedView === 'chat' && savedId) {
      return getConversation(parseInt(savedId, 10))?.chatHistory ?? [];
    }
    return [];
  });
  const [contextMenu, setContextMenu] = useState(null); // { id, x, y } | null

  useEffect(() => {
    localStorage.setItem('thrift-flip-view', view);
    if (selectedId !== null) {
      localStorage.setItem('thrift-flip-selected-id', String(selectedId));
    } else {
      localStorage.removeItem('thrift-flip-selected-id');
    }
  }, [view, selectedId]);

  useEffect(() => {
    if (targetConversationId) {
      openChat(targetConversationId);
      onTargetConsumed?.();
    }
  }, []);

  const swipeRef     = useRef({}); // { [id]: { startX, dx, active } }
  const rowRefs      = useRef({}); // { [id]: DOM element }
  const longPressRef = useRef(null);

  function openChat(id) {
    const conv = getConversation(id);
    setActiveConv(conv);
    setChatHistory(conv?.chatHistory ?? []);
    setSelectedId(id);
    setView('chat');
  }

  function handleBack() {
    setView('list');
    setSelectedId(null);
    setConversations(getIndex());
  }

  function handleNewChat() {
    const id = Date.now();
    saveConversation(id, 'New Chat', [], null);
    setConversations(getIndex());
    openChat(id);
  }

  function handleUpdateHistory(updater) {
    setChatHistory(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (selectedId) updateChatHistory(selectedId, next);
      return next;
    });
  }

  function handleDelete(id) {
    deleteConversation(id);
    setConversations(getIndex());
  }

  function handleArchive(id) {
    archiveConversation(id);
    setConversations(getIndex());
  }

  function handleUnarchive(id) {
    unarchiveConversation(id);
    setConversations(getIndex());
  }

  function handlePin(id, pinned) {
    pinConversation(id, pinned);
    setConversations(getIndex());
    setContextMenu(null);
  }

  function handleTouchStart(e, id) {
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    swipeRef.current[id] = { startX: x, dx: 0, active: true };
    longPressRef.current = setTimeout(() => {
      setContextMenu({ id, x, y });
      swipeRef.current[id] = null;
    }, 500);
  }

  function handleTouchMove(e, id) {
    const s = swipeRef.current[id];
    if (!s?.active) return;
    const dx = e.touches[0].clientX - s.startX;
    if (Math.abs(dx) > 5) clearTimeout(longPressRef.current);
    s.dx = dx;
    const clamped = Math.max(-160, Math.min(160, dx));
    const el = rowRefs.current[id];
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${clamped}px)`;
    }
  }

  function handleTouchEnd(e, id) {
    clearTimeout(longPressRef.current);
    const s = swipeRef.current[id];
    if (!s?.active) return;
    s.active = false;
    const el = rowRefs.current[id];
    if (!el) return;
    el.style.transition = 'transform 0.2s ease';
    if (s.dx < -120) {
      handleDelete(id);
    } else if (s.dx > 120) {
      handleArchive(id);
    } else {
      el.style.transform = 'translateX(0)';
    }
    swipeRef.current[id] = null;
  }

  const inCart    = activeConv?.itemId && cart.some(i => i.id === activeConv.itemId);
  const inListing = activeConv?.itemId && listingItem?.id === activeConv.itemId;

  const visible = conversations.filter(c => !c.archived);
  const pinned  = visible.filter(c => c.pinned);
  const recent  = visible.filter(c => !c.pinned);

  function renderContextMenu() {
    if (!contextMenu) return null;
    const conv = conversations.find(c => c.id === contextMenu.id);
    return (
      <>
        <div className="flip-menu-backdrop" onClick={() => setContextMenu(null)} />
        <div
          className="flip-context-menu"
          style={{
            top:  Math.min(contextMenu.y, window.innerHeight - 150),
            left: Math.min(contextMenu.x, 240),
          }}
        >
          <MenuItem onClick={() => handlePin(contextMenu.id, !conv?.pinned)}>
            {conv?.pinned ? 'Unpin' : 'Pin to top'}
          </MenuItem>
          {conv?.archived
            ? <MenuItem onClick={() => { handleUnarchive(contextMenu.id); setContextMenu(null); }}>Unarchive</MenuItem>
            : <MenuItem onClick={() => { handleArchive(contextMenu.id); setContextMenu(null); }}>Archive</MenuItem>
          }
          <MenuItem tone="danger" onClick={() => { handleDelete(contextMenu.id); setContextMenu(null); }}>Delete</MenuItem>
        </div>
      </>
    );
  }

  function renderRow(c) {
    const color = statusColor(c.status);
    return (
      <div key={c.id} className="conv-row-wrap">
        <div className="swipe-bg-left">Archive</div>
        <div className="swipe-bg-right">Delete</div>
        <Row
          className="conv-row-inner"
          ref={el => { rowRefs.current[c.id] = el; }}
          onPress={() => openChat(c.id)}
          onTouchStart={e => handleTouchStart(e, c.id)}
          onTouchMove={e => handleTouchMove(e, c.id)}
          onTouchEnd={e => handleTouchEnd(e, c.id)}
          thumb={<div className={`conv-avatar conv-avatar-${color}`}>{(c.itemName?.[0] ?? '?').toUpperCase()}</div>}
          title={
            <span className="conv-name-row">
              <span className="conv-name">{c.itemName}</span>
              {c.status === 'cart'   && <StatusTag tone="yellow">In Cart</StatusTag>}
              {c.status === 'listed' && <StatusTag tone="blue">In Listing</StatusTag>}
            </span>
          }
          sub={c.lastMessage ?? 'No messages yet'}
          trailing={
            <span className="conv-right">
              <span className="conv-time">{formatAge(c.createdAt)}</span>
              {c.pinned && <span className="conv-pin" aria-label="Pinned"><PinIcon /></span>}
            </span>
          }
        />
      </div>
    );
  }

  if (view === 'chat') {
    return (
      <div className="screen flip-screen">
        <div className="flip-chat-header">
          <IconButton label="Back" size="sm" className="flip-back-btn" onClick={() => { if (returnScreen) { onReturn?.(); } else { handleBack(); } }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </IconButton>
          <span className="flip-chat-title">{activeConv?.itemName ?? 'Chat'}</span>
        </div>
        {inCart && (
          <Card className="flip-banner" onPress={onNavigateToCart}>
            <CartIcon /> This item is in your cart — tap to view
          </Card>
        )}
        {!inCart && inListing && (
          <Card className="flip-banner" onPress={onNavigateToListing}>
            <TagIcon /> Currently in Listing Mode — tap to view
          </Card>
        )}
        <div className="flip-chat-body">
        <ChatThread
          chatHistory={chatHistory}
          onUpdateHistory={handleUpdateHistory}
          itemContext={activeConv?.itemContext ?? null}
        />
      </div>
      </div>
    );
  }

  if (view === 'archived') {
    const archivedConvs = conversations.filter(c => c.archived);
    return (
      <div className="screen flip-screen">
        <div className="flip-list-header">
          <IconButton label="Back" size="sm" className="flip-back-btn" onClick={() => setView('list')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </IconButton>
          <span className="flip-list-title">Archived Chats</span>
          <span style={{ width: 40 }} />
        </div>
        <div className="flip-conv-list">
          {archivedConvs.length === 0 ? (
            <div className="flip-empty">
              <span className="empty-icon"><ArchiveIcon size={44} /></span>
              <p>No archived conversations</p>
            </div>
          ) : (
            archivedConvs.map(c => renderRow(c))
          )}
        </div>
        {renderContextMenu()}
      </div>
    );
  }

  return (
    <div className="screen flip-screen">
      <div className="flip-list-header">
        <span className="flip-list-title">Flip</span>
        <Button variant="plain" onClick={handleNewChat}>+ New</Button>
      </div>

      <div className="flip-conv-list">
        {visible.length === 0 ? (
          <div className="flip-empty">
            <span className="empty-icon"><ChatIcon size={44} /></span>
            <p>No conversations yet — analyze an item in Shopping or tap + New</p>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <div className="flip-section-label">Pinned</div>
                {pinned.map(c => renderRow(c))}
              </>
            )}
            {recent.length > 0 && (
              <>
                {pinned.length > 0 && <div className="flip-section-label">Recent</div>}
                {recent.map(c => renderRow(c))}
              </>
            )}
          </>
        )}
        <Row
          className="conv-archived-row"
          onPress={() => setView('archived')}
          thumb={<span className="conv-archived-icon"><ArchiveIcon /></span>}
          title="Archived"
          trailing={<span className="conv-archived-count">{conversations.filter(c => c.archived).length}</span>}
        />
      </div>

      {renderContextMenu()}
    </div>
  );
}
