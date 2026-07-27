import './Select.css';

// Wraps a native <select> rather than reimplementing one: the platform picker,
// combobox semantics and keyboard type-ahead are all worth more than a custom
// menu. The wrapper only supplies the chevron.
export default function Select({ options = [], className = '', ...rest }) {
  return (
    <span className={`ui-select-wrap${className ? ` ${className}` : ''}`}>
      <select className="ui-select" {...rest}>
        {options.map(o => (
          typeof o === 'string'
            ? <option key={o} value={o}>{o}</option>
            : <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg className="ui-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}
