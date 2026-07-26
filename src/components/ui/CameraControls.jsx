import './CameraControls.css';

export function Shutter({ className = '', ...rest }) {
  return (
    <button type="button" className={`ui-shutter${className ? ` ${className}` : ''}`} {...rest}>
      <i />
    </button>
  );
}

export function CamSide({ className = '', children, ...rest }) {
  return (
    <button type="button" className={`ui-camside${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}

export function PhotoRemoveDot({ className = '', ...rest }) {
  return (
    <button type="button" aria-label="Remove photo" className={`ui-photo-remove${className ? ` ${className}` : ''}`} {...rest}>
      ✕
    </button>
  );
}
