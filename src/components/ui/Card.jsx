import './Card.css';

export default function Card({ flush = false, onPress, className = '', children, ...rest }) {
  const Tag = onPress ? 'button' : 'div';
  return (
    <Tag
      {...(onPress ? { type: 'button', onClick: onPress } : {})}
      className={`ui-card${flush ? ' flush' : ''}${onPress ? ' tappable' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
