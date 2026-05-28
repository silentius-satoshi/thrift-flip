import { useState } from 'react';
import { generateListing } from '../utils/webhooks';
import { markStatus } from '../utils/conversationStore';
import { useToast } from '../contexts/ToastContext';
import './CartMode.css';

export default function CartMode({ cart, onRemoveItem, onReadyToList, listingItem, onSaveCurrentAsDraft }) {
  const { showToast } = useToast();
  const [loadingId, setLoadingId] = useState(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingCartItem, setPendingCartItem] = useState(null);

  async function proceedWithListing(item) {
    setShowConflictModal(false);
    setPendingCartItem(null);
    setLoadingId(item.id);
    try {
      const listingData = await generateListing(item);
      markStatus(item.id, 'listed');
      onReadyToList(item, listingData);
      showToast('Listing generated!', 'success');
    } catch {
      showToast('Failed to generate listing', 'error');
    } finally {
      setLoadingId(null);
    }
  }

  async function handleReadyToList(item) {
    if (listingItem !== null) {
      setPendingCartItem(item);
      setShowConflictModal(true);
      return;
    }
    await proceedWithListing(item);
  }

  if (cart.length === 0) {
    return (
      <div className="screen">
        <div className="cart-empty">
          <span className="empty-icon">🛒</span>
          <p>No items yet. Go shopping and tap Add to cart.</p>
        </div>
      </div>
    );
  }

  const totalCost    = cart.reduce((s, i) => s + i.goodwillPrice, 0);
  const totalRevenue = cart.reduce((s, i) => s + i.estSellPrice, 0);
  const totalProfit  = cart.reduce((s, i) => s + i.netProfit, 0);

  return (
    <div className="screen">
      {showConflictModal && pendingCartItem && (
        <div className="conflict-modal-overlay" onClick={() => { setShowConflictModal(false); setPendingCartItem(null); }}>
          <div className="conflict-modal-card" onClick={e => e.stopPropagation()}>
            <div className="conflict-modal-title">Active listing in progress</div>
            <div className="conflict-modal-body">
              You have an unsaved listing in progress. What would you like to do?
            </div>
            <div className="conflict-modal-actions">
              <button className="btn btn-ghost btn-full" onClick={() => {
                onSaveCurrentAsDraft?.();
                proceedWithListing(pendingCartItem);
              }}>
                Save as draft &amp; continue
              </button>
              <button className="btn btn-red btn-full" onClick={() => proceedWithListing(pendingCartItem)}>
                Discard &amp; continue
              </button>
              <button className="btn btn-ghost btn-full" onClick={() => { setShowConflictModal(false); setPendingCartItem(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="cart-header">
        <h2>{cart.length} {cart.length === 1 ? 'item' : 'items'}</h2>
        <span className="cart-meta">Est. profit: ${totalProfit.toFixed(2)}</span>
      </div>

      {cart.map(item => (
        <div className="card" key={item.id}>
          <div className="cart-item-header">
            <div>
              <div className="cart-item-name">{item.name}</div>
              <div className="cart-item-meta">
                Paid ${item.goodwillPrice.toFixed(2)} · Est. sell ${item.estSellPrice.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="cart-item-pills">
            <span className={`pill ${item.netProfit >= 20 ? 'pill-green' : 'pill-amber'}`}>
              ${item.netProfit.toFixed(2)} profit
            </span>
            <span className="pill pill-blue">{item.avgDaysToSell}d avg sale</span>
            <span className="pill pill-muted">{item.sellThroughRate}% sell-through</span>
          </div>

          <div className="cart-item-banner">
            📷 Goodwill photo was for AI only — take new photos at home
          </div>

          {loadingId === item.id ? (
            <div className="cart-item-loading">Generating your listing...</div>
          ) : (
            <div className="cart-item-actions">
              <button
                className="btn btn-red btn-sm"
                onClick={() => onRemoveItem(item.id)}
              >
                Remove
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleReadyToList(item)}
              >
                Ready to list →
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="card">
        <div className="cart-summary-row">
          <span className="sr-label">Total Goodwill cost</span>
          <span className="sr-value">-${totalCost.toFixed(2)}</span>
        </div>
        <div className="cart-summary-row">
          <span className="sr-label">Est. total revenue</span>
          <span className="sr-value">${totalRevenue.toFixed(2)}</span>
        </div>
        <div className="cart-summary-divider" />
        <div className="cart-summary-row total">
          <span className="sr-label">Est. total profit</span>
          <span className="sr-value">${totalProfit.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
