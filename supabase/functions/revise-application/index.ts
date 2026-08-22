// Revises an existing draft per a chat instruction, still constrained to the source CV.
import { authedClient, CORS_HEADERS } from "../_shared/supabase.ts";
import { callGemini, CV_FORMAT_RULE, NO_FABRICATION_RULE, parseJsonReply } from "../_shared/gemini.ts";
import { verifyDraft } from "../_shared/verify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  try {
    const { supabase, user } = await authedClient(req);
    if (!user) return new Response("unauthorized", { status: 401, headers: CORS_HEADERS });

    const { application_id, instruction } = await req.json();
    if (!application_id || !instruction) {
      return new Response("application_id and instruction required", { status: 400, headers: CORS_HEADERS });
    }

    const [{ data: cv }, { data: app }] = await Promise.all([
      supabase.from("cv").select("raw_text").eq("user_id", user.id).single(),
      supabase.from("applications").select("*").eq("id", application_id).eq("user_id", user.id)
        .single(),
    ]);
    if (!cv) return new Response("no CV uploaded yet", { status: 400, headers: CORS_HEADERS });
    if (!app) return new Response("application not found", { status: 404, headers: CORS_HEADERS });

    await supabase.from("chat_messages").insert({
      user_id: user.id,
      application_id,
      role: "user",
      content: instruction,
    });

    const lang = app.language === "nl" ? "Dutch" : "English";
    const systemPrompt =
      `You revise an existing tailored CV (as HTML) and cover letter per the user's instruction. ` +
      `${NO_FABRICATION_RULE} Keep writing in ${lang}. Preserve the existing CV_html structure and ` +
      `formatting rules unless the instruction asks to change them: ${CV_FORMAT_RULE} ` +
      `Respond as strict JSON: {"cv_html": "...", "cover_letter": "..."} with no other text.`;
    const userPrompt =
      `SOURCE_CV:\n${cv.raw_text}\n\nCURRENT CV DRAFT (HTML):\n${app.cv_draft}\n\n` +
      `CURRENT COVER LETTER DRAFT:\n${app.cover_letter_draft}\n\n` +
      `USER INSTRUCTION: ${instruction}`;

    const parsed = parseJsonReply(await callGemini(systemPrompt, userPrompt));
    const warnings = await verifyDraft(cv.raw_text, parsed.cv_html);

    const { data: updated, error } = await supabase
      .from("applications")
      .update({
        cv_draft: parsed.cv_html,
        cover_letter_draft: parsed.cover_letter,
        verify_warnings: JSON.stringify(warnings),
        updated_at: new Date().toISOString(),
      })
      .eq("id", application_id)
      .select()
      .single();
    if (error) return new Response(error.message, { status: 500, headers: CORS_HEADERS });

    await supabase.from("chat_messages").insert({
      user_id: user.id,
      application_id,
      role: "assistant",
      content: "Updated the draft per your request.",
    });

    return Response.json(updated, { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 500, headers: CORS_HEADERS });
  }
});
