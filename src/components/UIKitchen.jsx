import { useState } from 'react';
import Button from './ui/Button';
import Chip from './ui/Chip';
import StatusTag from './ui/StatusTag';
import Card from './ui/Card';
import { Panel, PanelRow, PanelTotal } from './ui/Panel';
import VerdictBanner from './ui/VerdictBanner';
import ListingPreviewCard from './ui/ListingPreviewCard';
import Sheet from './ui/Sheet';
import Row from './ui/Row';
import { Field, Input, TextArea } from './ui/Field';
import { StatGrid, Stat } from './ui/StatGrid';
import ActionBar from './ui/ActionBar';
import FourDotMark from './ui/FourDotMark';
import { Shutter, CamSide, PhotoRemoveDot } from './ui/CameraControls';
import './UIKitchen.css';

const grad = (a, b) => ({ background: `linear-gradient(135deg, ${a}, ${b})` });

export default function UIKitchen() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [condition, setCondition] = useState('Excellent');

  return (
    <div className="screen uikitchen">
      <div className="uikitchen-header">
        <FourDotMark />
        <h1 className="uikitchen-title">UI Kitchen</h1>
      </div>

      <section>
        <div className="lbl">Buttons</div>
        <div className="uikitchen-cluster">
          <Button>List it</Button>
          <Button variant="outline">Save draft</Button>
          <Button variant="danger">Remove</Button>
        </div>
        <div className="uikitchen-cluster">
          <Button size="sm">List it</Button>
          <Button size="sm" variant="outline">Save draft</Button>
          <Button size="sm" variant="danger">Remove</Button>
        </div>
        <Button full>Add to cart — $8.00</Button>
        <Button full disabled>Generating listing…</Button>
      </section>

      <section>
        <div className="lbl">Chips</div>
        <div className="uikitchen-cluster">
          {['Like New', 'Excellent', 'Good', 'Fair'].map((c) => (
            <Chip key={c} selected={condition === c} onPress={() => setCondition(c)}>{c}</Chip>
          ))}
        </div>
      </section>

      <section>
        <div className="lbl">Status tags</div>
        <div className="uikitchen-cluster">
          <StatusTag tone="green">PROFIT</StatusTag>
          <StatusTag tone="red">SOLD</StatusTag>
          <StatusTag tone="yellow">PENDING</StatusTag>
          <StatusTag tone="blue">ACTIVE</StatusTag>
          <StatusTag tone="mute">DRAFT</StatusTag>
        </div>
      </section>

      <section>
        <div className="lbl">Card</div>
        <Card>Found at Goodwill on 7th — tag says $8.00, comps say otherwise.</Card>
      </section>

      <section>
        <div className="lbl">Earnings panel</div>
        <Panel title="Your earnings">
          <PanelRow label="Item price" value="$94.50" onValueTap={() => setSheetOpen(true)} />
          <PanelRow label="Selling costs" value="−$12.82" />
          <PanelRow label="Shipping" value="−$12.00" />
          <PanelRow label="Paid at Goodwill" value="−$8.00" />
          <PanelTotal label="You'd keep" value="$61.68" tone="green" />
        </Panel>
      </section>

      <section>
        <div className="lbl">Verdict banners</div>
        <div className="uikitchen-stack">
          <VerdictBanner verdict="go" label="BUY IT" detail="keeps $61.68" />
          <VerdictBanner verdict="skip" label="SKIP" detail="resells under $10" />
          <VerdictBanner verdict="pencil" label="PENCIL IT" detail="thin margin — check comps" />
        </div>
      </section>

      <section>
        <div className="lbl">Listing preview</div>
        <div className="uikitchen-stack">
          <ListingPreviewCard
            photos={[
              <div key="1" style={grad('#3E4A2B', '#86B817')} />,
              <div key="2" style={grad('#2B3A4A', '#3665F3')} />,
              <div key="3" style={grad('#4A3A2B', '#F5AF02')} />,
            ]}
            title="Patagonia Better Sweater Fleece Jacket Men's Medium Heather Gray"
            condition="Pre-owned · Excellent"
            price="$58.00"
            obo
            shipping="Free shipping"
            soldLine="12 sold in the last 30 days"
            onSoldTap={() => setSheetOpen(true)}
          />
          <ListingPreviewCard
            photos={[<div key="1" style={grad('#4A2B2B', '#E9403B')} />]}
            title="Faded Glory Graphic Tee Bundle (3)"
            condition="Pre-owned · Good"
            price="$14.00"
            shipping="+ $5.25 shipping"
            soldLine="0 sold in the last 30 days"
            struck
          />
        </div>
      </section>

      <section>
        <div className="lbl">Sheet</div>
        <Button variant="outline" onClick={() => setSheetOpen(true)}>Open sheet</Button>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Sold comps">
          <Row
            thumb={<div className="uikitchen-thumb" style={grad('#3E4A2B', '#86B817')} />}
            title="Patagonia Better Sweater M"
            sub="Sold Jul 18 · $62.00"
            trailing={<StatusTag tone="green">+$54</StatusTag>}
          />
          <Row
            thumb={<div className="uikitchen-thumb" style={grad('#2B3A4A', '#3665F3')} />}
            title="Patagonia Better Sweater L"
            sub="Sold Jul 12 · $55.00"
            trailing={<StatusTag tone="green">+$47</StatusTag>}
          />
        </Sheet>
      </section>

      <section>
        <div className="lbl">Rows</div>
        <Card>
          <Row
            thumb={<div className="uikitchen-thumb" style={grad('#3E4A2B', '#86B817')} />}
            title="Patagonia Better Sweater Fleece"
            sub="Listed Jul 20 · $58.00"
            trailing={<StatusTag tone="blue">ACTIVE</StatusTag>}
            onPress={() => {}}
          />
          <Row
            thumb={<div className="uikitchen-thumb" style={grad('#4A3A2B', '#F5AF02')} />}
            title="Carhartt Detroit Jacket L"
            sub="Draft · $85.00"
            trailing={<StatusTag tone="mute">DRAFT</StatusTag>}
            onPress={() => {}}
          />
          <Row
            thumb={<div className="uikitchen-thumb" style={grad('#4A2B2B', '#E9403B')} />}
            title="Levi's 501 32×30"
            sub="Sold Jul 15 · $34.00"
            trailing={<StatusTag tone="red">SOLD</StatusTag>}
          />
        </Card>
      </section>

      <section>
        <div className="lbl">Fields</div>
        <div className="uikitchen-stack">
          <Field label="Title" hint="62/80">
            <Input defaultValue="Patagonia Better Sweater Fleece Jacket Men's Medium" />
          </Field>
          <Field label="Description">
            <TextArea defaultValue="Excellent pre-owned condition. No pilling, zipper smooth. From a smoke-free home." />
          </Field>
        </div>
      </section>

      <section>
        <div className="lbl">Stats</div>
        <StatGrid>
          <Stat value="$1,284" label="TOTAL PROFIT" tone="green" />
          <Stat value="23" label="ITEMS SOLD" />
          <Stat value="$55.83" label="AVG SALE" />
          <Stat value="4.2d" label="AVG TIME TO SELL" />
        </StatGrid>
      </section>

      <section>
        <div className="lbl">Camera controls</div>
        <div className="uikitchen-cluster uikitchen-cam">
          <CamSide aria-label="Last photo">
            <div style={{ ...grad('#3E4A2B', '#86B817'), width: '100%', height: '100%' }} />
          </CamSide>
          <Shutter aria-label="Take photo" />
          <CamSide aria-label="Selling">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 15l4-4 3 3 5-6" />
            </svg>
          </CamSide>
          <div className="uikitchen-thumb" style={{ ...grad('#2B3A4A', '#3665F3'), position: 'relative' }}>
            <PhotoRemoveDot style={{ position: 'absolute', top: 3, right: 3 }} />
          </div>
        </div>
      </section>

      <section>
        <div className="lbl">Four-dot mark</div>
        <FourDotMark />
      </section>

      <ActionBar>
        <Button variant="outline">Save draft</Button>
        <Button>List it</Button>
      </ActionBar>
    </div>
  );
}
