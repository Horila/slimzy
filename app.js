const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentJob = null;
let currentApp = null;

const $ = (id) => document.getElementById(id);

// ---- auth ----

supabase.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) loadJobs();
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  const { error } = await supabase.auth.signInWithPassword({
    email: $("login-email").value,
    password: $("login-password").value,
  });
  if (error) $("login-error").textContent = error.message;
});

$("logout-btn").addEventListener("click", () => supabase.auth.signOut());

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
  if (file.type === "application/pdf") {
    $("cv-text").value = await extractPdfText(file);
  } else {
    $("cv-text").value = await file.text();
  }
});

async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.js";
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

  const { data: { user } } = await supabase.auth.getUser();
  const file = $("cv-file").files[0];
  const filename = file ? file.name : "cv.txt";

  if (file) {
    const { error: uploadError } = await supabase.storage
      .from("cvs")
      .upload(`${user.id}/${filename}`, file, { upsert: true });
    if (uploadError) { $("cv-status").textContent = `File upload failed: ${uploadError.message}`; return; }
  }

  const { error } = await supabase.from("cv").upsert({
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
  const { data, error } = await supabase.functions.invoke("search-jobs", {
    body: { keywords, location: $("job-location").value.trim() || undefined },
  });
  $("scan-status").textContent = error ? error.message : `Found ${data.count} jobs.`;
  await loadJobs();
  showTab("jobs");
});

// ---- jobs ----

async function loadJobs() {
  const { data: jobs, error } = await supabase.from("jobs").select("*").order("fetched_at", { ascending: false });
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

  const { data: app, error } = await supabase.functions.invoke("generate-application", {
    body: { job_id: job.id },
  });
  if (error) { $("draft-cv").textContent = `Error: ${error.message}`; return; }
  currentApp = app;
  renderDraft();
  loadChat();
}

function renderDraft() {
  $("draft-cv").textContent = currentApp.cv_draft;
  $("draft-cover").textContent = currentApp.cover_letter_draft;
  const warnings = currentApp.verify_warnings ? JSON.parse(currentApp.verify_warnings) : [];
  $("draft-warnings").textContent = warnings.length
    ? "Possible unsupported claims — please check: " + warnings.join("; ")
    : "";
}

$("approve-btn").addEventListener("click", async () => {
  if (!currentApp) return;
  await supabase.from("applications").update({ status: "approved" }).eq("id", currentApp.id);
  currentApp.status = "approved";
  alert("Marked approved.");
});

$("print-btn").addEventListener("click", () => window.print());

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentApp) return;
  const instruction = $("chat-input").value.trim();
  if (!instruction) return;
  $("chat-input").value = "";
  appendChat("user", instruction);

  const { data: updated, error } = await supabase.functions.invoke("revise-application", {
    body: { application_id: currentApp.id, instruction },
  });
  if (error) { appendChat("assistant", `Error: ${error.message}`); return; }
  currentApp = updated;
  renderDraft();
  appendChat("assistant", "Updated the draft above.");
});

async function loadChat() {
  $("chat-log").innerHTML = "";
  const { data: messages } = await supabase
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
