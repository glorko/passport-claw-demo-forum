function defaultApiBase() {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://127.0.0.1:19080";
}
const API_BASE = defaultApiBase();

const PAGE_SIZE = 10;

/** @type {{ offset: number, q: string }} */
const feedState = { offset: 0, q: "" };

document.getElementById("api-base").textContent = API_BASE;

const fetchOpts = {
  credentials: "include",
};

function postsListUrl() {
  const u = new URL(`${API_BASE}/api/posts`);
  u.searchParams.set("limit", String(PAGE_SIZE));
  u.searchParams.set("offset", String(feedState.offset));
  const q = feedState.q.trim();
  if (q) u.searchParams.set("q", q);
  return u.toString();
}

/**
 * Accepts current API `{ posts, total, limit, offset }` or legacy bare array / partial objects.
 * @param {unknown} data
 * @returns {{ posts: Array<{ id: string, body: string, created_at: string }>, total: number, limit: number, offset: number }}
 */
function normalizePostListResponse(data) {
  let posts;
  if (Array.isArray(data)) {
    posts = data;
  } else if (data && typeof data === "object" && Array.isArray(data.posts)) {
    posts = data.posts;
  } else {
    posts = [];
  }

  const raw = data && typeof data === "object" && !Array.isArray(data) ? data : null;

  const limit =
    raw && typeof raw.limit === "number" && Number.isFinite(raw.limit) && raw.limit > 0
      ? raw.limit
      : PAGE_SIZE;

  const offset =
    raw && typeof raw.offset === "number" && Number.isFinite(raw.offset) && raw.offset >= 0
      ? raw.offset
      : feedState.offset;

  let total =
    raw && typeof raw.total === "number" && Number.isFinite(raw.total) && raw.total >= 0
      ? raw.total
      : posts.length;

  return { posts, total, limit, offset };
}

/**
 * @param {{ id: string, body: string, created_at: string }} p
 */
function articleEl(p) {
  const art = document.createElement("article");
  art.className = "post-article";

  const head = document.createElement("div");
  head.className = "post-article-head";

  const idSpan = document.createElement("span");
  idSpan.className = "post-id";
  idSpan.textContent = `#${p.id}`;

  const timeEl = document.createElement("time");
  timeEl.dateTime = p.created_at;
  timeEl.textContent = new Date(p.created_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  head.appendChild(idSpan);
  head.appendChild(timeEl);

  const body = document.createElement("p");
  body.className = "post-body";
  body.textContent = p.body;

  art.appendChild(head);
  art.appendChild(body);
  return art;
}

function renderFeed(data) {
  const container = document.getElementById("feed-articles");
  const meta = document.getElementById("feed-meta");
  const nav = document.getElementById("feed-pagination");

  const { posts, total, limit, offset } = normalizePostListResponse(data);
  container.setAttribute("aria-busy", "false");
  container.classList.remove("feed-loading");

  container.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "feed-empty";
    const hasQuery = feedState.q.trim().length > 0;
    if (total === 0) {
      empty.textContent = hasQuery
        ? "No posts match your search. Try different keywords."
        : "No posts yet. Be the first to write something.";
    } else {
      empty.textContent = "No posts match your search. Try different keywords.";
    }
    container.appendChild(empty);
  } else {
    for (const p of posts) {
      container.appendChild(articleEl(p));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pageNum = Math.floor(offset / limit) + 1;
  if (total === 0) {
    meta.textContent = "0 posts";
  } else {
    meta.textContent = `${total} post${total === 1 ? "" : "s"} · page ${pageNum} of ${totalPages}`;
  }

  nav.replaceChildren();
  if (total === 0) return;

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "btn-secondary";
  prev.textContent = "Previous";
  prev.disabled = offset <= 0;
  prev.addEventListener("click", () => {
    feedState.offset = Math.max(0, offset - limit);
    refresh();
  });

  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn-secondary";
  next.textContent = "Next";
  next.disabled = offset + posts.length >= total;
  next.addEventListener("click", () => {
    feedState.offset = offset + limit;
    refresh();
  });

  nav.appendChild(prev);
  nav.appendChild(next);
}

async function refresh() {
  const container = document.getElementById("feed-articles");
  container.setAttribute("aria-busy", "true");
  container.classList.add("feed-loading");
  try {
    const r = await fetch(postsListUrl(), fetchOpts);
    const text = await r.text();
    if (!r.ok) {
      throw new Error(`${r.status} ${text.slice(0, 300)}`);
    }
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`Response is not JSON: ${text.slice(0, 200)}`);
    }
    renderFeed(j);
  } catch (e) {
    container.setAttribute("aria-busy", "false");
    container.classList.remove("feed-loading");
    container.replaceChildren();
    const err = document.createElement("p");
    err.className = "feed-error";
    err.textContent = String(e);
    container.appendChild(err);
    document.getElementById("feed-meta").textContent = "";
    document.getElementById("feed-pagination").replaceChildren();
  }
}

document.getElementById("feed-search-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  feedState.q = document.getElementById("search-q").value;
  feedState.offset = 0;
  refresh();
});

async function reportAgentHint() {
  const st = document.getElementById("agent-hint-status");
  try {
    const r = await fetch(`${API_BASE}/api/agent-hint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navigator_webdriver: navigator.webdriver === true }),
      ...fetchOpts,
    });
    const j = await r.json();
    st.textContent = `${r.status} · webdriver=${navigator.webdriver} · ${JSON.stringify(j)}`;
    st.classList.add("ok");
  } catch (e) {
    st.textContent = String(e);
  }
}

window.onBotVerified = async function onBotVerified(token) {
  const el = document.getElementById("rc-status");
  try {
    const r = await fetch(`${API_BASE}/api/reverse-captcha-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token != null ? String(token) : "" }),
      ...fetchOpts,
    });
    const j = await r.json();
    el.textContent = `${r.status} ${JSON.stringify(j)}`;
    el.classList.add("ok");
  } catch (e) {
    el.textContent = String(e);
  }
};

document.getElementById("send").addEventListener("click", async () => {
  const body = document.getElementById("body").value;
  const st = document.getElementById("status");
  st.textContent = "…";
  try {
    const r = await fetch(`${API_BASE}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
      ...fetchOpts,
    });
    const t = await r.text();
    st.textContent = `${r.status} ${t.slice(0, 500)}`;
    await refresh();
  } catch (e) {
    st.textContent = String(e);
  }
});

document.getElementById("search-q").value = feedState.q;
reportAgentHint();
refresh();
