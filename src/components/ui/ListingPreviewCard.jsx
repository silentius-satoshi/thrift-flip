import Card from './Card';
import './ListingPreviewCard.css';

export default function ListingPreviewCard({
  photos,
  title,
  condition,
  price,
  obo = false,
  shipping,
  soldLine,
  onSoldTap,
  struck = false,
  className = '',
  ...rest
}) {
  return (
    <Card flush className={`ui-listing-preview${struck ? ' struck' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {photos && <div className="ui-listing-preview-strip">{photos}</div>}
      <div className="ui-listing-preview-body">
        <div className="ui-listing-preview-title">{title}</div>
        {condition && <div className="ui-listing-preview-cond">{condition}</div>}
        <div className="ui-listing-preview-price money">
          {price}
          {obo && <span className="ui-listing-preview-obo"> or Best Offer</span>}
        </div>
        {shipping && <div className="ui-listing-preview-ship">{shipping}</div>}
        {soldLine && (onSoldTap ? (
          <button type="button" className="ui-listing-preview-sold" onClick={onSoldTap}>{soldLine}</button>
        ) : (
          <div className="ui-listing-preview-sold">{soldLine}</div>
        ))}
      </div>
    </Card>
  );
}
