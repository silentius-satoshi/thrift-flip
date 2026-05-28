import { useState, useRef, useEffect } from 'react';
import { analyzeItem } from '../utils/webhooks';
import { saveConversation, updateChatHistory, markStatus, getConversation } from '../utils/conversationStore';
import { useToast } from '../contexts/ToastContext';
import VerdictCard from './VerdictCard';
import SellVelocity from './SellVelocity';
import ChatThread from './ChatThread';
import './ShoppingMode.css';

const LOADING_MESSAGES = [
  'Searching eBay sold listings...',
  'Calculating flip potential...',
  'Analyzing market demand...',
  'Checking sell-through rates...',
  'Generating your verdict...',
];

function loadForm() {
  try { return JSON.parse(localStorage.getItem('thrift-flip-shopping-form')); } catch { return null; }
}
function loadVerdict() {
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

export default function ShoppingMode({ onAddToCart, onNavigateToCart }) {
  const { showToast } = useToast();

  const savedForm    = useRef(loadForm());
  const savedVerdict = useRef(loadVerdict());

  const [phase, setPhase] = useState(() =>
    savedVerdict.current?.phase === 'verdict' ? 'verdict' : 'form'
  );
  const [photos, setPhotos] = useState(() => {
    const savedPhotos = savedForm.current?.photoBase64s ?? [];
    return savedPhotos.map(item => {
      const b64  = typeof item === 'string' ? item : item.b64;
      const mime = typeof item === 'string' ? 'image/jpeg' : (item.mime || 'image/jpeg');
      if (!b64) return null;
      return {
        file: null,
        base64: b64,
        mimeType: mime,
        previewUrl: URL.createObjectURL(
          new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: mime })
        ),
      };
    }).filter(Boolean);
  });
  const [details,        setDetails]       = useState(() => savedForm.current?.details       ?? '');
  const [condition,      setCondition]     = useState(() => savedForm.current?.condition     ?? '');
  const [goodwillPrice,  setGoodwillPrice] = useState(() => savedForm.current?.goodwillPrice ?? '');
  const [analysisResult, setAnalysisResult]= useState(() => savedVerdict.current?.analysisResult ?? null);
  const [itemId,         setItemId]        = useState(() => savedVerdict.current?.itemId     ?? null);
  const [chatHistory,    setChatHistory]   = useState(() => {
    const id = savedVerdict.current?.itemId;
    return id ? (getConversation(id)?.chatHistory ?? []) : [];
  });
  const [lightboxPhoto,   setLightboxPhoto]   = useState(null);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [showResumeBanner, setShowResumeBanner] = useState(
    () => savedVerdict.current?.phase === 'verdict'
  );

  const fileInputRef = useRef(null);
  const intervalRef  = useRef(null);
  const photosRef    = useRef([]);

  // Keep photosRef in sync for unmount cleanup
  useEffect(() => { photosRef.current = photos; }, [photos]);

  // Only revoke blob URLs for fresh photos on unmount — restored photos (file: null) keep their URLs alive across tab switches
  useEffect(() => () => {
    photosRef.current
      .filter(p => p.file !== null)
      .forEach(p => URL.revokeObjectURL(p.previewUrl));
  }, []);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  useEffect(() => {
    localStorage.setItem('thrift-flip-shopping-form',
      JSON.stringify({ details, condition, goodwillPrice, photoBase64s: photos.map(p => ({ b64: p.base64, mime: p.mimeType })).filter(p => p.b64) }));
  }, [details, condition, goodwillPrice, photos]);

  useEffect(() => {
    if (phase === 'verdict' && analysisResult) {
      localStorage.setItem('thrift-flip-shopping-verdict',
        JSON.stringify({ analysisResult, phase, itemId }));
    }
  }, [phase, analysisResult, itemId]);

  async function handlePhotoChange(e) {
    const files = Array.from(e.target.files);
    const remaining = 3 - photos.length;
    if (files.length > remaining) showToast('Maximum 3 photos allowed', 'error');
    const taken = files.slice(0, remaining);
    const newPhotos = await Promise.all(taken.map(async f => {
      const previewUrl = URL.createObjectURL(f);
      const base64 = await fileToBase64({ previewUrl });
      return { file: f, previewUrl, base64, mimeType: f.type || 'image/jpeg' };
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
    e.target.value = '';
  }

  function handleRemovePhoto(index) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleRetakePhotos() {
    photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    localStorage.removeItem('thrift-flip-shopping-verdict');
    setPhase('form');
    setAnalysisResult(null);
    setChatHistory([]);
    setItemId(null);
    setShowResumeBanner(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleAnalyze() {
    const price = parseFloat(goodwillPrice);
    if (!price || price <= 0) {
      showToast('Enter a Goodwill price first', 'error');
      return;
    }
    localStorage.removeItem('thrift-flip-shopping-verdict');
    setPhase('loading');
    setLoadingMsgIndex(0);
    intervalRef.current = setInterval(() => {
      setLoadingMsgIndex(i => (i + 1) % LOADING_MESSAGES.length);
    }, 800);

    try {
      const validPhotos = photos.filter(p => p.previewUrl);
      if (validPhotos.length === 0 && photos.length > 0) {
        clearInterval(intervalRef.current);
        showToast('Photos were lost on refresh — please re-add them', 'error');
        setPhase('form');
        setPhotos([]);
        return;
      }
      const photoBase64s = await Promise.all(validPhotos.map(fileToBase64));
      const result = await analyzeItem({ photoBase64s, details, condition, goodwillPrice: price });
      clearInterval(intervalRef.current);
      const newId = Date.now();
      setItemId(newId);
      saveConversation(newId, details.slice(0, 60) || 'Item', result.chatHistory || [], { details, condition, goodwillPrice: price });
      setAnalysisResult(result);
      setChatHistory(result.chatHistory || []);
      setPhase('verdict');
    } catch (err) {
      console.error('handleAnalyze error:', err);
      clearInterval(intervalRef.current);
      showToast('Analysis failed — try again', 'error');
      setPhase('form');
    }
  }

  function handleUpdateHistory(updater) {
    setShowResumeBanner(false);
    setChatHistory(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (itemId) updateChatHistory(itemId, next);
      return next;
    });
  }

  function handleSkip() {
    resetForm();
  }

  function handleAddToCart() {
    if (!analysisResult) return;
    const { estSellPrice, fees, netProfit, soldCount, sellThroughRate, avgDaysToSell, activeListings } = analysisResult;
    onAddToCart({
      id: itemId,
      name: details.slice(0, 60) || 'Unnamed Item',
      condition,
      goodwillPrice: parseFloat(goodwillPrice),
      estSellPrice,
      fees,
      shipping: 5.00,
      netProfit,
      soldCount,
      sellThroughRate,
      avgDaysToSell,
      activeListings,
      chatHistory,
    });
    if (itemId) markStatus(itemId, 'cart');
    showToast('Added to cart!');
    setTimeout(() => {
      resetForm();
      onNavigateToCart();
    }, 1200);
  }

  function resetForm() {
    localStorage.removeItem('thrift-flip-shopping-form');
    localStorage.removeItem('thrift-flip-shopping-verdict');
    photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setPhase('form');
    setDetails('');
    setCondition('');
    setGoodwillPrice('');
    setAnalysisResult(null);
    setChatHistory([]);
    setItemId(null);
    setShowResumeBanner(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const isBuy = analysisResult
    ? analysisResult.estSellPrice >= parseFloat(goodwillPrice) * 3 && analysisResult.netProfit >= 20
    : false;

  if (phase === 'loading') {
    return (
      <div className="screen">
        <div className="loading-screen">
          <div className="loading-dots"><span /><span /><span /></div>
          <div className="loading-msg">{LOADING_MESSAGES[loadingMsgIndex]}</div>
        </div>
      </div>
    );
  }

  if (phase === 'verdict' && analysisResult) {
    return (
      <div className="screen">
        <div className="verdict-phase">
          {showResumeBanner && (
            <div className="shopping-resume-banner">
              ↩ Resuming your last analysis — tap Skip to start fresh
            </div>
          )}
          {photos.length > 0 && (
            <div className="shop-photo-strip verdict-strip">
              {photos.map((p, i) => (
                <div key={i} className="shop-photo-thumb" onClick={() => setLightboxPhoto(p.previewUrl)}>
                  <img src={p.previewUrl} alt={`Photo ${i + 1}`} />
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-ghost shop-retake-btn" onClick={handleRetakePhotos}>
            📷 Retake photos
          </button>
          <VerdictCard analysisResult={analysisResult} goodwillPrice={parseFloat(goodwillPrice)} />
          <SellVelocity analysisResult={analysisResult} />
          <ChatThread
            chatHistory={chatHistory}
            onUpdateHistory={handleUpdateHistory}
            itemContext={{ details, condition, goodwillPrice: parseFloat(goodwillPrice) }}
          />
        </div>
        <div className="verdict-action-bar">
          <button className="btn btn-red" onClick={handleSkip}>Skip it ✕</button>
          {isBuy && (
            <button className="btn btn-amber" onClick={handleAddToCart}>Add to cart</button>
          )}
        </div>
        {lightboxPhoto && (
          <div className="photo-lightbox-overlay" onClick={() => setLightboxPhoto(null)}>
            <img src={lightboxPhoto} className="photo-lightbox-img" alt="Full size" />
            <button className="photo-lightbox-close" onClick={() => setLightboxPhoto(null)}>✕</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="shop-form">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handlePhotoChange}
        />

        {photos.length === 0 ? (
          <div className="photo-upload-area" onClick={() => fileInputRef.current?.click()}>
            <span className="photo-upload-icon">📷</span>
            <span className="photo-upload-label">Tap to add photos</span>
          </div>
        ) : (
          <>
            <div className="shop-photo-count">{photos.length} / 3 photos</div>
            <div className="shop-photo-strip">
              {photos.map((p, i) => (
                <div key={i} className="shop-photo-thumb">
                  <img src={p.previewUrl} alt={`Photo ${i + 1}`} onClick={() => setLightboxPhoto(p.previewUrl)} />
                  <button className="shop-photo-remove" onClick={() => handleRemovePhoto(i)}>✕</button>
                </div>
              ))}
              {photos.length < 3 && (
                <div className="shop-photo-add" onClick={() => fileInputRef.current?.click()}>+</div>
              )}
            </div>
          </>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, lineHeight: 1.4 }}>
          Photos are for AI analysis only and will not be used in your eBay listing.
        </p>

        <div className="form-group">
          <label className="form-label">Item details</label>
          <textarea
            className="form-textarea"
            placeholder="Brand, model, size, color, any labels you can see..."
            value={details}
            onChange={e => setDetails(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Condition</label>
          <textarea
            className="form-textarea"
            placeholder="Working, scratched, missing parts, box included..."
            value={condition}
            onChange={e => setCondition(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Goodwill price</label>
          <div className="form-input-prefix">
            <span className="prefix">$</span>
            <input
              type="number"
              className="form-input"
              placeholder="0.00"
              min="0"
              step="0.01"
              value={goodwillPrice}
              onChange={e => setGoodwillPrice(e.target.value)}
            />
          </div>
        </div>

        <button
          className="btn btn-full"
          style={{ background: '#fff', color: '#000', fontWeight: 600 }}
          onClick={handleAnalyze}
          disabled={!goodwillPrice || parseFloat(goodwillPrice) <= 0}
        >
          Should I buy this? →
        </button>
      </div>
      {lightboxPhoto && (
        <div className="photo-lightbox-overlay" onClick={() => setLightboxPhoto(null)}>
          <img src={lightboxPhoto} className="photo-lightbox-img" alt="Full size" />
          <button className="photo-lightbox-close" onClick={() => setLightboxPhoto(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
