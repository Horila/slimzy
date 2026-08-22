const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MODEL = "gemini-3.6-flash"; // gemini-2.5-flash was retired for new API keys

export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 65536,
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini error: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const candidate = body.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new Error("gemini reply was cut off (hit max output tokens)");
    }
    throw new Error(`gemini returned no content: ${JSON.stringify(body)}`);
  }
  return text;
}

// Gemini is asked for raw JSON via responseMimeType, but still strip markdown
// fences as a fallback and surface a clear error instead of a raw parse crash.
export function parseJsonReply(raw: string): any {
  try {
    return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim());
  } catch {
    throw new Error(`gemini reply was not valid JSON: ${raw.slice(0, 300)}`);
  }
}

export const NO_FABRICATION_RULE =
  "You may only use facts (employers, dates, job titles, skills, education, " +
  "achievements) that appear explicitly in SOURCE_CV below. Rewrite, reorder, " +
  "rephrase, and select the most relevant parts for the target job, but never " +
  "invent, infer, embellish, or add any employer, date, title, skill, degree, " +
  "certification, or achievement not literally present in SOURCE_CV. If the CV " +
  "lacks something the job wants, omit it rather than inventing it.";
