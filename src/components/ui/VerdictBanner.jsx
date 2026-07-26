import './VerdictBanner.css';

export default function VerdictBanner({ verdict = 'go', label, detail, className = '', ...rest }) {
  return (
    <div className={`ui-verdict ui-verdict-${verdict}${className ? ` ${className}` : ''}`} {...rest}>
      <span className="ui-verdict-label">{label}</span>
      {detail && <span className="ui-verdict-detail">{detail}</span>}
    </div>
  );
}
