import { callGemini, parseJsonReply } from "./gemini.ts";

// Flags any claim in the draft CV not traceable to the source CV. Run automatically
// after every draft is written (generate + revise) so it can never be skipped.
export async function verifyDraft(sourceCv: string, draftCv: string): Promise<string[]> {
  const systemPrompt =
    "Compare DRAFT_CV against SOURCE_CV. List every factual claim in DRAFT_CV " +
    "(employer, date, title, skill, degree, certification, achievement) that is " +
    "NOT literally present in or directly derivable from SOURCE_CV. Respond as " +
    'strict JSON: {"warnings": ["...", ...]} with no other text. Empty array if none.';
  const userPrompt = `SOURCE_CV:\n${sourceCv}\n\nDRAFT_CV:\n${draftCv}`;
  const parsed = parseJsonReply(await callGemini(systemPrompt, userPrompt));
  return parsed.warnings ?? [];
}
