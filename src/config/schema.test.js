import { describe, it, expect } from 'vitest';
import { RESPONSE_SCHEMA } from './schema';

const GEMINI_TYPES = ['OBJECT', 'STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY'];

function walk(node, visit, path = '$') {
  visit(node, path);
  for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, visit, `${path}.${key}`);
  if (node.items) walk(node.items, visit, `${path}[]`);
}

describe('RESPONSE_SCHEMA', () => {
  it('requires all six top-level blocks', () => {
    expect(RESPONSE_SCHEMA.required).toEqual([
      'identification', 'condition_read', 'listing', 'listing_mercari', 'pricing', 'strategy',
    ]);
  });

  it('uses Gemini\'s uppercase type dialect everywhere', () => {
    walk(RESPONSE_SCHEMA, (node, path) => {
      expect(GEMINI_TYPES, `${path} has type "${node.type}"`).toContain(node.type);
    });
  });

  it('never uses nullable — AI Studio rejects the schema with it', () => {
    walk(RESPONSE_SCHEMA, (node, path) => {
      expect(node, `${path} carries nullable`).not.toHaveProperty('nullable');
    });
  });

  it('declares every required key as an actual property', () => {
    walk(RESPONSE_SCHEMA, (node, path) => {
      for (const key of node.required ?? []) {
        expect(Object.keys(node.properties ?? {}), `${path}.required lists "${key}"`).toContain(key);
      }
    });
  });
});

describe('listing_mercari (V1.5)', () => {
  const block = RESPONSE_SCHEMA.properties.listing_mercari;

  it('exists as an object block', () => {
    expect(block).toBeDefined();
    expect(block.type).toBe('OBJECT');
  });

  it('carries the four fields from vision §5', () => {
    expect(Object.keys(block.properties)).toEqual(['title', 'description', 'hashtags', 'suggested_price']);
  });

  it('requires all four', () => {
    expect(block.required).toEqual(['title', 'description', 'hashtags', 'suggested_price']);
  });

  it('types hashtags as an array of strings and price as a number', () => {
    expect(block.properties.hashtags.type).toBe('ARRAY');
    expect(block.properties.hashtags.items.type).toBe('STRING');
    expect(block.properties.suggested_price.type).toBe('NUMBER');
  });

  it('carries the register rules as descriptions — the system prompt stays verbatim', () => {
    // Doc comments never reach the model; these descriptions are how the
    // constraints in vision §5 actually travel with the request.
    expect(block.properties.title.description).toMatch(/80/);
    expect(block.properties.title.description).toMatch(/casual/i);
    expect(block.properties.description.description).toMatch(/plain text/i);
    expect(block.properties.hashtags.description).toMatch(/three to five/i);
    expect(block.properties.suggested_price.description).toMatch(/9 or 5/);
  });

  it('is a distinct register, not a copy of the eBay listing', () => {
    const ebay = Object.keys(RESPONSE_SCHEMA.properties.listing.properties);
    const mercari = Object.keys(block.properties);
    // no item_specifics / condition_description on the Mercari side
    expect(mercari).not.toContain('item_specifics');
    expect(mercari).not.toContain('condition_description');
    expect(ebay).toContain('description_html');
    expect(mercari).toContain('description'); // plain text, not html
  });
});
