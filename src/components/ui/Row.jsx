import './Row.css';

export default function Row({ thumb, title, sub, trailing, onPress, className = '', ...rest }) {
  const Tag = onPress ? 'button' : 'div';
  return (
    <Tag
      {...(onPress ? { type: 'button', onClick: onPress } : {})}
      className={`ui-row${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {thumb && <div className="ui-row-thumb">{thumb}</div>}
      <div className="ui-row-main">
        <div className="ui-row-title">{title}</div>
        {sub && <div className="ui-row-sub">{sub}</div>}
      </div>
      {trailing && <div className="ui-row-trailing">{trailing}</div>}
    </Tag>
  );
}
