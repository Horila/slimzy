// Fetches Netherlands job listings from Adzuna, caches into `jobs` for the caller.
import { authedClient } from "../_shared/supabase.ts";

const ADZUNA_APP_ID = Deno.env.get("ADZUNA_APP_ID")!;
const ADZUNA_APP_KEY = Deno.env.get("ADZUNA_APP_KEY")!;
const PAGES = 2; // 50 results/page -> ~100 results/scan, stays well under 250 calls/day free tier

Deno.serve(async (req) => {
  try {
    const { supabase, user } = await authedClient(req);
    if (!user) return new Response("unauthorized", { status: 401 });

    const { keywords, location } = await req.json();
    if (!keywords) return new Response("keywords required", { status: 400 });

    const rows = [];
    for (let page = 1; page <= PAGES; page++) {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/nl/search/${page}`);
      url.searchParams.set("app_id", ADZUNA_APP_ID);
      url.searchParams.set("app_key", ADZUNA_APP_KEY);
      url.searchParams.set("what", keywords);
      if (location) url.searchParams.set("where", location);
      url.searchParams.set("results_per_page", "50");
      url.searchParams.set("content-type", "application/json");

      const res = await fetch(url);
      if (!res.ok) {
        const detail = await res.text();
        // Page 1 failing means the whole scan failed (bad keys, rate limit) -
        // surface it instead of silently reporting "0 jobs found". A later page
        // failing (e.g. transient) just means we keep whatever we already have.
        if (page === 1) return new Response(`adzuna error: ${res.status} ${detail}`, { status: 502 });
        break;
      }
      const body = await res.json();
      for (const r of body.results ?? []) {
        rows.push({
          user_id: user.id,
          source: "adzuna",
          external_id: String(r.id),
          title: r.title,
          company: r.company?.display_name ?? null,
          location: r.location?.display_name ?? null,
          description: r.description ?? null,
          url: r.redirect_url ?? null,
          salary: r.salary_min || r.salary_max
            ? `${r.salary_min ?? "?"}-${r.salary_max ?? "?"}`
            : null,
        });
      }
      if (!body.results?.length) break;
    }

    if (rows.length) {
      const { error } = await supabase.from("jobs").upsert(rows, {
        onConflict: "user_id,source,external_id",
      });
      if (error) return new Response(error.message, { status: 500 });
    }

    return Response.json({ count: rows.length });
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
});
