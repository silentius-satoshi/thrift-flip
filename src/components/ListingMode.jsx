import { useState, useEffect, useRef } from 'react';
import { regenerateField, sendToEbay } from '../utils/webhooks';
import { calcProfit } from '../utils/calculations';
import { useToast } from '../contexts/ToastContext';
import './ListingMode.css';

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
  try {
    const raw = localStorage.getItem('thrift-flip-listing-edits');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function ListingMode({ listingItem, listingData, onClearListing, onPreview }) {
  const { showToast } = useToast();

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
    try {
      localStorage.setItem('thrift-flip-listing-edits', JSON.stringify(edits));
    } catch {
      // QuotaExceededError from large photo dataUrls — retry without photos
      try {
        localStorage.setItem('thrift-flip-listing-edits', JSON.stringify({ ...edits, photos: [] }));
      } catch { /* ignore */ }
    }
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
      localStorage.removeItem('thrift-flip-listing-edits');
      showToast(res.message, 'success');
      setTimeout(() => onClearListing(), 1600);
    } catch {
      showToast('Failed to send to eBay', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSaveDraft() {
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
          <span className="empty-icon">🏷️</span>
          <p>Select "Ready to list" from a cart item to create a listing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="listing-header">
        <h2>Draft listing</h2>
        <span className="pill pill-amber">✏️ Not published</span>
      </div>

      {/* Photos */}
      <div className="listing-section">
        <div className="listing-section-title">Photos</div>
        <div className="photo-ai-banner">
          📷 Goodwill photo was for AI only — add new photos here
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
            <div
              key={i}
              className={`photo-thumb ${i === 0 ? 'cover' : ''}`}
              onClick={() => makePhotoCover(i)}
            >
              <img src={p.dataUrl} alt={`Photo ${i + 1}`} />
              {i === 0 && <div className="cover-label">Cover</div>}
            </div>
          ))}
          <div className="photo-add-btn" onClick={() => photoInputRef.current?.click()}>+</div>
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
            <div
              key={opt.id}
              className={`shipping-option ${selectedShipping === opt.id ? 'selected' : ''}`}
              onClick={() => setSelectedShipping(opt.id)}
            >
              <div className="option-radio">
                {selectedShipping === opt.id && <div className="option-radio-dot" />}
              </div>
              <div className="option-text">
                <div className="option-label">{opt.label}</div>
                <div className="option-sub">{opt.sub}</div>
              </div>
            </div>
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

      {/* Action bar */}
      <div className="listing-action-bar">
        <button className="listing-draft-btn" onClick={handleSaveDraft} title="Save draft">
          🔖
        </button>
        <button
          className="btn btn-ghost listing-preview-btn"
          onClick={() => onPreview({
            title, price, selectedCondition, photos, specifics,
            shippingLabel: SHIPPING_OPTIONS.find(o => o.id === selectedShipping)?.label ?? '',
            description,
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
