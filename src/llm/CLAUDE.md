# src/llm

- **Reasoning must be disabled.** A thinking model spends the small `max_tokens` budget on
  reasoning and returns empty content with `finish_reason: length`. The parameter differs per
  vendor, and sending the wrong one is a 400, so `noReasoningParams()` in `client.ts`
  dispatches on the endpoint host: `reasoning: {effort}` for OpenRouter,
  `reasoning_effort` for Gemini. Add a branch rather than sending it to everyone.
- Gemini's OpenAI-compatible base URL is `https://generativelanguage.googleapis.com/v1beta/openai`
  — not `/v1beta`, not `/v1beta/interactions`.
- `client.ts` retries once on 5xx or timeout, because Gemini returns 503 under load. Gemini's
  `-lite` models hit this far less, which is why `DEFAULT_MODEL` in `providers.ts` is a `-lite` one.
