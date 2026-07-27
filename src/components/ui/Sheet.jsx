import { useRef, useEffect, useId } from 'react';
import './Sheet.css';

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Sheet({ open, onClose, title, className = '', children, ...rest }) {
  const touchY = useRef(null);
  const sheetRef = useRef(null);
  const openerRef = useRef(null);
  const titleId = useId();

  // Held in a ref so the effect below depends only on `open`. Consumers pass an
  // inline arrow for onClose, so depending on it would re-run the effect — and
  // therefore restore focus — on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;

    const visible = () => Array.from(sheetRef.current?.querySelectorAll(FOCUSABLE) ?? [])
      .filter(el => !el.disabled && el.offsetParent !== null);
    (visible()[0] ?? sheetRef.current)?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = visible();
      if (!els.length) { e.preventDefault(); return; }
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Restore on unmount rather than in onClose: consumers also close the
      // sheet programmatically, and those paths would otherwise strand focus
      // on document.body.
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="ui-sheet-dim" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={`ui-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        {...rest}
      >
        {/* the drag target is the grabber, not the whole sheet — otherwise any
            downward swipe across scrollable content dismisses it */}
        <div
          className="ui-sheet-grab"
          onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
          onTouchEnd={(e) => {
            if (touchY.current !== null && e.changedTouches[0].clientY - touchY.current > 80) onClose?.();
            touchY.current = null;
          }}
        >
          <div className="ui-sheet-handle" />
        </div>
        {title && <div className="ui-sheet-title" id={titleId}>{title}</div>}
        {children}
      </div>
    </>
  );
}
