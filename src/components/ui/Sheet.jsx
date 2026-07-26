import { useRef } from 'react';
import './Sheet.css';

export default function Sheet({ open, onClose, title, className = '', children, ...rest }) {
  const touchY = useRef(null);
  if (!open) return null;
  return (
    <>
      <div className="ui-sheet-dim" onClick={onClose} />
      <div
        className={`ui-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => {
          if (touchY.current !== null && e.changedTouches[0].clientY - touchY.current > 80) onClose?.();
          touchY.current = null;
        }}
        {...rest}
      >
        <div className="ui-sheet-handle" />
        {title && <div className="ui-sheet-title">{title}</div>}
        {children}
      </div>
    </>
  );
}
