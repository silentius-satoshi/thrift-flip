import { useState, useRef, useEffect } from 'react';
import { getIndex, saveConversation, updateChatHistory, getConversation, deleteConversation, archiveConversation, unarchiveConversation, pinConversation } from '../utils/conversationStore';
import ChatThread from './ChatThread';
import './FlipMode.css';

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
  const [view, setView] = useState('list'); // 'list' | 'chat' | 'archived'
  const [conversations, setConversations] = useState(() => getIndex());
  const [selectedId, setSelectedId] = useState(null);
  const [activeConv, setActiveConv] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [contextMenu, setContextMenu] = useState(null); // { id, x, y } | null

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
          <button onClick={() => handlePin(contextMenu.id, !conv?.pinned)}>
            {conv?.pinned ? 'Unpin' : 'Pin to top'}
          </button>
          {conv?.archived
            ? <button onClick={() => { handleUnarchive(contextMenu.id); setContextMenu(null); }}>Unarchive</button>
            : <button onClick={() => { handleArchive(contextMenu.id); setContextMenu(null); }}>Archive</button>
          }
          <button className="flip-menu-delete" onClick={() => { handleDelete(contextMenu.id); setContextMenu(null); }}>Delete</button>
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
        <div
          className="conv-row-inner"
          ref={el => { rowRefs.current[c.id] = el; }}
          onClick={() => openChat(c.id)}
          onTouchStart={e => handleTouchStart(e, c.id)}
          onTouchMove={e => handleTouchMove(e, c.id)}
          onTouchEnd={e => handleTouchEnd(e, c.id)}
        >
          <div className={`conv-avatar conv-avatar-${color}`}>
            {(c.itemName?.[0] ?? '?').toUpperCase()}
          </div>
          <div className="conv-center">
            <div className="conv-name-row">
              <span className="conv-name">{c.itemName}</span>
              {c.status === 'cart'   && <span className="conv-pill conv-pill-amber">In Cart</span>}
              {c.status === 'listed' && <span className="conv-pill conv-pill-blue">In Listing</span>}
            </div>
            <div className="conv-preview">{c.lastMessage ?? 'No messages yet'}</div>
          </div>
          <div className="conv-right">
            <span className="conv-time">{formatAge(c.createdAt)}</span>
            {c.pinned && <span className="conv-pin">📌</span>}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'chat') {
    return (
      <div className="screen flip-screen">
        <div className="flip-chat-header">
          <button className="flip-back-btn" onClick={() => { if (returnScreen) { onReturn?.(); } else { handleBack(); } }}>←</button>
          <span className="flip-chat-title">{activeConv?.itemName ?? 'Chat'}</span>
        </div>
        {inCart && (
          <div className="flip-banner" role="button" onClick={onNavigateToCart}>
            🛒 This item is in your cart — tap to view
          </div>
        )}
        {!inCart && inListing && (
          <div className="flip-banner" role="button" onClick={onNavigateToListing}>
            🏷️ Currently in Listing Mode — tap to view
          </div>
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
          <button className="flip-back-btn flip-back-btn-small" onClick={() => setView('list')}>←</button>
          <span className="flip-list-title">Archived Chats</span>
          <span style={{ width: 40 }} />
        </div>
        <div className="flip-conv-list">
          {archivedConvs.length === 0 ? (
            <div className="flip-empty">
              <span className="empty-icon">🗄️</span>
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
        <button className="flip-new-btn" onClick={handleNewChat}>+ New</button>
      </div>

      <div className="flip-conv-list">
        {visible.length === 0 ? (
          <div className="flip-empty">
            <span className="empty-icon">💬</span>
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
        <div className="conv-archived-row" onClick={() => setView('archived')}>
          <div className="conv-archived-icon">🗄️</div>
          <span className="conv-archived-label">Archived</span>
          <span className="conv-archived-count">{conversations.filter(c => c.archived).length}</span>
        </div>
      </div>

      {renderContextMenu()}
    </div>
  );
}
