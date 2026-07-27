import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { analyzeItem } from '../utils/ai';
import * as photoStore from '../utils/photoStore';
import { saveConversation, markStatus, getConversation } from '../utils/conversationStore';
import { useToast } from '../contexts/ToastContext';
import { shoppingService } from '../utils/storageService';
import { useUser } from '../contexts/UserContext';
import { calcProfit, checkRules, pencilFloor } from '../utils/calculations';
import { DEFAULT_SHIPPING } from '../config/gemini';
import Button from './ui/Button';
import Chip from './ui/Chip';
import StatusTag from './ui/StatusTag';
import Card from './ui/Card';
import { Panel, PanelRow, PanelTotal } from './ui/Panel';
import VerdictBanner from './ui/VerdictBanner';
import ListingPreviewCard from './ui/ListingPreviewCard';
import Sheet from './ui/Sheet';
import { Input } from './ui/Field';
import ActionBar from './ui/ActionBar';
import { Shutter, CamSide, PhotoRemoveDot } from './ui/CameraControls';
import './ShoppingMode.css';

const CONDITIONS = ['Like New', 'Excellent', 'Good', 'Fair'];

// Photos are the one thing that can fill localStorage mid-trip, so they are
// downscaled at capture — this is also what goes to the model.
const MAX_PHOTO_EDGE = 1280;
const PHOTO_QUALITY = 0.8;

// Analyze failures get specific copy — never "something went wrong". A wrong
// diagnosis here sends someone to re-paste a key that was fine all along.
const ERROR_COPY = {
  'bad-key': "That key didn't work — check the paste caught the whole thing",
  quota: 'Key works but Google says it’s out of free calls today',
  offline: 'No signal · the verdict catches up on its own',
  'bad-response': 'Odd reply from the model — try again',
  // N1-lite: the key is in the vault, so a declined unlock is its own failure
  // and must not be diagnosed as a bad key.
  locked: 'Unlock cancelled — verdicts need your key',
  'vault-unavailable': "Private Browsing won't let Thrift Flip open your key",
  'crypto-unavailable': 'Verdicts need a secure (https) connection',
};

function loadForm() {
  // Direct read — sync required for useState lazy init
  try { return JSON.parse(localStorage.getItem('thrift-flip-shopping-form')); } catch { return null; }
}
function loadVerdict() {
  // Direct read — sync required for useState lazy init
  try { return JSON.parse(localStorage.getItem('thrift-flip-shopping-verdict')); } catch { return null; }
}

async function fileToBase64(photo) {
  if (photo.base64) return photo.base64;
  const response = await fetch(photo.previewUrl);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e  => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Downscale at capture: a phone photo is ~4MB and localStorage caps near 5MB,
// so full-size base64 fills it inside a dozen items. Shrinking here shrinks both
// the stored payload and the request — the persisted base64 is what gets sent.
function downscaleToBase64(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function ChartIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
function BulbIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 017 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 017-7z" />
      <path d="M9 22h6" />
    </svg>
  );
}

