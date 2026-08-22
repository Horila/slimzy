// Revises an existing draft per a chat instruction, still constrained to the source CV.
import { authedClient } from "../_shared/supabase.ts";
import { callGemini, NO_FABRICATION_RULE, parseJsonReply } from "../_shared/gemini.ts";
import { verifyDraft } from "../_shared/verify.ts";

Deno.serve(async (req) => {
  try {
    const { supabase, user } = await authedClient(req);
    if (!user) return new Response("unauthorized", { status: 401 });

    const { application_id, instruction } = await req.json();
    if (!application_id || !instruction) {
      return new Response("application_id and instruction required", { status: 400 });
    }

    const [{ data: cv }, { data: app }] = await Promise.all([
      supabase.from("cv").select("raw_text").eq("user_id", user.id).single(),
      supabase.from("applications").select("*").eq("id", application_id).eq("user_id", user.id)
        .single(),
    ]);
    if (!cv) return new Response("no CV uploaded yet", { status: 400 });
    if (!app) return new Response("application not found", { status: 404 });

    await supabase.from("chat_messages").insert({
      user_id: user.id,
      application_id,
      role: "user",
      content: instruction,
    });

    const systemPrompt =
      `You revise an existing tailored CV and cover letter per the user's instruction. ` +
      `${NO_FABRICATION_RULE} ` +
      `Respond as strict JSON: {"cv": "...", "cover_letter": "..."} with no other text.`;
    const userPrompt =
      `SOURCE_CV:\n${cv.raw_text}\n\nCURRENT CV DRAFT:\n${app.cv_draft}\n\n` +
      `CURRENT COVER LETTER DRAFT:\n${app.cover_letter_draft}\n\n` +
      `USER INSTRUCTION: ${instruction}`;

    const parsed = parseJsonReply(await callGemini(systemPrompt, userPrompt));
    const warnings = await verifyDraft(cv.raw_text, parsed.cv);

    const { data: updated, error } = await supabase
      .from("applications")
      .update({
        cv_draft: parsed.cv,
        cover_letter_draft: parsed.cover_letter,
        verify_warnings: JSON.stringify(warnings),
        updated_at: new Date().toISOString(),
      })
      .eq("id", application_id)
      .select()
      .single();
    if (error) return new Response(error.message, { status: 500 });

    await supabase.from("chat_messages").insert({
      user_id: user.id,
      application_id,
      role: "assistant",
      content: "Updated the draft per your request.",
    });

    return Response.json(updated);
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
});
