import { useState, useEffect, useRef } from 'react';
import { regenerateField, sendToEbay } from '../utils/webhooks';
import { calcProfit } from '../utils/calculations';
import { addHistoryEntry } from '../utils/historyStore';
import { saveDraft } from '../utils/draftsStore';
import { useToast } from '../contexts/ToastContext';
import { listingEditsService } from '../utils/storageService';
import { useUser } from '../contexts/UserContext';
import './ListingMode.css';

function TagIcon({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}
function NoteIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
function BookmarkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>
  );
}

const CONDITIONS = ['New', 'Like New', 'Good', 'Acceptable', 'For Parts'];

const SHIPPING_OPTIONS = [
  { id: 'calculated', label: 'Calculated Shipping', sub: 'Buyer pays exact cost' },
  { id: 'free',       label: 'Free Shipping',       sub: 'You cover shipping costs' },
  { id: 'flat',       label: 'Flat Rate — $5.99',   sub: 'USPS First Class / Priority' },
];

const CATEGORIES = [
  'Clothing, Shoes & Accessories',
  'Home & Garden',
  'Collectibles',
  'Electronics',
  'Toys & Hobbies',
  'Books, Movies & Music',
  'Sporting Goods',
  'Jewelry & Watches',
  'Art',
  'Other',
];

