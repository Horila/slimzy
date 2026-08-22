const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// supabase-js only gives a generic "non-2xx status code" message by default -
// the function's actual error text is on error.context (the raw Response).
async function functionErrorText(error) {
  try {
    return (await error.context?.text()) || error.message;
  } catch {
    return error.message;
  }
}

let currentJob = null;
let currentApp = null;

const $ = (id) => document.getElementById(id);

// ---- auth ----

sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) loadJobs();
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  const { error } = await sb.auth.signInWithPassword({
    email: $("login-email").value,
    password: $("login-password").value,
  });
  if (error) $("login-error").textContent = error.message;
});

$("logout-btn").addEventListener("click", () => sb.auth.signOut());

// ---- tabs ----

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
});

function showTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((s) => s.hidden = s.id !== `tab-${name}`);
}

// ---- CV setup ----

$("cv-file").addEventListener("change", async () => {
  const file = $("cv-file").files[0];
  if (!file) return;
  $("cv-status").textContent = "Reading file...";
  try {
    $("cv-text").value = file.type === "application/pdf"
      ? await extractPdfText(file)
      : await file.text();
    $("cv-status").textContent = "";
  } catch (e) {
    $("cv-status").textContent = `Couldn't read file: ${e?.message ?? e}`;
  }
});

async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return text.trim();
}

$("save-cv-btn").addEventListener("click", async () => {
  const rawText = $("cv-text").value.trim();
  if (!rawText) { $("cv-status").textContent = "Paste or upload a CV first."; return; }
  $("cv-status").textContent = "Saving...";

  const { data: { user } } = await sb.auth.getUser();
  const file = $("cv-file").files[0];
  const filename = file ? file.name : "cv.txt";

  if (file) {
    const { error: uploadError } = await sb.storage
      .from("cvs")
      .upload(`${user.id}/${filename}`, file, { upsert: true });
    if (uploadError) { $("cv-status").textContent = `File upload failed: ${uploadError.message}`; return; }
  }

  const { error } = await sb.from("cv").upsert({
    user_id: user.id,
    filename,
    raw_text: rawText,
    updated_at: new Date().toISOString(),
  });
  $("cv-status").textContent = error ? error.message : "Saved.";
});

$("scan-jobs-btn").addEventListener("click", async () => {
  const keywords = $("job-keywords").value.trim();
  if (!keywords) { $("scan-status").textContent = "Enter keywords first."; return; }
  $("scan-status").textContent = "Scanning...";
  const { data, error } = await sb.functions.invoke("search-jobs", {
    body: {
      keywords,
      location: $("job-location").value.trim() || undefined,
      radius_km: Number($("job-radius").value),
    },
  });
  $("scan-status").textContent = error ? await functionErrorText(error) : `Found ${data.count} jobs.`;
  await loadJobs(error ? null : data.scanned_at);
  showTab("jobs");
});

// ---- jobs ----

async function loadJobs(sinceScan) {
  let query = sb.from("jobs").select("*").order("fetched_at", { ascending: false });
  if (sinceScan) query = query.gte("fetched_at", sinceScan);
  const { data: jobs, error } = await query;
  const list = $("jobs-list");
  list.innerHTML = "";
  if (error || !jobs?.length) {
    list.textContent = "No jobs yet — scan for jobs in the Setup tab.";
    return;
  }
  for (const job of jobs) {
    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = `
      <h3>${escapeHtml(job.title)}</h3>
      <p>${escapeHtml(job.company ?? "")} — ${escapeHtml(job.location ?? "")}</p>
      <p>${escapeHtml((job.description ?? "").slice(0, 200))}...</p>
      <a href="${escapeHtml(safeUrl(job.url))}" target="_blank" rel="noopener">View listing</a>
      <button data-job-id="${job.id}">Generate application</button>
    `;
    card.querySelector("button").addEventListener("click", () => generateApplication(job));
    list.appendChild(card);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Only allow http(s) links from job listing data — blocks javascript: etc.
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : "#";
  } catch {
    return "#";
  }
}

