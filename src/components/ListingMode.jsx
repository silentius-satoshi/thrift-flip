import { useState, useEffect, useRef } from 'react';
import { regenerateField } from '../utils/ai';
import { sendToEbay } from '../utils/ebaySell';
import { mapEbayErrors } from '../utils/ebaySell';
import { describeEbay } from '../utils/ebayAuth';
import { calcProfit, checkRules } from '../utils/calculations';
import { DEFAULT_SHIPPING } from '../config/gemini';
import { addHistoryEntry } from '../utils/historyStore';
import { saveDraft } from '../utils/draftsStore';
import { useToast } from '../contexts/ToastContext';
import { listingEditsService } from '../utils/storageService';
import { useUser } from '../contexts/UserContext';
import Button from './ui/Button';
import Card from './ui/Card';
import Chip from './ui/Chip';
import { Field, Input, TextArea } from './ui/Field';
import IconButton from './ui/IconButton';
import { Panel, PanelTotal } from './ui/Panel';
import Row from './ui/Row';
import Select from './ui/Select';
import Sheet from './ui/Sheet';
import ActionBar from './ui/ActionBar';
import StatusTag from './ui/StatusTag';
import { buildEbayPackage, buildMercariPackage } from '../utils/listingFormat';
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

// Send failures get specific copy. eBay's own validation messages are cryptic
// (ebay §6), so anything it names lands on the field it names — and whatever
// happens, "Copy for eBay" stays reachable so a validation fight never strands
// the listing.
const SEND_COPY = {
  'not-connected': 'Connect eBay first — opening Settings',
  'no-policies': 'Your eBay account needs business policies — Seller Hub → Business Policies. Set them up once and this works.',
  'no-item-id': "This listing isn't linked to an item yet — save it as a draft first",
  offline: "No signal — eBay can't be reached right now",
  'app-token-failed': "Couldn't reach eBay's category service — try again",
  'ebay-rejected': 'eBay turned parts of this listing down — see the notes below',
  default: "Couldn't send this to eBay",
};

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

// eBay named a field; show it against that field rather than in a wall of text.
function FieldNote({ text }) {
  if (!text) return null;
  return <p className="listing-field-error">{text}</p>;
}

