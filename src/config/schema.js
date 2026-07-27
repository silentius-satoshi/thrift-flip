// Response schema from docs/v0-model-check.md §4, in Gemini's schema dialect.
// listing_mercari (vision §5) rides the same call at V1.5 — one block, no extra request.
// Its register rules live in `description` fields because the system prompt is the
// byte-verbatim prompt of record (v0 §3) and doc comments never reach the model.
// `nullable` is deliberately absent: it made AI Studio reject the schema (v0 §4 note).
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
    listing_mercari: {
      type: 'OBJECT',
      description: 'The same item written in Mercari\'s register — not a copy of the eBay listing.',
      properties: {
        title: {
          type: 'STRING',
          description: '80 characters or fewer. Casual and keyword-front, unlike the brand-first eBay title.',
        },
        description: {
          type: 'STRING',
          description: 'Plain text, no HTML. Shorter than the eBay description; first person is fine.',
        },
        hashtags: {
          type: 'ARRAY',
          description: 'Three to five hashtags, each including the leading # — e.g. "#Pendleton", "#woolblanket".',
          items: { type: 'STRING' },
        },
        suggested_price: {
          type: 'NUMBER',
          description: 'Mercari skews lower than eBay. Round to a price ending in 9 or 5.',
        },
      },
      required: ['title', 'description', 'hashtags', 'suggested_price'],
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
  required: ['identification', 'condition_read', 'listing', 'listing_mercari', 'pricing', 'strategy'],
};
