(() => {
const { $, esc } = DZ, B = window.DZB, T = (k, v) => DZ.T(k, v);
const PAGE = 20, WAIT = { post: 15000, cmt: 4000 };
let route = { type: "home" }, sort = "latest", posts = [], hasMore = false, offset = 0, comments = [], single = null;
let postBoard = "lounge", last = { post: 0, cmt: 0 }, tagsCache = null, loadSeq = 0;

/* ---------- 유틸 ---------- */
const URL_RE = /(https?:\/\/[^\s<]+)/g;
const TAG_RE = /(^|[\s>(])#([\p{L}\p{N}_]{2,30})/gu;
const YT_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|shorts\/|embed\/))([\w-]{11})/;
function rich(s) {
  return esc(s).split(URL_RE).map((part, i) => {
    if (i % 2) { const m = part.match(/[.,!?)\]]+$/), tail = m ? m[0] : "", u = tail ? part.slice(0, -tail.length) : part; return `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow ugc">${u}</a>${tail}`; }
    return part.replace(TAG_RE, (m, pre, t) => `${pre}<a class="tag" href="#/t/${encodeURIComponent(t)}">#${t}</a>`);
  }).join("").replace(/\n/g, "<br>");
}
const ytId = s => { const m = (s || "").match(YT_RE); return m && m[1]; };
const hue = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = n => `<span class="av" style="--h:${hue(n)}" aria-hidden="true">${esc((n || "?")[0].toUpperCase())}</span>`;
const userLink = n => `<a class="who" href="#/u/${encodeURIComponent(n)}">@${esc(n)}</a>`;
const deriveTitle = body => { const l = body.trim().split("\n")[0].trim(); return (l.length > 60 ? l.slice(0, 59) + "…" : l) || "(untitled)"; };
const showTitle = p => { const t = (p.title || "").replace(/…$/, ""); return t && !p.body.trim().startsWith(t); };
const cooldown = k => { if (Date.now() - last[k] < WAIT[k]) { DZ.toast(T("err.cooldown")); return false; } return true; };
const boardName = b => T("board." + b);

/* ---------- 라우팅 ---------- */
function parse() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")), [k, ...r] = h.split("/"), v = r.join("/");
  if (k === "b" && B.BOARDS.includes(v)) return { type: "board", board: v };
  if (k === "p" && +v) return { type: "post", id: +v };
  if (k === "u" && v) return { type: "user", user: v };
  if (k === "t" && v) return { type: "search", q: "#" + v, tag: v };
  if (k === "q" && v) return { type: "search", q: v };
  return { type: "home" };
}
const go = h => { if (location.hash === h) onRoute(); else location.hash = h; };

/* ---------- 왼쪽 카테고리 ---------- */
function renderNav() {
  const item = (href, label, on, ic) => `<a href="${href}" class="${on ? "on" : ""}"${on ? ' aria-current="page"' : ""}><span class="ic">${ic}</span>${esc(label)}</a>`;
  const ICON = { lounge: "💬", share: "🎧", feedback: "🎚️", producers: "🎛️", gear: "🔌", events: "🎪", collab: "🤝", memes: "😂" };
  $("boardNav").innerHTML = item("#/", T("c.home"), route.type === "home", "🏠") + B.BOARDS.map(b => item("#/b/" + b, boardName(b), route.type === "board" && route.board === b, ICON[b])).join("");
}

/* ---------- 상단 헤더(제목/정렬) ---------- */
function renderHead() {
  let title = "", desc = "", back = false;
  if (route.type === "home") title = T("c.home");
  else if (route.type === "board") { title = boardName(route.board); desc = T("board." + route.board + ".d"); }
  else if (route.type === "user") title = T("c.postsBy", { u: route.user });
  else if (route.type === "search") title = route.tag ? T("c.tagResults", { t: route.tag }) : T("c.searchResults", { q: route.q });
  else if (route.type === "post") { title = T("c.back"); back = true; }
  const tabs = route.type !== "post" ? `<div class="sort" role="tablist" aria-label="${esc(T("c.sortLabel"))}">
    <button role="tab" data-sort="latest" aria-selected="${sort === "latest"}" class="${sort === "latest" ? "on" : ""}">${esc(T("c.sortLatest"))}</button>
    <button role="tab" data-sort="top" aria-selected="${sort === "top"}" class="${sort === "top" ? "on" : ""}">${esc(T("c.sortTop"))}</button></div>` : "";
  $("viewHead").innerHTML = `<div class="vh-row">${back ? `<button class="back" id="backBtn" aria-label="${esc(T("c.back"))}">←</button>` : ""}<h1 class="vh-title">${esc(title)}</h1>${tabs}</div>${desc ? `<p class="vh-desc">${esc(desc)}</p>` : ""}`;
  if (back) $("backBtn").onclick = () => (history.length > 1 ? history.back() : go("#/"));
  $("viewHead").querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { sort = b.dataset.sort; renderHead(); loadList(true); });
}