function loadEdits() {
  // Direct read — sync required for useState lazy init
  try {
    const raw = localStorage.getItem('thrift-flip-listing-edits');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function ListingMode({ listingItem, listingData, onClearListing, onPreview, onRemoveFromCart, onViewDrafts }) {
  const { showToast } = useToast();
  const { user } = useUser(); // TODO: check user.plan listing limits before sendToEbay

  // Captured once per mount — shared across all lazy initializers below
  const savedEdits = useRef(loadEdits());

  const [photos, setPhotos] = useState(() =>
    (savedEdits.current?.photos ?? []).map(dataUrl => ({ dataUrl }))
  );
  const [title, setTitle] = useState(() => savedEdits.current?.title ?? '');
  const [selectedCondition, setSelectedCondition] = useState(() => savedEdits.current?.selectedCondition ?? 'Good');
  const [price, setPrice] = useState(() => savedEdits.current?.price ?? '');
  const [qty, setQty] = useState(() => savedEdits.current?.qty ?? '1');
  const [description, setDescription] = useState(() => savedEdits.current?.description ?? '');
  const [specifics, setSpecifics] = useState(() => savedEdits.current?.specifics ?? { Brand: '', Model: '', Size: '', Color: '', Material: '', MPN: '' });
  const [selectedShipping, setSelectedShipping] = useState(() => savedEdits.current?.selectedShipping ?? 'calculated');
  const [selectedCategory, setSelectedCategory] = useState(() => savedEdits.current?.selectedCategory ?? CATEGORIES[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [regenLoading, setRegenLoading] = useState(null);
  const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);

  const photoInputRef = useRef(null);

  // Only populate from listingData if the user has no saved edits (first time this listing opens)
  useEffect(() => {
    if (!listingData) return;
    if (savedEdits.current) return;
    setTitle(listingData.title || '');
    setDescription(listingData.description || '');
    setPrice(listingData.price ? String(listingData.price) : '');
    setSelectedCondition(listingData.condition || 'Good');
    setSelectedCategory(listingData.category || CATEGORIES[0]);
    if (listingData.specifics) {
      setSpecifics(prev => ({ ...prev, ...listingData.specifics }));
    }
  }, [listingData]);

  // Persist all editable fields on every change
  useEffect(() => {
    const edits = {
      title, selectedCondition, price, qty, description,
      specifics, selectedShipping, selectedCategory,
      photos: photos.map(p => p.dataUrl),
    };
    listingEditsService.set(edits).then(ok => {
      if (!ok) listingEditsService.set({ ...edits, photos: [] });
    });
  }, [title, selectedCondition, price, qty, description, specifics, selectedShipping, selectedCategory, photos]);

  function handleAddPhotos(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        setPhotos(prev => [...prev, { dataUrl: ev.target.result, file }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function makePhotoCover(index) {
    setPhotos(prev => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.unshift(item);
      return next;
    });
  }

  async function handleRegenTitle() {
    setRegenLoading('title');
    try {
      const res = await regenerateField({ field: 'title', currentValue: title, context: listingItem?.name || '' });
      setTitle(res.value);
    } catch {
      showToast('Could not regenerate title', 'error');
    } finally {
      setRegenLoading(null);
    }
  }

  async function handleRegenDesc(instruction) {
    setRegenLoading(`desc-${instruction}`);
    try {
      const res = await regenerateField({ field: `description-${instruction}`, currentValue: description, context: title });
      setDescription(res.value);
    } catch {
      showToast('Could not regenerate description', 'error');
    } finally {
      setRegenLoading(null);
    }
  }

  function handleSpecificChange(key, value) {
    setSpecifics(prev => ({ ...prev, [key]: value }));
  }

  async function handleSendToEbay() {
    setIsSubmitting(true);
    try {
      const res = await sendToEbay({
        title, description, condition: selectedCondition,
        price: parseFloat(price) || 0, qty: parseInt(qty) || 1,
        shipping: selectedShipping, category: selectedCategory,
        specifics, cartItemId: listingItem?.id,
      });
      listingEditsService.clear();
      addHistoryEntry({
        title,
        price: parseFloat(price) || 0,
        goodwillPrice: listingItem?.goodwillPrice ?? 0,
        estProfit: calcProfit(parseFloat(price) || 0, listingItem?.goodwillPrice ?? 0).net,
        condition: selectedCondition,
        category: selectedCategory,
        sentAt: Date.now(),
        status: 'draft_sent',
      });
      showToast(res.message, 'success');
      setTimeout(() => {
        onRemoveFromCart();
        onClearListing({ skipAutoSave: true });
      }, 1600);
    } catch {
      showToast('Failed to send to eBay', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSaveDraft() {
    saveDraft({
      id: listingItem?.id ?? Date.now(),
      title,
      price: parseFloat(price) || 0,
      condition: selectedCondition,
      description,
      specifics,
      shipping: selectedShipping,
      category: selectedCategory,
      photos: photos.map(p => ({ dataUrl: p.dataUrl, mimeType: 'image/jpeg' })),
      goodwillPrice: listingItem?.goodwillPrice ?? 0,
      estProfit: calcProfit(parseFloat(price) || 0, listingItem?.goodwillPrice ?? 0).net,
      source: 'manual',
    });
    showToast('Draft saved', 'success');
  }

  const sellPrice = parseFloat(price) || 0;
  const goodwillPrice = listingItem?.goodwillPrice || 0;
  const { net: liveProfit } = calcProfit(sellPrice, goodwillPrice);
  const profitClass = liveProfit < 0 ? 'neg' : liveProfit < 20 ? 'warn' : '';

  if (!listingItem) {
    return (
      <div className="screen">
        <div className="listing-empty">
          <span className="empty-icon"><TagIcon /></span>
          <p>Select "Ready to list" from a cart item to create a listing.</p>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onViewDrafts}>
            <NoteIcon /> Saved Drafts
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="listing-header">
        <h2>Draft listing</h2>
        <button
          className="listing-draft-status-btn"
          onClick={() => { handleSaveDraft(); onViewDrafts(); }}
          title="Auto-save and view drafts"
        >
          Drafts
        </button>
      </div>

      {/* Photos */}
      <div className="listing-section">
        <div className="listing-section-title">Photos</div>
        <div className="photo-ai-banner">
          <CameraIcon /> Goodwill photo was for AI only — add new photos here
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleAddPhotos}
        />
        <div className="photo-strip">
          {photos.map((p, i) => (
            <button
              type="button"
              key={i}
              className={`photo-thumb ${i === 0 ? 'cover' : ''}`}
              onClick={() => makePhotoCover(i)}
              aria-label={i === 0 ? `Photo ${i + 1}, cover` : `Make photo ${i + 1} the cover`}
            >
              <img src={p.dataUrl} alt="" />
              {i === 0 && <div className="cover-label">Cover</div>}
            </button>
          ))}
          <button type="button" className="photo-add-btn" onClick={() => photoInputRef.current?.click()} aria-label="Add photos">+</button>
        </div>
      </div>

      {/* Title */}
      <div className="listing-section">
        <div className="field-header">
          <label className="form-label">
            Title <span className="ai-label">✦ AI generated</span>
          </label>
          <button
            className={`refresh-btn ${regenLoading === 'title' ? 'loading' : ''}`}
            onClick={handleRegenTitle}
            disabled={regenLoading === 'title'}
            title="Regenerate title"
          >
            ↻
          </button>
        </div>
        <input
          className="form-input"
          maxLength={80}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <div className={`char-counter ${title.length > 60 ? 'warn' : ''}`}>
          {title.length} / 80
        </div>
      </div>

      {/* Condition */}
      <div className="listing-section">
        <div className="listing-section-title">Condition</div>
        <div className="condition-pills">
          {CONDITIONS.map(c => (
            <button
              key={c}
              className={`condition-pill ${selectedCondition === c ? 'selected' : ''}`}
              onClick={() => setSelectedCondition(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div className="listing-section">
        <div className="listing-section-title">Pricing</div>
        <div className="price-qty-row">
          <div className="form-group">
            <label className="form-label">Price</label>
            <div className="form-input-prefix">
              <span className="prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="0.00"
                min="0"
                step="0.01"
                value={price}
                onChange={e => setPrice(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Qty</label>
            <input
              type="number"
              className="form-input"
              min="1"
              value={qty}
              onChange={e => setQty(e.target.value)}
            />
          </div>
        </div>
        {sellPrice > 0 && (
          <div className={`profit-chip ${profitClass}`}>
            Est. profit: ${liveProfit.toFixed(2)}
          </div>
        )}
      </div>

      {/* Description */}
      <div className="listing-section">
        <label className="form-label" style={{ marginBottom: 8 }}>
          Description <span className="ai-label">✦ AI generated</span>
        </label>
        <div className="desc-toolbar">
          {[
            { label: '↻ Rewrite',    key: 'rewrite'  },
            { label: 'Shorter',      key: 'shorter'  },
            { label: 'More detail',  key: 'longer'   },
          ].map(({ label, key }) => (
            <button
              key={key}
              className="desc-tool-btn"
              onClick={() => handleRegenDesc(key)}
              disabled={regenLoading !== null}
            >
              {regenLoading === `desc-${key}` ? '...' : label}
            </button>
          ))}
        </div>
        <textarea
          className="form-textarea"
          rows={12}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      {/* Item specifics */}
      <div className="listing-section">
        <div className="listing-section-title">Item Specifics</div>
        <div className="specifics-grid">
          {Object.keys(specifics).map(key => (
            <div className="form-group" key={key}>
              <label className="form-label">{key}</label>
              <input
                className="form-input"
                value={specifics[key]}
                onChange={e => handleSpecificChange(key, e.target.value)}
                placeholder={key}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Shipping */}
      <div className="listing-section">
        <div className="listing-section-title">Shipping</div>
        <div className="shipping-options">
          {SHIPPING_OPTIONS.map(opt => (
            <button
              type="button"
              key={opt.id}
              className={`shipping-option ${selectedShipping === opt.id ? 'selected' : ''}`}
              onClick={() => setSelectedShipping(opt.id)}
              aria-pressed={selectedShipping === opt.id}
            >
              <div className="option-radio">
                {selectedShipping === opt.id && <div className="option-radio-dot" />}
              </div>
              <div className="option-text">
                <div className="option-label">{opt.label}</div>
                <div className="option-sub">{opt.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Category */}
      <div className="listing-section">
        <div className="listing-section-title">Category</div>
        <select
          className="category-select"
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {showSaveDraftModal && (
        <div className="save-draft-modal-overlay" onClick={() => setShowSaveDraftModal(false)}>
          <div className="save-draft-modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="save-draft-sheet-handle" />
            <div className="save-draft-sheet-title">Save Draft</div>

            <button className="save-draft-sheet-btn" onClick={() => { handleSaveDraft(); setShowSaveDraftModal(false); }}>
              <div className="save-draft-btn-icon green">&#128278;</div>
              <div className="save-draft-btn-text">
                <span className="save-draft-btn-label">Save and continue editing</span>
                <span className="save-draft-btn-sub">Keep working on this listing</span>
              </div>
            </button>

            <button className="save-draft-sheet-btn" onClick={() => { handleSaveDraft(); setShowSaveDraftModal(false); onViewDrafts(); }}>
              <div className="save-draft-btn-icon blue">&#128221;</div>
              <div className="save-draft-btn-text">
                <span className="save-draft-btn-label">Save and view all drafts</span>
                <span className="save-draft-btn-sub">Go to your saved drafts list</span>
              </div>
            </button>

            <button className="save-draft-cancel-btn" onClick={() => setShowSaveDraftModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="listing-action-bar">
        <button className="listing-draft-btn" onClick={() => setShowSaveDraftModal(true)} title="Save draft" aria-label="Save draft">
          <BookmarkIcon />
        </button>
        <button
          className="btn btn-ghost listing-preview-btn"
          onClick={() => onPreview({
            title, price, selectedCondition, photos, specifics,
            shippingLabel: SHIPPING_OPTIONS.find(o => o.id === selectedShipping)?.label ?? '',
            description,
            selectedCategory,
          })}
        >
          Preview
        </button>
        <button
          className="btn btn-green listing-send-btn"
          onClick={handleSendToEbay}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Sending...' : '✓ Send to eBay drafts'}
        </button>
      </div>

    </div>
  );
}
