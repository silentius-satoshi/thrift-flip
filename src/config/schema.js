// Response schema from docs/v0-model-check.md §4, in Gemini's schema dialect.
// listing_mercari (vision §5) is deliberately absent — V1.5 concern, extra output tokens.
// `nullable` is deliberately absent too: it made AI Studio reject the schema (v0 §4 note).
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    identification: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        brand: { type: 'STRING' },
        model: { type: 'STRING' },
        era: { type: 'STRING' },
        category_path: { type: 'STRING' },
        confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        clarifying_question: { type: 'STRING' },
      },
      required: ['name', 'category_path', 'confidence'],
    },
    condition_read: {
      type: 'OBJECT',
      properties: {
        grade: {
          type: 'STRING',
          enum: ['New', 'Like New', 'Good', 'Acceptable', 'For Parts'],
        },
        visible_flaws: { type: 'ARRAY', items: { type: 'STRING' } },
        notes_conflicts: { type: 'STRING' },
      },
      required: ['grade', 'visible_flaws'],
    },
    listing: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        description_html: { type: 'STRING' },
        item_specifics: {
          type: 'OBJECT',
          properties: {
            Brand: { type: 'STRING' },
            Size: { type: 'STRING' },
            Color: { type: 'STRING' },
            Material: { type: 'STRING' },
            MPN: { type: 'STRING' },
          },
        },
        condition_description: { type: 'STRING' },
      },
      required: ['title', 'description_html', 'item_specifics', 'condition_description'],
    },
    pricing: {
      type: 'OBJECT',
      properties: {
        estimate: { type: 'NUMBER' },
        range_low: { type: 'NUMBER' },
        range_high: { type: 'NUMBER' },
        confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        rationale: { type: 'STRING' },
      },
      required: ['estimate', 'range_low', 'range_high', 'confidence', 'rationale'],
    },
    strategy: {
      type: 'OBJECT',
      properties: {
        platform: { type: 'STRING', enum: ['eBay', 'Mercari', 'FB Marketplace'] },
        format: { type: 'STRING', enum: ['fixed', 'auction'] },
        rarity_flag: { type: 'BOOLEAN' },
        timing_note: { type: 'STRING' },
      },
      required: ['platform', 'format', 'rarity_flag', 'timing_note'],
    },
  },
  required: ['identification', 'condition_read', 'listing', 'pricing', 'strategy'],
};