/* ---------- 작성창 ---------- */
function renderComposer() {
  const u = B.user(), box = $("composerBox");
  if (route.type === "post") { box.innerHTML = ""; return; }
  if (!u) { box.innerHTML = `<div class="login-cta"><span>${esc(T("c.loginToPost"))}</span><button class="cta" id="loginToPost">${esc(T("auth.login"))}</button></div>`; $("loginToPost").onclick = () => DZ.openAuth("login"); return; }
  const prev = $("cBody") ? [$("cTitle").value, $("cBody").value] : ["", ""];
  if (route.type === "board") postBoard = route.board;
  box.innerHTML = `<form class="composer" id="composer">
    ${avatar(u.username || "?")}
    <div class="c-fields">
      <input id="cTitle" maxlength="100" placeholder="${esc(T("c.titleOptPh"))}">
      <textarea id="cBody" rows="3" maxlength="2000" placeholder="${esc(T("c.bodyPh"))}"></textarea>
      <div class="c-row">
        <label class="c-board"><span>${esc(T("c.postIn"))}</span><select id="cBoard">${B.BOARDS.map(b => `<option value="${b}"${b === postBoard ? " selected" : ""}>${esc(boardName(b))}</option>`).join("")}</select></label>
        <span class="c-count" id="cCount">0/2000</span>
        <button class="cta small" type="submit">${esc(T("c.post"))}</button>
      </div></div></form>`;
  $("cTitle").value = prev[0]; $("cBody").value = prev[1];
  const cnt = () => $("cCount").textContent = $("cBody").value.length + "/2000"; cnt();
  $("cBody").oninput = cnt; $("cBoard").onchange = e => postBoard = e.target.value;
  $("composer").onsubmit = async e => {
    e.preventDefault();
    const body = $("cBody").value.trim(); if (!body) return DZ.toast(T("err.fields"));
    const title = $("cTitle").value.trim() || deriveTitle(body);
    if (!cooldown("post")) return;
    try {
      const id = await B.createPost($("cBoard").value, title, body); last.post = Date.now(); tagsCache = null;
      $("cTitle").value = $("cBody").value = ""; cnt();
      if (route.type === "board" && route.board !== $("cBoard").value) go("#/b/" + $("cBoard").value); else loadList(true);
    } catch (ex) { DZ.toast(DZ.errText(ex)); }
  };
}

/* ---------- 카드 ---------- */
function actions(p, detail) {
  const me = B.user(), mine = me && me.id === p.author;
  return `<div class="acts">
    <a class="act" href="#/p/${p.id}" aria-label="${esc(T("c.replies"))}">💬 ${p.comment_count}</a>
    <button class="act like${p.liked ? " on" : ""}" data-a="like" aria-pressed="${!!p.liked}" aria-label="${esc(T("c.like"))}">🔥 ${p.like_count}</button>
    <button class="act" data-a="share" aria-label="${esc(T("c.share"))}">🔗</button>
    ${me && !mine ? `<button class="act sub" data-a="report" aria-label="${esc(T("c.report"))}">⚑</button>` : ""}
    ${mine ? `<button class="act del" data-a="del" aria-label="${esc(T("c.delete"))}">🗑</button>` : ""}
  </div>`;
}
function embed(p) { const id = ytId(p.body); return id ? `<button class="yt" data-yt="${id}">${esc(T("c.watch"))}</button>` : ""; }
function card(p, detail) {
  return `<article class="post${detail ? " detail" : ""}" data-id="${p.id}" ${detail ? "" : 'tabindex="0"'}>
    ${avatar(p.username)}
    <div class="p-main">
      <div class="p-top">${userLink(p.username)}<span class="dot">·</span><time datetime="${esc(p.created_at)}">${esc(DZ.ago(p.created_at))}</time><a class="btag" href="#/b/${p.board}">${esc(boardName(p.board))}</a></div>
      ${showTitle(p) ? `<h3 class="p-title">${esc(p.title)}</h3>` : ""}
      <div class="p-body${detail ? "" : " clamp"}">${rich(p.body)}</div>
      ${embed(p)}
      ${actions(p, detail)}
    </div></article>`;
}
function cmtCard(c) {
  const me = B.user(), mine = me && me.id === c.author;
  return `<div class="cmt" data-c="${c.id}">${avatar(c.username)}<div class="p-main">
    <div class="p-top">${userLink(c.username)}<span class="dot">·</span><time datetime="${esc(c.created_at)}">${esc(DZ.ago(c.created_at))}</time></div>
    <div class="p-body">${rich(c.body)}</div>
    <div class="acts">${me && !mine ? `<button class="act sub" data-a="reportc" aria-label="${esc(T("c.report"))}">⚑</button>` : ""}${mine ? `<button class="act del" data-a="delc" aria-label="${esc(T("c.delete"))}">🗑</button>` : ""}</div></div></div>`;
}

