import './Field.css';

export function Field({ label, hint, className = '', children, ...rest }) {
  return (
    <div className={`ui-field${className ? ` ${className}` : ''}`} {...rest}>
      {(label || hint) && (
        <div className="ui-field-head">
          {label && <span className="lbl">{label}</span>}
          {hint && <span className="ui-field-hint">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Input({ className = '', ...rest }) {
  return <input className={`ui-input${className ? ` ${className}` : ''}`} {...rest} />;
}

export function TextArea({ className = '', ...rest }) {
  return <textarea className={`ui-input ui-textarea${className ? ` ${className}` : ''}`} {...rest} />;
}
