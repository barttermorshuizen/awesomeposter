const DEFAULT_MODEL_FALLBACK = "gpt-4o";
function getDefaultModelName() {
  const m = process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL_FALLBACK;
  return m.trim();
}

export { getDefaultModelName as g };
//# sourceMappingURL=model.mjs.map