/* ---------- 목록 / 상세 ---------- */
function renderList() {
  $("postList").innerHTML = posts.length ? posts.map(p => card(p)).join("") : `<p class="empty">${esc(T(route.type === "search" || route.type === "user" ? "c.noResults" : "c.empty"))}</p>`;
  $("more").hidden = !hasMore; $("more").textContent = T("c.loadMore");
}
function renderDetail() {
  if (!single) { $("postList").innerHTML = `<p class="empty">${esc(T("c.noPostFound"))}</p>`; $("more").hidden = true; return; }
  const me = B.user();
  $("postList").innerHTML = card(single, true) + `<div class="thread">
    ${me ? `<form class="cmt-form" id="cmtForm">${avatar(me.username || "?")}<input id="cmtIn" maxlength="500" placeholder="${esc(T("c.commentPh"))}" autocomplete="off"><button class="cta small">${esc(T("c.send"))}</button></form>` : `<button class="linkish" data-a="login">${esc(T("c.loginToPost"))}</button>`}
    <div id="cmtList">${comments.map(cmtCard).join("")}</div></div>`;
  $("more").hidden = true;
}
async function loadList(reset) {
  const my = ++loadSeq;
  if (reset) { offset = 0; posts = []; $("postList").innerHTML = `<p class="fine pad">${esc(T("c.loading"))}</p>`; $("more").hidden = true; }
  const q = { sort, offset, limit: PAGE };
  if (route.type === "board") q.board = route.board;
  if (route.type === "user") q.author = route.user;
  if (route.type === "search") q.q = route.q;
  try {
    const rows = await B.posts(q); if (my !== loadSeq) return;
    posts = posts.concat(rows); offset = posts.length; hasMore = rows.length === PAGE; renderList();
  } catch { if (my === loadSeq) $("postList").innerHTML = `<p class="empty">${esc(T("c.loadFail"))}</p>`; }
}
async function loadPost() {
  const my = ++loadSeq; $("postList").innerHTML = `<p class="fine pad">${esc(T("c.loading"))}</p>`;
  try {
    const [p, c] = await Promise.all([B.post(route.id), B.comments(route.id)]); if (my !== loadSeq) return;
    single = p; comments = c || []; renderDetail();
  } catch { if (my === loadSeq) $("postList").innerHTML = `<p class="empty">${esc(T("c.loadFail"))}</p>`; }
}

/* ---------- 인기 태그 ---------- */
async function renderTags() {
  const el = $("tagList");
  try {
    if (!tagsCache || Date.now() - tagsCache.t > 60000) {
      const rows = await B.texts(), cnt = new Map();
      for (const r of rows) for (const m of ((r.title || "") + " " + (r.body || "")).matchAll(TAG_RE)) { const t = m[2].toLowerCase(); cnt.set(t, (cnt.get(t) || 0) + 1); }
      tagsCache = { t: Date.now(), list: [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 8) };
    }
    el.innerHTML = tagsCache.list.length ? tagsCache.list.map(([t, n]) => `<a class="tag-pill" href="#/t/${encodeURIComponent(t)}">#${esc(t)}<small>${n}</small></a>`).join("") : `<p class="fine">${esc(T("c.noTags"))}</p>`;
  } catch { el.innerHTML = ""; }
}

