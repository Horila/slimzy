// Generates a tailored CV + cover letter for one job, constrained to the source CV.
import { authedClient } from "../_shared/supabase.ts";
import { callGemini, NO_FABRICATION_RULE, parseJsonReply } from "../_shared/gemini.ts";
import { verifyDraft } from "../_shared/verify.ts";

Deno.serve(async (req) => {
  try {
    const { supabase, user } = await authedClient(req);
    if (!user) return new Response("unauthorized", { status: 401 });

    const { job_id } = await req.json();
    if (!job_id) return new Response("job_id required", { status: 400 });

    const [{ data: cv }, { data: job }] = await Promise.all([
      supabase.from("cv").select("raw_text").eq("user_id", user.id).single(),
      supabase.from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single(),
    ]);
    if (!cv) return new Response("no CV uploaded yet", { status: 400 });
    if (!job) return new Response("job not found", { status: 404 });

    const systemPrompt =
      `You write a tailored CV and cover letter for a specific job. ${NO_FABRICATION_RULE} ` +
      `Respond as strict JSON: {"cv": "...", "cover_letter": "..."} with no other text.`;
    const userPrompt =
      `SOURCE_CV:\n${cv.raw_text}\n\nJOB TITLE: ${job.title}\nCOMPANY: ${job.company ?? ""}\n` +
      `JOB DESCRIPTION:\n${job.description ?? ""}`;

    const parsed = parseJsonReply(await callGemini(systemPrompt, userPrompt));
    const warnings = await verifyDraft(cv.raw_text, parsed.cv);

    const { data: app, error } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        job_id,
        cv_draft: parsed.cv,
        cover_letter_draft: parsed.cover_letter,
        verify_warnings: JSON.stringify(warnings),
        status: "draft",
      })
      .select()
      .single();
    if (error) return new Response(error.message, { status: 500 });

    return Response.json(app);
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
});