export default function ListingMode({ listingItem, listingData, onClearListing, onPreview, onRemoveFromCart, onViewDrafts, onOpenSettings }) {
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
  const [sendErrors, setSendErrors] = useState(null); // { fieldErrors, general }
  const [ebayConnected, setEbayConnected] = useState(undefined);
  const [regenLoading, setRegenLoading] = useState(null);
  const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);
  const [showVendooSheet, setShowVendooSheet] = useState(false);
  const [copied, setCopied] = useState(null); // 'ebay' | 'mercari' — which package is on the clipboard

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

  // Metadata only (the expiry hint beside the ciphertext), so opening the
  // editor never costs an unlock.
  useEffect(() => {
    let live = true;
    describeEbay()
      .then(d => { if (live) setEbayConnected(d.connected); })
      .catch(() => { if (live) setEbayConnected(false); });
    return () => { live = false; };
  }, []);

  async function handleSendToEbay() {
    if (ebayConnected === false) {
      showToast(SEND_COPY['not-connected'], 'error');
      onOpenSettings?.();
      return;
    }
    setIsSubmitting(true);
    setSendErrors(null);
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
        estProfit: calcProfit(parseFloat(price) || 0, listingItem?.goodwillPrice ?? 0, listingItem?.shipping ?? DEFAULT_SHIPPING).net,
        condition: selectedCondition,
        category: selectedCategory,
        // The item's real shipping, so E3's Earnings is not a guess. Without it
        // calcProfit falls back to $5.00 — the optimism V3 just removed.
        shipping: listingItem?.shipping,
        sentAt: Date.now(),
        status: 'draft_sent',
        // The real offer, and the SKU E3 matches sold orders back by (ebay §7).
        offerId: res.offerId,
        sku: res.sku,
      });
      // The photo-less decision, surfaced honestly once, at the moment it
      // matters — not buried in a settings screen he will never open.
      showToast('Draft sent — add photos in Seller Hub when you review', 'success');
      setTimeout(() => {
        onRemoveFromCart();
        onClearListing({ skipAutoSave: true });
      }, 1600);
    } catch (e) {
      // The listing deliberately does NOT clear on failure: the editor and the
      // Copy-for-eBay escape both have to survive for a retry to be possible.
      if (e?.code === 'ebay-rejected') setSendErrors(mapEbayErrors(e.errors));
      showToast(SEND_COPY[e?.code] ?? SEND_COPY.default, 'error');
      if (e?.code === 'not-connected') onOpenSettings?.();
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
      estProfit: calcProfit(parseFloat(price) || 0, listingItem?.goodwillPrice ?? 0, listingItem?.shipping ?? DEFAULT_SHIPPING).net,
      source: 'manual',
    });
    showToast('Draft saved', 'success');
  }

  const mercari = listingItem?.listingMercari ?? null;
  const sellPrice = parseFloat(price) || 0;
  const goodwillPrice = listingItem?.goodwillPrice || 0;
  // The item's OWN shipping, not calcProfit's $5.00 default. Omitting it made
  // this number disagree with the verdict screen's for the same item, by about
  // $7 in the optimistic direction — the editor is the last place a profit
  // figure should flatter itself.
  const itemShipping = listingItem?.shipping;
  const { net: liveProfit } = calcProfit(sellPrice, goodwillPrice, itemShipping);
  const { rule1: keeps3x, rule2: keeps20 } = checkRules(sellPrice, goodwillPrice, liveProfit);
  const rulesMissed = sellPrice > 0 && (!keeps3x || !keeps20);
  // What Dad reasoned to at the shelf, when this listing came from a pencil
  // item. The market governs the listing, but the floor stays visible.
  const shelfFloor = listingData?.pencilFloor ?? null;

  // The clipboard write has to resolve inside the user gesture, before the
  // window.open — Safari drops the permission otherwise.
  async function copyAndOpen(variant, text, url) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(variant);
      showToast(variant === 'ebay' ? 'eBay version copied' : 'Mercari version copied', 'success');
    } catch {
      showToast('Copy failed — long-press the fields to copy manually', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function handleCopyForEbay() {
    // Built from what is on screen now, not the original response
    return copyAndOpen('ebay', buildEbayPackage({
      title, price, condition: selectedCondition, specifics, description,
    }), 'https://www.ebay.com/sl/sell');
  }

  function handleCopyForMercari() {
    return copyAndOpen('mercari', buildMercariPackage(mercari), 'https://www.mercari.com/sell/');
  }

  if (!listingItem) {
    return (
      <div className="screen">
        <div className="listing-empty">
          <span className="empty-icon"><TagIcon /></span>
          <p>Select "Ready to list" from a cart item to create a listing.</p>
          <Button variant="outline" onClick={onViewDrafts}>
            <NoteIcon /> Saved Drafts
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen listing-screen">
      <div className="listing-header">
        <h2>Draft listing</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { handleSaveDraft(); onViewDrafts(); }}
          title="Auto-save and view drafts"
        >
          Drafts
        </Button>
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
          <IconButton label="Add photos" size="lg" className="photo-add-btn" onClick={() => photoInputRef.current?.click()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          </IconButton>
        </div>
      </div>

      {/* Title */}
      <div className="listing-section">
        <div className="field-header">
          <label className="listing-field-label">
            Title <span className="ai-label">✦ AI generated</span>
          </label>
          <IconButton
            label="Regenerate title"
            size="sm"
            className={regenLoading === 'title' ? 'loading' : ''}
            onClick={handleRegenTitle}
            disabled={regenLoading === 'title'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 11-3-6.7M21 3v6h-6" />
            </svg>
          </IconButton>
        </div>
        <Input
          maxLength={80}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <div className={`char-counter ${title.length > 60 ? 'warn' : ''}`}>
          {title.length} / 80
        </div>
        <FieldNote text={sendErrors?.fieldErrors?.title} />
      </div>

      {/* Condition */}
      <div className="listing-section">
        <div className="listing-section-title">Condition</div>
        <FieldNote text={sendErrors?.fieldErrors?.condition} />
        <div className="condition-pills">
          {CONDITIONS.map(c => (
            <Chip key={c} selected={selectedCondition === c} onPress={() => setSelectedCondition(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div className="listing-section">
        <div className="listing-section-title">Pricing</div>
        <FieldNote text={sendErrors?.fieldErrors?.price} />
        <FieldNote text={sendErrors?.fieldErrors?.qty} />
        <div className="price-qty-row">
          <Field label="Price" className="listing-price-field">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              min="0"
              step="0.01"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Qty" className="listing-qty-field">
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              value={qty}
              onChange={e => setQty(e.target.value)}
            />
          </Field>
        </div>
        {shelfFloor > 0 && (
          <p className="listing-shelf-floor">Your floor at the shelf: ${Number(shelfFloor).toFixed(2)}</p>
        )}
        {sellPrice > 0 && (
          <Panel className="listing-keep">
            <PanelTotal
              solo
              label="You'd keep"
              value={`$${liveProfit.toFixed(2)}`}
              tone={rulesMissed ? 'red' : 'green'}
            />
            {/* The same two rules the verdict screen shows. Without them a
                below-floor price reads as a merely smaller number. */}
            <div className="listing-checks">
              <span className={keeps3x ? 'y' : 'n'}>{keeps3x ? '✓' : '✗'} 3× rule</span>
              <span className={keeps20 ? 'y' : 'n'}>{keeps20 ? '✓' : '✗'} $20 minimum</span>
            </div>
          </Panel>
        )}
      </div>

      {/* Description */}
      <div className="listing-section">
        <label className="listing-field-label listing-desc-label">
          Description <span className="ai-label">✦ AI generated</span>
        </label>
        <FieldNote text={sendErrors?.fieldErrors?.description} />
        <div className="desc-toolbar">
          {[
            { label: '↻ Rewrite',    key: 'rewrite'  },
            { label: 'Shorter',      key: 'shorter'  },
            { label: 'More detail',  key: 'longer'   },
          ].map(({ label, key }) => (
            <Chip
              key={key}
              onPress={() => handleRegenDesc(key)}
              disabled={regenLoading !== null}
            >
              {regenLoading === `desc-${key}` ? '...' : label}
            </Chip>
          ))}
        </div>
        <TextArea
          className="listing-desc"
          rows={12}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      {/* Distribution */}
      {sendErrors && (
        <Card className="listing-send-error">
          <div className="lbl">eBay turned this down</div>
          {sendErrors.fieldErrors?.category && <p>{sendErrors.fieldErrors.category}</p>}
          {sendErrors.general.map((text, i) => <p key={i}>{text}</p>)}
          {!sendErrors.general.length && !sendErrors.fieldErrors?.category && (
            <p>The notes above mark what it objected to.</p>
          )}
          {/* §6's escape: a validation fight must never strand the listing. */}
          <Button variant="outline" full onClick={handleCopyForEbay}>Copy for eBay instead</Button>
        </Card>
      )}

      <div className="listing-section">
        <div className="listing-section-title">Where it goes</div>
        <div className="distribution-row">
          <Chip selected onPress={handleCopyForEbay}>Copy for eBay</Chip>
          <Chip disabled={!mercari} onPress={mercari ? handleCopyForMercari : undefined}>Copy for Mercari</Chip>
          <Chip onPress={() => setShowVendooSheet(true)}>Vendoo</Chip>
        </div>
        {copied && (
          <StatusTag tone="green" className="distribution-copied">
            {copied === 'ebay' ? 'eBay version copied' : 'Mercari version copied'}
          </StatusTag>
        )}
        {!mercari && (
          <p className="distribution-hint">Analyze the item to get the Mercari version.</p>
        )}
      </div>

      <Sheet open={showVendooSheet} onClose={() => setShowVendooSheet(false)} title="How Vendoo fits">
        <p className="vendoo-body">
          Vendoo is an optional fan-out, not something this app automates. The path is:
        </p>
        <Row title="1 · Send to eBay" sub="One tap from the action bar — creates a draft in Seller Hub" />
        <Row title="2 · Vendoo imports the eBay listing" sub="It reads the listing you already made" />
        <Row title="3 · Vendoo crosslists" sub="Mercari, Poshmark, Facebook Marketplace" />
        <p className="vendoo-body">
          We never build marketplace form-filling ourselves — that is Vendoo's full-time
          business. Without it, the copy buttons above are the floor.
        </p>
        <Button variant="outline" full className="save-draft-cancel" onClick={() => setShowVendooSheet(false)}>Close</Button>
      </Sheet>

      {/* Item specifics */}
      <div className="listing-section">
        <div className="listing-section-title">Item Specifics</div>
        <FieldNote text={sendErrors?.fieldErrors?.specifics} />
        <div className="specifics-grid">
          {Object.keys(specifics).map(key => (
            <Field label={key} key={key}>
              <Input
                value={specifics[key]}
                onChange={e => handleSpecificChange(key, e.target.value)}
                placeholder={key}
              />
            </Field>
          ))}
        </div>
      </div>

      {/* Shipping */}
      <div className="listing-section">
        <div className="listing-section-title">Shipping</div>
        <div className="shipping-options">
          {SHIPPING_OPTIONS.map(opt => (
            <Row
              key={opt.id}
              className={`shipping-option ${selectedShipping === opt.id ? 'selected' : ''}`}
              onPress={() => setSelectedShipping(opt.id)}
              aria-pressed={selectedShipping === opt.id}
              thumb={
                <span className="option-radio">
                  {selectedShipping === opt.id && <span className="option-radio-dot" />}
                </span>
              }
              title={opt.label}
              sub={opt.sub}
            />
          ))}
        </div>
      </div>

      {/* Category */}
      <div className="listing-section">
        <div className="listing-section-title">Category</div>
        <Select
          aria-label="Category"
          options={CATEGORIES}
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
        />
      </div>

      <Sheet open={showSaveDraftModal} onClose={() => setShowSaveDraftModal(false)} title="Save Draft">
        <Row
          onPress={() => { handleSaveDraft(); setShowSaveDraftModal(false); }}
          thumb={<span className="save-draft-icon green"><BookmarkIcon /></span>}
          title="Save and continue editing"
          sub="Keep working on this listing"
        />
        <Row
          onPress={() => { handleSaveDraft(); setShowSaveDraftModal(false); onViewDrafts(); }}
          thumb={<span className="save-draft-icon blue"><NoteIcon /></span>}
          title="Save and view all drafts"
          sub="Go to your saved drafts list"
        />
        <Button variant="outline" full className="save-draft-cancel" onClick={() => setShowSaveDraftModal(false)}>Cancel</Button>
      </Sheet>

      {/* Action bar */}
      <ActionBar className="listing-action-bar">
        <IconButton label="Save draft" size="lg" className="listing-draft-btn" onClick={() => setShowSaveDraftModal(true)}>
          <BookmarkIcon />
        </IconButton>
        <Button
          variant="outline"
          onClick={() => onPreview({
            title, price, selectedCondition, photos, specifics,
            shippingLabel: SHIPPING_OPTIONS.find(o => o.id === selectedShipping)?.label ?? '',
            description,
            selectedCategory,
          })}
        >
          Preview
        </Button>
        <Button onClick={handleSendToEbay} disabled={isSubmitting}>
          {isSubmitting ? 'Sending...' : 'Send to eBay drafts'}
        </Button>
      </ActionBar>

    </div>
  );
}
