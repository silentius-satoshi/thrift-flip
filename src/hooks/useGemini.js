// TODO: Implement Gemini AI integration for on-device image analysis.
// Currently all AI analysis routes through the n8n webhook at analyzeItem().
export function useGemini() {
  return {
    analyze: async () => { throw new Error('useGemini not yet implemented'); },
    isReady: false,
  };
}