export default function ShoppingMode({ onAddToCart, onNavigateToCart, onGoToFlip, onGoToSelling, onCamActive, onOpenSettings }) {
  const { showToast } = useToast();
  const { user } = useUser(); // TODO: check user.plan analysis limits before analyze

  const savedForm    = useRef(loadForm());
  const savedVerdict = useRef(loadVerdict());

  const [phase, setPhase] = useState(() => {
    if (savedVerdict.current?.phase === 'verdict' && savedVerdict.current?.analysisResult) return 'verdict';
    if (savedVerdict.current?.phase === 'pencil' && savedVerdict.current?.itemId) return 'pencil';
    return 'capture';
  });
  // Photos live in IndexedDB since V3, so they cannot be read synchronously in
  // a lazy initializer the way the rest of the form is. They arrive in the
  // rehydration effect below; `photoCount` is what the form now carries, purely
  // so the capture strip knows how many are coming.
  const [photos, setPhotos] = useState([]);
  const [photosHydrated, setPhotosHydrated] = useState(false);
  const [details,        setDetails]       = useState(() => savedForm.current?.details       ?? '');
  const [condition,      setCondition]     = useState(() => savedForm.current?.condition     ?? '');
  const [goodwillPrice,  setGoodwillPrice] = useState(() => savedForm.current?.goodwillPrice ?? '');
  const [shipping,       setShipping]      = useState(() => savedForm.current?.shipping ?? String(DEFAULT_SHIPPING));
  const [analysisResult, setAnalysisResult]= useState(() => savedVerdict.current?.analysisResult ?? null);
  const [itemId,         setItemId]        = useState(() => savedVerdict.current?.itemId     ?? null);
  const [chatHistory,    setChatHistory]   = useState(() => {
    const id = savedVerdict.current?.itemId;
    return id ? (getConversation(id)?.chatHistory ?? []) : [];
  });
  const [errorCode,      setErrorCode]     = useState(null);
  const [keyCardHidden,  setKeyCardHidden] = useState(false); // per session, never a wall
  const [whyOpen,        setWhyOpen]       = useState(false);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);

  const fileInputRef = useRef(null);
  const photosRef    = useRef([]);
  const reqSeq       = useRef(0);
  const quotaWarned  = useRef(false);

  // A blob URL from stored bytes, so a restored photo renders like a fresh one.
  const toPreview = ({ base64, mimeType }) => ({
    file: null,
    base64,
    mimeType: mimeType || 'image/jpeg',
    previewUrl: URL.createObjectURL(
      new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: mimeType || 'image/jpeg' })
    ),
  });

  // Rehydrate the capture strip, and migrate any pre-V3 photos out of the form
  // on the way. `savedForm` is a ref captured before any effect ran, so the
  // legacy bytes are still readable here even though the persistence effect
  // below has already rewritten the slimmed form.
  useEffect(() => {
    let live = true;
    const restoreKey = savedVerdict.current?.itemId ?? photoStore.IN_FLIGHT;
    (async () => {
      const legacy = savedForm.current?.photoBase64s ?? [];
      if (legacy.length) {
        const migrated = legacy
          .map(item => (typeof item === 'string'
            ? { base64: item, mimeType: 'image/jpeg' }
            : { base64: item.b64, mimeType: item.mime || 'image/jpeg' }))
          .filter(p => p.base64);
        if (migrated.length) await photoStore.put(restoreKey, migrated);
      }
      const stored = await photoStore.get(restoreKey);
      if (live) setPhotos(stored.map(toPreview));
    })()
      .catch(() => { /* a broken store must not take the capture screen down */ })
      .finally(() => { if (live) setPhotosHydrated(true); });
    return () => { live = false; };
  }, []);

  // Capture writes straight through to the store, under the item's id once it
  // has one and the reserved in-flight key before that.
  useEffect(() => {
    if (!photosHydrated) return;
    const payload = photos.map(p => ({ base64: p.base64, mimeType: p.mimeType })).filter(p => p.base64);
    photoStore.put(itemId ?? photoStore.IN_FLIGHT, payload).catch(() => { /* surfaced on read */ });
  }, [photos, itemId, photosHydrated]);

  // Keep photosRef in sync for unmount cleanup
  useEffect(() => { photosRef.current = photos; }, [photos]);

  // Only revoke blob URLs for fresh photos on unmount — restored photos (file: null) keep their URLs alive across tab switches
  useEffect(() => () => {
    photosRef.current
      .filter(p => p.file !== null)
      .forEach(p => URL.revokeObjectURL(p.previewUrl));
  }, []);

  useEffect(() => {
    // No photo bytes here any more — they are in photoStore. This form was the
    // single biggest thing in localStorage and the first thing a real trip
    // would have broken (plan §6.1).
    shoppingService.setForm({ details, condition, goodwillPrice, shipping, photoCount: photos.length }).then(written => {
      // A full quota is a silent write failure otherwise — and the thing lost is
      // the capture in progress. Latched so it warns once, not once per keystroke.
      if (written === false && !quotaWarned.current) {
        quotaWarned.current = true;
        showToast('Storage full — export a backup, then remove old drafts', 'error');
      } else if (written !== false) {
        quotaWarned.current = false;
      }
    });
  }, [details, condition, goodwillPrice, shipping, photos, showToast]);

  useEffect(() => {
    if (phase === 'pencil' && itemId) {
      shoppingService.setVerdict({ phase: 'pencil', itemId });
    } else if (phase === 'verdict' && analysisResult) {
      shoppingService.setVerdict({ analysisResult, phase, itemId });
    }
  }, [phase, analysisResult, itemId]);

  // The capture phase owns the whole viewport — App hides the nav while it's up.
  // Layout effect so in-session phase transitions repaint App before the frame (no nav pop).
  useLayoutEffect(() => { onCamActive?.(phase === 'capture'); }, [phase, onCamActive]);

  async function handlePhotoChange(e) {
    const files = Array.from(e.target.files);
    const remaining = 3 - photos.length;
    if (files.length > remaining) showToast('Maximum 3 photos allowed', 'error');
    const taken = files.slice(0, remaining);
    const newPhotos = await Promise.all(taken.map(async f => {
      const previewUrl = URL.createObjectURL(f);
      const downscaled = await downscaleToBase64(f);
      // Canvas re-encodes to JPEG; fall back to the original bytes if it fails
      return downscaled
        ? { file: f, previewUrl, base64: downscaled, mimeType: 'image/jpeg' }
        : { file: f, previewUrl, base64: await fileToBase64({ previewUrl }), mimeType: f.type || 'image/jpeg' };
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
    e.target.value = '';
  }

  function handleRemovePhoto(index) {
    const target = photos[index];
    if (target) URL.revokeObjectURL(target.previewUrl);
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    if (next.length === 0) setPhotoSheetOpen(false);
  }

  async function runAnalyze(id) {
    const myReq = ++reqSeq.current;
    try {
      const validPhotos = photos.filter(p => p.previewUrl);
      const photoBase64s = await Promise.all(validPhotos.map(fileToBase64));
      const mimeTypes = validPhotos.map(p => p.mimeType || 'image/jpeg');
      const price = parseFloat(goodwillPrice);
      const result = await analyzeItem({
        photoBase64s, mimeTypes, details, condition,
        goodwillPrice: price, shipping: shippingCost(),
      });
      if (reqSeq.current !== myReq) return; // stale — skipped, carted, or reset mid-flight
      saveConversation(id, details.slice(0, 60) || 'Item', result.chatHistory || [], { details, condition, goodwillPrice: price });
      setAnalysisResult(result);
      setChatHistory(result.chatHistory || []);
      setErrorCode(null);
      setPhase('verdict');
    } catch (e) {
      // Log the code only — an error carrying the request URL would carry the key
      console.error('runAnalyze failed:', e?.code ?? 'unknown');
      if (reqSeq.current !== myReq) return;
      setErrorCode(e?.code ?? 'bad-response');
      // A cancelled unlock deserves an immediate answer rather than only the
      // banner; the pencil floor stays on screen and nothing retries.
      if (e?.code === 'locked') showToast(ERROR_COPY.locked, 'error');
    }
  }

  // Resume an analysis lost to a refresh — restored pencil phase re-fires from
  // persisted form data. Declared after runAnalyze so the reference is a plain read.
  useEffect(() => {
    if (phase === 'pencil' && !analysisResult) {
      const price = parseFloat(goodwillPrice);
      if (!price || price <= 0 || !itemId) {
        shoppingService.clearVerdict();
        setPhase('capture');
        return;
      }
      runAnalyze(itemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleGetVerdict() {
    const price = parseFloat(goodwillPrice);
    if (!price || price <= 0) {
      showToast('Enter a Goodwill price first', 'error');
      return;
    }
    const newId = Date.now();
    // The photos were captured before this item had an id; hand them over.
    photoStore.promote(photoStore.IN_FLIGHT, newId).catch(() => { /* surfaced on read */ });
    setItemId(newId);
    setErrorCode(null);
    setPhase('pencil');
    runAnalyze(newId);
  }

  function handleSkip() {
    reqSeq.current++; // invalidate any in-flight verdict
    resetForm();
  }

  function handleAddToCart() {
    reqSeq.current++; // invalidate any in-flight verdict — no stamped flash during the toast window
    const gp = parseFloat(goodwillPrice);
    const ship = shippingCost();
    let payload;
    if (phase === 'verdict' && analysisResult) {
      const { estSellPrice, fees, netProfit, soldCount, sellThroughRate, avgDaysToSell, activeListings,
              listing, listingMercari } = analysisResult;
      payload = {
        id: itemId,
        name: details.slice(0, 60) || 'Unnamed Item',
        condition,
        goodwillPrice: gp,
        estSellPrice,
        fees,
        shipping: ship,
        netProfit,
        // Model-only comps at V1 — the cart renders these straight into pills,
        // so nulls have to become dashes here or they print as "nulld avg sale"
        soldCount: soldCount ?? 0,
        sellThroughRate: sellThroughRate ?? '–',
        avgDaysToSell: avgDaysToSell ?? '–',
        activeListings: activeListings ?? 0,
        // The model's own listing, both registers — the editor seeds from these
        // instead of regenerating a placeholder one (V1.5/E0)
        listing: listing ?? null,
        listingMercari: listingMercari ?? null,
        chatHistory,
      };
    } else {
      // Pencil-phase add: local figures only; the verdict reconciliation flags this item later
      const floor = pencilFloor(gp, ship);
      const { ebayFee, net } = calcProfit(floor, gp, ship);
      payload = {
        id: itemId,
        name: details.slice(0, 60) || 'Unnamed Item',
        condition,
        goodwillPrice: gp,
        estSellPrice: floor,
        fees: ebayFee,
        shipping: ship,
        netProfit: net,
        soldCount: 0,
        sellThroughRate: '–',
        avgDaysToSell: '–',
        activeListings: 0,
        // Pencil items were never analyzed, so there is no model listing to carry;
        // CartMode falls back to the mock generator for these.
        listing: null,
        listingMercari: null,
        chatHistory: [],
        pending: true,
      };
    }
    onAddToCart(payload);
    if (itemId) markStatus(itemId, 'cart');
    showToast('Added to cart!');
    setTimeout(() => {
      resetForm();
      onNavigateToCart();
    }, 1200);
  }

  function resetForm() {
    shoppingService.clearAll();
    photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setPhase('capture');
    setDetails('');
    setCondition('');
    setGoodwillPrice('');
    setShipping(String(DEFAULT_SHIPPING));
    setAnalysisResult(null);
    setChatHistory([]);
    setItemId(null);
    setErrorCode(null);
    setWhyOpen(false);
    setPhotoSheetOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // A cleared field means "unset", not "free" — calculations.js applies the default
  function shippingCost() {
    const n = parseFloat(shipping);
    return Number.isFinite(n) ? n : DEFAULT_SHIPPING;
  }

  const lastPhoto = photos[photos.length - 1];

  function renderCapture() {
    return (
      <div className="buy-cam">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: 'none' }}
          onChange={handlePhotoChange}
        />
        <div className="buy-vf">
          {lastPhoto && <img className="buy-vf-backdrop" src={lastPhoto.previewUrl} alt="" />}
          <i className="buy-bk buy-bk1" /><i className="buy-bk buy-bk2" />
          <i className="buy-bk buy-bk3" /><i className="buy-bk buy-bk4" />
        </div>
        <div className="buy-details">
          <Input
            placeholder="Notes — brand, model, size"
            value={details}
            onChange={e => setDetails(e.target.value)}
          />
          <div className="buy-chips">
            {CONDITIONS.map(c => (
              <Chip key={c} selected={condition === c} onPress={() => setCondition(c)}>{c}</Chip>
            ))}
          </div>
          <div className="buy-money-row">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Goodwill price $0.00"
              value={goodwillPrice}
              onChange={e => setGoodwillPrice(e.target.value)}
            />
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              aria-label="Shipping cost"
              placeholder={`Ship $${DEFAULT_SHIPPING}`}
              value={shipping}
              onChange={e => setShipping(e.target.value)}
            />
          </div>
          {photos.length > 0 && (
            <Button full onClick={handleGetVerdict}>Get the verdict</Button>
          )}
        </div>
        <div className="buy-cam-ctl">
          {lastPhoto ? (
            <CamSide onClick={() => setPhotoSheetOpen(true)} aria-label="Manage photos">
              <img src={lastPhoto.previewUrl} alt="" />
            </CamSide>
          ) : (
            <span className="buy-cam-spacer" />
          )}
          <Shutter onClick={() => fileInputRef.current?.click()} aria-label="Take photo" />
          <CamSide onClick={onGoToSelling} aria-label="Selling"><ChartIcon /></CamSide>
        </div>
        <Sheet open={photoSheetOpen} onClose={() => setPhotoSheetOpen(false)} title={`Photos · ${photos.length} / 3`}>
          <div className="buy-sheet-strip">
            {photos.map((p, i) => (
              <div key={i} className="buy-sheet-thumb">
                <img src={p.previewUrl} alt={`Photo ${i + 1}`} />
                <PhotoRemoveDot onClick={() => handleRemovePhoto(i)} />
              </div>
            ))}
          </div>
          {photos.length < 3 && (
            <Button variant="outline" full onClick={() => fileInputRef.current?.click()}>Add another photo</Button>
          )}
        </Sheet>
      </div>
    );
  }

  function renderPencil() {
    const gp = parseFloat(goodwillPrice) || 0;
    const ship = shippingCost();
    const floor = pencilFloor(gp, ship);
    const feesAtFloor = calcProfit(floor, gp, ship).ebayFee;
    const noKey = errorCode === 'no-key';
    return (
      <div className="screen buy-barred">
        {errorCode && !noKey && (
          <StatusTag tone="mute" className="buy-sig">
            <i className="buy-sig-dot" />{ERROR_COPY[errorCode] ?? ERROR_COPY['bad-response']}
          </StatusTag>
        )}
        <VerdictBanner verdict="pencil" label="Your call for now" detail="figured on this phone" />
        <Panel title="What it must sell for">
          <div className="buy-floor money">
            ${floor.toFixed(2)}<span className="buy-floor-suffix"> or more</span>
          </div>
          <PanelRow label="Paid at Goodwill" value={`−$${gp.toFixed(2)}`} />
          <PanelRow label="Fees + shipping at that price" value={`−$${(feesAtFloor + ship).toFixed(2)}`} />
          <PanelRow label="Your rules — 3× and $20 net" value={`$${floor.toFixed(2)} floor`} />
          <div className="buy-floor-q">Would a buyer pay ${Math.ceil(floor)}?</div>
        </Panel>
        {noKey && !keyCardHidden && (
          <Card className="buy-keycard">
            <div>
              <b>Add your AI key to get stamped verdicts</b>
              <p>Verdicts run on your key, straight from this phone, no middleman.</p>
            </div>
            <div className="buy-keycard-actions">
              <Button size="sm" onClick={onOpenSettings}>Add key</Button>
              <Button size="sm" variant="outline" onClick={() => setKeyCardHidden(true)}>Not now</Button>
            </div>
          </Card>
        )}
        {errorCode === 'bad-key' && (
          <Button variant="outline" full onClick={onOpenSettings}>Check your AI key</Button>
        )}
        <p className="buy-reassure">Acting now is fine — if the verdict disagrees later, it flags the item in your cart.</p>
        <ActionBar>
          <Button variant="danger" onClick={handleSkip}>Skip it</Button>
          <Button onClick={handleAddToCart}>Add to cart</Button>
        </ActionBar>
      </div>
    );
  }

  function renderWhySheet() {
    const { estSellPrice, confidence, rationale, priceRange } = analysisResult;
    const [lo, hi] = priceRange ?? [];
    const hasRange = Number.isFinite(lo) && Number.isFinite(hi);
    const searchTitle = analysisResult.listing?.title || details || 'thrift find';
    // The comps that actually informed THIS estimate, carried back by adapt() —
    // not recomputed, so the sheet can never cite a sale the model never saw.
    const ownSales = analysisResult.comps?.samples ?? [];
    return (
      <Sheet
        open={whyOpen}
        onClose={() => setWhyOpen(false)}
        title={<>Where <span className="money">${estSellPrice.toFixed(2)}</span> comes from</>}
      >
        <div className="buy-src">
          <div className="buy-src-ic mute"><BulbIcon /></div>
          <div>
            <b>Model read · {confidence ?? 'low'} confidence</b>
            <p>{rationale || 'No reasoning came back with this estimate.'}</p>
            {hasRange && <p className="money">Range ${lo.toFixed(2)}–${hi.toFixed(2)}.</p>}
          </div>
        </div>
        <div className="buy-src">
          <div className="buy-src-ic green"><CheckIcon /></div>
          <div>
            <b>Your own sales</b>
            {ownSales.length === 0 ? (
              <p>None yet — fills in as you sell.</p>
            ) : ownSales.slice(0, 2).map((s, i) => (
              <p key={i}>
                You sold one for ${s.price.toFixed(2)}
                {s.daysToSell === null ? '' : ` in ${s.approxDays ? 'about ' : ''}${s.daysToSell} day${s.daysToSell === 1 ? '' : 's'}`}.
              </p>
            ))}
          </div>
        </div>
        <div className="buy-src">
          <div className="buy-src-ic blue"><SearchIcon /></div>
          <div>
            <b>eBay sold listings</b>
            <p>Not wired yet — check them yourself below. Sold prices are the only ground truth.</p>
          </div>
        </div>
        <div className="buy-src-footer">
          <Button
            variant="outline"
            full
            onClick={() => window.open(
              `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchTitle)}&LH_Sold=1&LH_Complete=1`,
              '_blank',
              'noopener',
            )}
          >
            See sold listings on eBay
          </Button>
        </div>
      </Sheet>
    );
  }

  function renderVerdict() {
    const gp = parseFloat(goodwillPrice) || 0;
    const ship = shippingCost();
    const { estSellPrice, fees, netProfit, confidence } = analysisResult;
    const { rule1, rule2, verdict } = checkRules(estSellPrice, gp, netProfit);
    const go = verdict === 'buy';
    const goDetail = confidence && confidence !== 'high'
      ? `model estimate · ${confidence} confidence`
      : `${(estSellPrice / pencilFloor(gp, ship)).toFixed(1)}× over your floor`;
    return (
      <div className="screen buy-barred">
        <VerdictBanner
          verdict={go ? 'go' : 'skip'}
          label={go ? 'BUY IT' : 'SKIP IT'}
          detail={go ? goDetail : 'under your floor'}
        />
        <ListingPreviewCard
          className={go ? undefined : 'buy-skip-card'}
          photos={photos.length ? photos.map((p, i) => <img key={i} src={p.previewUrl} alt={`Photo ${i + 1}`} />) : null}
          title={details || 'Untitled find'}
          condition={condition ? `Pre-owned · ${condition}` : 'Pre-owned'}
          price={`$${estSellPrice.toFixed(2)}`}
          obo={go}
          struck={!go}
          shipping={go ? `+$${ship.toFixed(2)} shipping` : null}
          soldLine={go ? 'Model estimate — verify before big buys' : 'Under your floor at this price'}
          onSoldTap={go ? () => setWhyOpen(true) : undefined}
        />
        <Panel title="Your earnings">
          <PanelRow label="Item price" value={`$${estSellPrice.toFixed(2)}`} onValueTap={go ? () => setWhyOpen(true) : undefined} />
          <PanelRow label="Selling costs · 13.25% + $0.30" value={`−$${fees.toFixed(2)}`} />
          <PanelRow label="Shipping label" value={`−$${ship.toFixed(2)}`} />
          <PanelRow label="Paid at Goodwill" value={`−$${gp.toFixed(2)}`} />
          <PanelTotal label="You'd keep" value={`$${netProfit.toFixed(2)}`} tone={go ? 'green' : 'red'} />
          <div className="buy-checks">
            <span className={rule1 ? 'y' : 'n'}>{rule1 ? '✓' : '✗'} 3× rule</span>
            <span className={rule2 ? 'y' : 'n'}>{rule2 ? '✓' : '✗'} $20 minimum</span>
          </div>
        </Panel>
        {/* The prototype's "It'd need to be $X to work" skip line is omitted — its price
            inversion belongs to V1's calculations.js work (plan §6.1), same as the pencil floor. */}
        {go && (
          <Card className="buy-advisor">
            <div className="buy-advisor-av">F</div>
            <p className="buy-advisor-teaser">{analysisResult.chatHistory?.[0]?.text ?? ''}</p>
            <button type="button" className="buy-advisor-chat" onClick={() => onGoToFlip?.(itemId)} aria-label="Ask Flip">
              <ChatIcon />
            </button>
          </Card>
        )}
        <ActionBar>
          {go ? (
            <>
              <Button variant="danger" onClick={handleSkip}>Skip it</Button>
              <Button onClick={handleAddToCart}>Add to cart</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleSkip}>Next item</Button>
              <Button variant="danger" className="buy-bar-narrow" onClick={handleAddToCart}>Cart anyway</Button>
            </>
          )}
        </ActionBar>
        {renderWhySheet()}
      </div>
    );
  }

  if (phase === 'pencil') return renderPencil();
  if (phase === 'verdict' && analysisResult) return renderVerdict();
  return renderCapture();
}
