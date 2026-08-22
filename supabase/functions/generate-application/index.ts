// Generates a tailored CV + cover letter for one job, constrained to the source CV.
import { authedClient, CORS_HEADERS } from "../_shared/supabase.ts";
import { callGemini, CV_FORMAT_RULE, NO_FABRICATION_RULE, parseJsonReply } from "../_shared/gemini.ts";
import { verifyDraft } from "../_shared/verify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  try {
    const { supabase, user } = await authedClient(req);
    if (!user) return new Response("unauthorized", { status: 401, headers: CORS_HEADERS });

    const { job_id, language } = await req.json();
    if (!job_id) return new Response("job_id required", { status: 400, headers: CORS_HEADERS });
    const lang = language === "nl" ? "Dutch" : "English";

    const [{ data: cv }, { data: job }] = await Promise.all([
      supabase.from("cv").select("raw_text").eq("user_id", user.id).single(),
      supabase.from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single(),
    ]);
    if (!cv) return new Response("no CV uploaded yet", { status: 400, headers: CORS_HEADERS });
    if (!job) return new Response("job not found", { status: 404, headers: CORS_HEADERS });

    const systemPrompt =
      `You write a tailored, print-ready CV and cover letter for a specific job. ${NO_FABRICATION_RULE} ` +
      `${CV_FORMAT_RULE} ` +
      `Write the CV and cover letter in ${lang}, regardless of the language SOURCE_CV is written in. ` +
      `Respond as strict JSON: {"cv_html": "...", "cover_letter": "..."} with no other text.`;
    const userPrompt =
      `SOURCE_CV:\n${cv.raw_text}\n\nJOB TITLE: ${job.title}\nCOMPANY: ${job.company ?? ""}\n` +
      `JOB DESCRIPTION:\n${job.description ?? ""}`;

    const parsed = parseJsonReply(await callGemini(systemPrompt, userPrompt));
    const warnings = await verifyDraft(cv.raw_text, parsed.cv_html);

    const { data: app, error } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        job_id,
        cv_draft: parsed.cv_html,
        cover_letter_draft: parsed.cover_letter,
        verify_warnings: JSON.stringify(warnings),
        language: language === "nl" ? "nl" : "en",
        status: "draft",
      })
      .select()
      .single();
    if (error) return new Response(error.message, { status: 500, headers: CORS_HEADERS });

    return Response.json(app, { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 500, headers: CORS_HEADERS });
  }
});