/* ---------- 라우트 처리 ---------- */
function onRoute() {
  route = parse(); single = null;
  if (route.type === "search" || route.type === "user") sort = "latest";
  $("q").value = route.type === "search" ? route.q : "";
  renderNav(); renderHead(); renderComposer();
  route.type === "post" ? loadPost() : loadList(true);
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", onRoute);

/* ---------- 이벤트 ---------- */
$("searchForm").onsubmit = e => { e.preventDefault(); const v = $("q").value.trim(); if (!v) return go("#/"); go(v[0] === "#" && v.length > 2 ? "#/t/" + encodeURIComponent(v.slice(1)) : "#/q/" + encodeURIComponent(v)); };
$("more").onclick = () => loadList(false);

const findPost = id => (single && single.id === id ? single : posts.find(x => x.id === id));
const redraw = p => { const el = document.querySelector(`.post[data-id="${p.id}"]`); if (el) el.outerHTML = card(p, route.type === "post"); };
$("postList").onclick = async e => {
  const yt = e.target.closest("[data-yt]");
  if (yt) { yt.outerHTML = `<div class="yt-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${yt.dataset.yt}?autoplay=1" title="YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`; return; }
  const el = e.target.closest("[data-a]"), art = e.target.closest(".post");
  if (!el) {
    if (art && route.type !== "post" && !e.target.closest("a, button, iframe")) go("#/p/" + art.dataset.id);
    return;
  }
  const a = el.dataset.a;
  if (a === "login") return DZ.openAuth("login");
  const id = art && +art.dataset.id, p = id && findPost(id);
  try {
    if (a === "like") {
      if (!B.user()) return DZ.openAuth("login");
      await B.toggleLike(id, p.liked); p.liked = !p.liked; p.like_count += p.liked ? 1 : -1; redraw(p);
    } else if (a === "share") {
      const url = location.origin + location.pathname + "#/p/" + id;
      if (navigator.share) { try { await navigator.share({ title: p.title, url }); return; } catch {} }
      try { await navigator.clipboard.writeText(url); DZ.toast(T("t.copied")); } catch { prompt("URL", url); }
    } else if (a === "report" || a === "reportc") {
      if (!confirm(T("c.reportAsk"))) return;
      const cid = a === "reportc" ? +el.closest(".cmt").dataset.c : id;
      try { await B.report(a === "report" ? "post" : "comment", cid); DZ.toast(T("c.reported")); }
      catch (ex) { DZ.toast(ex.code === "reportedAlready" ? T("c.reportedAlready") : DZ.errText(ex)); }
    } else if (a === "del") {
      if (!confirm(T("c.confirmDelete"))) return; await B.deletePost(id); tagsCache = null;
      route.type === "post" ? go("#/") : loadList(true);
    } else if (a === "delc") {
      if (!confirm(T("c.confirmDelete"))) return; await B.deleteComment(+el.closest(".cmt").dataset.c); await loadPost();
    }
  } catch (ex) { DZ.toast(DZ.errText(ex)); }
};
$("postList").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("post") && route.type !== "post") go("#/p/" + e.target.dataset.id); });
$("postList").addEventListener("submit", async e => {
  if (e.target.id !== "cmtForm") return; e.preventDefault();
  const v = $("cmtIn").value.trim(); if (!v || !cooldown("cmt")) return;
  try { await B.createComment(single.id, v); last.cmt = Date.now(); await loadPost(); }
  catch (ex) { DZ.toast(DZ.errText(ex)); }
});

/* ---------- 시작 ---------- */
(async () => {
  await DZ.init();
  DZ.titleKey = "c.title";
  $("demoBanner").hidden = B.live;
  try { const tj = await fetch("data/tracks.json").then(r => r.json()); $("featImg").src = tj.producer.avatar; $("featName").textContent = tj.producer.name; $("featCard").hidden = false; } catch {}
  DZ.onLang(() => { renderNav(); renderHead(); renderComposer(); route.type === "post" ? renderDetail() : renderList(); renderTags(); });
  DZ.onAuth(() => { renderComposer(); route.type === "post" ? loadPost() : loadList(true); });
  DZ.applyLang(); onRoute(); renderTags();
})().catch(() => DZ.toast("Error"));
})();
