import { useState } from 'react';
import { generateListing } from '../utils/webhooks';
import { markStatus } from '../utils/conversationStore';
import { useToast } from '../contexts/ToastContext';
import Button from './ui/Button';
import Card from './ui/Card';
import FourDotMark from './ui/FourDotMark';
import { Panel, PanelRow, PanelTotal } from './ui/Panel';
import Sheet from './ui/Sheet';
import StatusTag from './ui/StatusTag';
import './CartMode.css';

function CartIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.98-1.7l1.62-10.3H6" />
    </svg>
  );
}

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
        <div className="cart-header">
          <h2><FourDotMark />Cart</h2>
        </div>
        <div className="cart-empty">
          <span className="empty-icon"><CartIcon /></span>
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
      <Sheet
        open={showConflictModal && !!pendingCartItem}
        onClose={() => { setShowConflictModal(false); setPendingCartItem(null); }}
        title="Active listing in progress"
      >
        <p className="conflict-modal-body">
          You have an unsaved listing in progress. What would you like to do?
        </p>
        <div className="conflict-modal-actions">
          <Button variant="outline" full onClick={() => {
            onSaveCurrentAsDraft?.();
            proceedWithListing(pendingCartItem);
          }}>
            Save as draft &amp; continue
          </Button>
          <Button variant="danger" full onClick={() => proceedWithListing(pendingCartItem)}>
            Discard &amp; continue
          </Button>
          <Button variant="outline" full onClick={() => { setShowConflictModal(false); setPendingCartItem(null); }}>
            Cancel
          </Button>
        </div>
      </Sheet>
      <div className="cart-header">
        <h2><FourDotMark />{cart.length} {cart.length === 1 ? 'item' : 'items'}</h2>
        <span className="cart-meta">Est. profit: ${totalProfit.toFixed(2)}</span>
      </div>

      {cart.map(item => (
        <Card className="cart-item" key={item.id}>
          <div className="cart-item-header">
            <div>
              <div className="cart-item-name">{item.name}</div>
              <div className="cart-item-meta">
                Paid ${item.goodwillPrice.toFixed(2)} · Est. sell ${item.estSellPrice.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="cart-item-pills">
            <StatusTag tone={item.netProfit >= 20 ? 'green' : 'yellow'}>
              ${item.netProfit.toFixed(2)} profit
            </StatusTag>
            <StatusTag tone="blue">{item.avgDaysToSell}d avg sale</StatusTag>
            <StatusTag tone="mute">{item.sellThroughRate}% sell-through</StatusTag>
          </div>

          {loadingId === item.id ? (
            <div className="cart-item-loading">Generating your listing...</div>
          ) : (
            <div className="cart-item-actions">
              <Button variant="danger" size="sm" onClick={() => onRemoveItem(item.id)}>
                Remove
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleReadyToList(item)}>
                Ready to list →
              </Button>
            </div>
          )}
        </Card>
      ))}

      <Panel title="Trip so far">
        <PanelRow label="Total Goodwill cost" value={`−$${totalCost.toFixed(2)}`} />
        <PanelRow label="Est. total revenue" value={`$${totalRevenue.toFixed(2)}`} />
        <PanelTotal label="Est. total profit" value={`$${totalProfit.toFixed(2)}`} tone={totalProfit >= 0 ? 'green' : 'red'} />
      </Panel>
    </div>
  );
}