// ---- draft ----

async function generateApplication(job) {
  currentJob = job;
  $("draft-job-title").textContent = `${job.title} — ${job.company ?? ""}`;
  $("draft-cv").textContent = "Generating...";
  $("draft-cover").textContent = "";
  $("draft-warnings").textContent = "";
  showTab("draft");

  const { data: app, error } = await sb.functions.invoke("generate-application", {
    body: { job_id: job.id, language: $("draft-language").value },
  });
  if (error) { $("draft-cv").textContent = `Error: ${await functionErrorText(error)}`; return; }
  currentApp = app;
  renderDraft();
  loadChat();
}

function renderDraft() {
  // The CV is Gemini-generated HTML (headings/lists/etc for a print-ready layout), scoped to
  // this one logged-in user's own content - safe to render, but strip <script> defensively.
  $("draft-cv").innerHTML = (currentApp.cv_draft ?? "").replace(/<script[\s\S]*?<\/script>/gi, "");
  $("draft-cover").textContent = currentApp.cover_letter_draft;
  const warnings = currentApp.verify_warnings ? JSON.parse(currentApp.verify_warnings) : [];
  $("draft-warnings").textContent = warnings.length
    ? "Possible unsupported claims — please check: " + warnings.join("; ")
    : "";
}

$("approve-btn").addEventListener("click", async () => {
  if (!currentApp) return;
  await sb.from("applications").update({ status: "approved" }).eq("id", currentApp.id);
  currentApp.status = "approved";
  alert("Marked approved.");
});

// Print only the one document (not the whole app page) by opening it alone in a
// new tab with its own minimal stylesheet, then invoking the browser's print/save-as-PDF.
function printDocument(title, bodyHtml) {
  const win = window.open("", "_blank");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.4; max-width: 800px;
         margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.8rem; margin: 0 0 0.15rem; }
  h2 { font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.04em;
       border-bottom: 1px solid #999; margin: 1.1rem 0 0.4rem; padding-bottom: 0.15rem; }
  p { margin: 0.3rem 0; font-size: 0.95rem; }
  ul { margin: 0.2rem 0 0.6rem; padding-left: 1.2rem; }
  li { font-size: 0.95rem; margin: 0.15rem 0; }
  strong { font-size: 1rem; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 0.95rem; }
  @page { margin: 1.5cm; }
</style></head><body>${bodyHtml}</body></html>`);
  win.document.close();
  win.onload = () => win.print();
}

$("download-cv-btn").addEventListener("click", () => {
  if (!currentApp) return;
  printDocument(`CV — ${currentJob?.title ?? ""}`, currentApp.cv_draft ?? "");
});

$("download-cover-btn").addEventListener("click", () => {
  if (!currentApp) return;
  printDocument(
    `Cover letter — ${currentJob?.title ?? ""}`,
    `<pre>${escapeHtml(currentApp.cover_letter_draft ?? "")}</pre>`,
  );
});

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentApp) return;
  const instruction = $("chat-input").value.trim();
  if (!instruction) return;
  $("chat-input").value = "";
  appendChat("user", instruction);

  const { data: updated, error } = await sb.functions.invoke("revise-application", {
    body: { application_id: currentApp.id, instruction },
  });
  if (error) { appendChat("assistant", `Error: ${await functionErrorText(error)}`); return; }
  currentApp = updated;
  renderDraft();
  appendChat("assistant", "Updated the draft above.");
});

async function loadChat() {
  $("chat-log").innerHTML = "";
  const { data: messages } = await sb
    .from("chat_messages")
    .select("*")
    .eq("application_id", currentApp.id)
    .order("created_at", { ascending: true });
  for (const m of messages ?? []) appendChat(m.role, m.content);
}

function appendChat(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = `${role === "user" ? "You" : "Agent"}: ${content}`;
  $("chat-log").appendChild(div);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
}
