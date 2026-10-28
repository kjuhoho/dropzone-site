(() => {
const { $, esc } = DZ, B = window.DZB, T = (k, v) => DZ.T(k, v);
const PAGE = 20, WAIT = { post: 15000, cmt: 4000 };
let bansRows = [], adminCount = 0, statsData = null;
let viewMode = (() => { try { return localStorage.getItem("dz_view") === "list" ? "list" : "feed"; } catch { return "feed"; } })(), pending = [], reportRows = [];
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
const avatar = (n, a, cls, img) => { const u = img ? B.fileUrl(img) : null; return `<span class="av${cls ? " " + cls : ""}" style="--h:${a != null ? +a : hue(n)}" aria-hidden="true">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : esc((n || "?")[0].toUpperCase())}</span>`; };
const userLink = n => `<a class="who" href="#/u/${encodeURIComponent(n)}">@${esc(n)}</a>`;
const deriveTitle = body => { const l = body.trim().split("\n")[0].trim(); return (l.length > 60 ? l.slice(0, 59) + "…" : l) || "(untitled)"; };
const showTitle = p => { const t = (p.title || "").replace(/…$/, ""); return t && !p.body.trim().startsWith(t); };
const cooldown = k => { if (Date.now() - last[k] < WAIT[k]) { DZ.toast(T("err.cooldown")); return false; } return true; };
const boardName = b => T("board." + b);
const IMG_OK = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const AUD_MAP = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac" };
const AUD_OK = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm"];
function kindOf(f) { const t = (f.type || "").toLowerCase(), ext = (f.name.split(".").pop() || "").toLowerCase(); if (IMG_OK.includes(t)) return "image"; if (AUD_OK.includes(t) || AUD_MAP[ext]) return "audio"; return null; }
const audType = f => { const ext = (f.name.split(".").pop() || "").toLowerCase(); return AUD_OK.includes(f.type) ? f.type : (AUD_MAP[ext] || "audio/mpeg"); };
async function compress(file) {
  if (file.type === "image/gif" || !window.createImageBitmap) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }), s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
    return blob && (blob.size < file.size || s < 1) ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}
function media(p) {
  const at = p.attachments || [];
  if (!at.length) return "";
  const imgs = at.filter(a => a.t === "image").map(a => ({ u: B.fileUrl(a.p), n: a.n })).filter(x => x.u);
  const aud = at.filter(a => a.t === "audio").map(a => ({ u: B.fileUrl(a.p), n: a.n })).filter(x => x.u);
  return (imgs.length ? `<div class="imgs n${Math.min(imgs.length, 4)}">${imgs.map(i => `<a href="${esc(i.u)}" target="_blank" rel="noopener"><img src="${esc(i.u)}" alt="${esc(i.n || "")}" loading="lazy"></a>`).join("")}</div>` : "")
    + aud.map(a => `<div class="aud"><span class="an">🎵 ${esc(a.n || T("c.audioFile"))}</span><audio controls preload="none" src="${esc(a.u)}"></audio></div>`).join("");
}
document.addEventListener("play", e => { if (e.target.tagName === "AUDIO") document.querySelectorAll("audio").forEach(a => a !== e.target && a.pause()); }, true);
const attIcons = p => { const at = p.attachments || []; return (at.some(a => a.t === "image") ? "🖼" : "") + (at.some(a => a.t === "audio") ? "🎵" : ""); };

/* ---------- 라우팅 ---------- */
function parse() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")), [k, ...r] = h.split("/"), v = r.join("/");
  if (k === "b" && B.BOARDS.includes(v)) return { type: "board", board: v };
  if (k === "following") return { type: "following" };
  if (k === "music") return { type: "music" };
  if (k === "notifications") return { type: "notifs" };
  if (k === "admin") return { type: "admin", tab: v === "bans" ? "bans" : v === "stats" ? "stats" : "reports" };
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
  const me = B.user();
  $("boardNav").innerHTML = item("#/", T("c.home"), route.type === "home", "🏠") + (me ? item("#/following", T("c.following"), route.type === "following", "👥") : "") + item("#/music", T("c.music"), route.type === "music", "🎧") + B.BOARDS.map(b => item("#/b/" + b, boardName(b), route.type === "board" && route.board === b, ICON[b])).join("")
    + (me && me.isAdmin ? item("#/admin", T("c.admin") + (adminCount ? ` (${adminCount})` : ""), route.type === "admin", "🛡️") : "");
}

/* ---------- 상단 헤더(제목/정렬) ---------- */
function renderHead() {
  let title = "", desc = "", back = false;
  if (route.type === "home") title = T("c.home");
  else if (route.type === "board") { title = boardName(route.board); desc = T("board." + route.board + ".d"); }
  else if (route.type === "user") title = T("c.postsBy", { u: route.user });
  else if (route.type === "search") title = route.tag ? T("c.tagResults", { t: route.tag }) : T("c.searchResults", { q: route.q });
  else if (route.type === "post") { title = T("c.back"); back = true; }
  else if (route.type === "admin") title = T("c.adminTitle");
  else if (route.type === "following") title = T("c.following");
  else if (route.type === "notifs") title = T("c.notifs");
  else if (route.type === "music") title = T("c.music");
  const list = route.type !== "post" && route.type !== "admin" && route.type !== "notifs" && route.type !== "music";
  const tabs = list ? `<div class="view" role="group" aria-label="${esc(T("c.viewLabel"))}"><button data-view="feed" class="${viewMode === "feed" ? "on" : ""}">${esc(T("c.viewFeed"))}</button><button data-view="list" class="${viewMode === "list" ? "on" : ""}">${esc(T("c.viewList"))}</button></div><div class="sort" role="tablist" aria-label="${esc(T("c.sortLabel"))}">
    <button role="tab" data-sort="latest" aria-selected="${sort === "latest"}" class="${sort === "latest" ? "on" : ""}">${esc(T("c.sortLatest"))}</button>
    <button role="tab" data-sort="top" aria-selected="${sort === "top"}" class="${sort === "top" ? "on" : ""}">${esc(T("c.sortTop"))}</button></div>` : "";
  $("viewHead").innerHTML = `<div class="vh-row">${back ? `<button class="back" id="backBtn" aria-label="${esc(T("c.back"))}">←</button>` : ""}<h1 class="vh-title">${esc(title)}</h1>${tabs}${route.type === "admin" ? `<div class="sort"><a class="sbtn ${route.tab === "reports" ? "on" : ""}" href="#/admin">${esc(T("c.tabReports"))}</a><a class="sbtn ${route.tab === "bans" ? "on" : ""}" href="#/admin/bans">${esc(T("c.tabBans"))}</a><a class="sbtn ${route.tab === "stats" ? "on" : ""}" href="#/admin/stats">${esc(T("c.tabStats"))}</a></div>` : ""}</div>${desc ? `<p class="vh-desc">${esc(desc)}</p>` : ""}`;
  if (back) $("backBtn").onclick = () => (history.length > 1 ? history.back() : go("#/"));
  $("viewHead").querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { sort = b.dataset.sort; renderHead(); loadList(true); });
  $("viewHead").querySelectorAll("[data-view]").forEach(b => b.onclick = () => { viewMode = b.dataset.view; try { localStorage.setItem("dz_view", viewMode); } catch {} renderHead(); renderList(); });
}

function banNote() {
  const u = B.user(); if (!u || !u.ban) return "";
  const until = u.ban.until ? T("c.untilDate", { d: new Date(u.ban.until).toLocaleString(DZ.lang) }) : T("c.untilPerm");
  return `<div class="ban-note">⛔ ${esc(T("c.suspendedBanner", { until, reason: u.ban.reason ? T("c.reasonLbl", { r: u.ban.reason }) : "" }))}</div>`;
}

/* ---------- 작성창 ---------- */
function renderPending() {
  const el = $("cPending"); if (!el) return;
  el.innerHTML = pending.map((x, i) => `<span class="pend">${x.t === "image" ? `<img src="${x.url}" alt="">` : "🎵"}<span class="pn">${esc(x.file.name)}</span><button type="button" data-rm="${i}" aria-label="${esc(T("c.removeFile"))}">✕</button></span>`).join("");
}
function clearPending() { pending.forEach(x => x.url && URL.revokeObjectURL(x.url)); pending = []; renderPending(); }
function addFiles(files) {
  for (const f of files) {
    const k = kindOf(f); if (!k) { DZ.toast(T("c.fileBad")); continue; }
    const imgs = pending.filter(x => x.t === "image").length, auds = pending.filter(x => x.t === "audio").length;
    if ((k === "image" && imgs >= 4) || (k === "audio" && auds >= 1)) { DZ.toast(T("c.fileMax")); continue; }
    if (f.size > (k === "audio" ? 12e6 : 25e6) || (f.type === "image/gif" && f.size > 3e6)) { DZ.toast(T("c.fileBig")); continue; }
    pending.push({ t: k, file: f, url: k === "image" ? URL.createObjectURL(f) : null });
  }
  renderPending();
}
function renderComposer() {
  const u = B.user(), box = $("composerBox");
  if (!["home", "board", "following"].includes(route.type)) { box.innerHTML = ""; return; }
  if (!u) { box.innerHTML = `<div class="login-cta"><span>${esc(T("c.loginToPost"))}</span><button class="cta" id="loginToPost">${esc(T("auth.login"))}</button></div>`; $("loginToPost").onclick = () => DZ.openAuth("login"); return; }
  if (u.ban) { box.innerHTML = banNote(); return; }
  const prev = $("cBody") ? [$("cTitle").value, $("cBody").value] : ["", ""];
  if (route.type === "board") postBoard = route.board;
  box.innerHTML = `<form class="composer" id="composer">
    ${avatar(u.username || "?", u.accent, "", u.avatar_path)}
    <div class="c-fields">
      <input id="cTitle" maxlength="100" placeholder="${esc(T("c.titleOptPh"))}">
      <textarea id="cBody" rows="3" maxlength="2000" placeholder="${esc(T("c.bodyPh"))}"></textarea>
      <div id="cPending" class="pending"></div>
      <div class="c-row">
        <button type="button" class="att" id="attImg" title="${esc(T("c.attachHint"))}">📷 ${esc(T("c.addImage"))}</button>
        <button type="button" class="att" id="attAud" title="${esc(T("c.attachHint"))}">🎵 ${esc(T("c.addAudio"))}</button>
        <input type="file" id="fImg" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>
        <input type="file" id="fAud" accept="audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,.mp3,.m4a,.wav,.ogg,.aac" hidden>
        <label class="c-board"><span>${esc(T("c.postIn"))}</span><select id="cBoard">${B.BOARDS.map(b => `<option value="${b}"${b === postBoard ? " selected" : ""}>${esc(boardName(b))}</option>`).join("")}</select></label>
        <span class="c-count" id="cCount">0/2000</span>
        <button class="cta small" type="submit" id="cSubmit">${esc(T("c.post"))}</button>
      </div>
      <p class="fine">${esc(T("c.attachHint"))}</p></div></form>`;
  $("cTitle").value = prev[0]; $("cBody").value = prev[1]; renderPending();
  const cnt = () => $("cCount").textContent = $("cBody").value.length + "/2000"; cnt();
  $("cBody").oninput = cnt; $("cBoard").onchange = e => postBoard = e.target.value;
  $("attImg").onclick = () => $("fImg").click(); $("attAud").onclick = () => $("fAud").click();
  $("fImg").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; }; $("fAud").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
  $("cPending").onclick = e => { const b = e.target.closest("[data-rm]"); if (!b) return; const [x] = pending.splice(+b.dataset.rm, 1); if (x.url) URL.revokeObjectURL(x.url); renderPending(); };
  $("composer").onsubmit = async e => {
    e.preventDefault();
    const body0 = $("cBody").value.trim(); if (!body0 && !pending.length) return DZ.toast(T("err.fields"));
    const body = body0 || (pending.some(x => x.t === "image") ? "📷" : "🎵");
    const title = $("cTitle").value.trim() || (body0 ? deriveTitle(body0) : T("c.attachNoText"));
    if (!cooldown("post")) return;
    const btn = $("cSubmit"), label = btn.textContent; btn.disabled = true; btn.textContent = T("c.uploading");
    const uploaded = [];
    try {
      for (const x of pending) {
        let f = x.file;
        if (x.t === "image") { f = await compress(f); if (f.size > 5e6) throw Object.assign(new Error("big"), { code: "fileBig" }); }
        else f = new File([f], f.name, { type: audType(f) });
        const p = await B.upload(f); uploaded.push({ t: x.t, p, n: x.file.name.slice(0, 60), s: f.size });
      }
      await B.createPost($("cBoard").value, title, body, uploaded); last.post = Date.now(); tagsCache = null;
      $("cTitle").value = $("cBody").value = ""; cnt(); clearPending();
      if (route.type === "board" && route.board !== $("cBoard").value) go("#/b/" + $("cBoard").value); else loadList(true);
    } catch (ex) {
      B.removeFiles(uploaded.map(a => a.p));
      DZ.toast(ex.code === "fileBig" ? T("c.fileBig") : ex.code === "fileBad" ? T("c.fileBad") : ex.code === "demoFile" ? T("c.demoFile") : DZ.errText(ex));
    } finally { const b2 = $("cSubmit"); if (b2) { b2.disabled = false; b2.textContent = label; } }
  };
}

/* ---------- 카드 ---------- */
function actions(p, detail) {
  const me = B.user(), mine = me && me.id === p.author, canDel = mine || (me && me.isAdmin);
  return `<div class="acts">
    <a class="act" href="#/p/${p.id}" aria-label="${esc(T("c.replies"))}">💬 ${p.comment_count}</a>
    <button class="act like${p.liked ? " on" : ""}" data-a="like" aria-pressed="${!!p.liked}" aria-label="${esc(T("c.like"))}">🔥 ${p.like_count}</button>
    <button class="act" data-a="share" aria-label="${esc(T("c.share"))}">🔗</button>
    ${me && !mine ? `<button class="act sub" data-a="report" aria-label="${esc(T("c.report"))}">⚑</button>` : ""}
    ${canDel ? `<button class="act del" data-a="del" aria-label="${esc(T("c.delete"))}">🗑</button>` : ""}
  </div>`;
}
function embed(p) { const id = ytId(p.body); return id ? `<button class="yt" data-yt="${id}">${esc(T("c.watch"))}</button>` : ""; }
function card(p, detail) {
  return `<article class="post${detail ? " detail" : ""}" data-id="${p.id}" ${detail ? "" : 'tabindex="0"'}>
    ${avatar(p.username, p.accent, "", p.avatar_path)}
    <div class="p-main">
      <div class="p-top">${userLink(p.username)}<span class="dot">·</span><time datetime="${esc(p.created_at)}">${esc(DZ.ago(p.created_at))}</time><a class="btag" href="#/b/${p.board}">${esc(boardName(p.board))}</a></div>
      ${p.hidden ? `<div class="hid">${esc(T("c.hiddenTag"))}</div>` : ""}
      ${showTitle(p) ? `<h3 class="p-title">${esc(p.title)}</h3>` : ""}
      <div class="p-body${detail ? "" : " clamp"}">${rich(p.body)}</div>
      ${media(p)}
      ${embed(p)}
      ${actions(p, detail)}
    </div></article>`;
}
function cmtCard(c) {
  const me = B.user(), mine = me && me.id === c.author, canDel = mine || (me && me.isAdmin);
  return `<div class="cmt" data-c="${c.id}">${avatar(c.username, c.accent, "", c.avatar_path)}<div class="p-main">
    <div class="p-top">${userLink(c.username)}<span class="dot">·</span><time datetime="${esc(c.created_at)}">${esc(DZ.ago(c.created_at))}</time></div>
    ${c.hidden ? `<div class="hid">${esc(T("c.hiddenTag"))}</div>` : ""}
    <div class="p-body">${rich(c.body)}</div>
    <div class="acts">${me && !mine ? `<button class="act sub" data-a="reportc" aria-label="${esc(T("c.report"))}">⚑</button>` : ""}${canDel ? `<button class="act del" data-a="delc" aria-label="${esc(T("c.delete"))}">🗑</button>` : ""}</div></div></div>`;
}

/* ---------- 목록 / 상세 ---------- */
const lrow = p => `<a class="lrow" href="#/p/${p.id}"><span class="lb">${esc(boardName(p.board))}</span><span class="lt"><span class="lt-t">${esc(p.title)}</span>${attIcons(p) ? `<span class="lic" title="${esc(T("c.listAttach"))}">${attIcons(p)}</span>` : ""}${p.comment_count ? `<span class="lc">[${p.comment_count}]</span>` : ""}</span><span class="la">@${esc(p.username)}</span><span class="ld">${esc(DZ.ago(p.created_at))}</span><span class="ll">🔥 ${p.like_count}</span></a>`;
function renderList() {
  if (route.type === "admin") return renderAdmin();
  if (route.type === "notifs") return loadNotifs();
  if (route.type === "music") return renderMusic();
  $("postList").innerHTML = posts.length ? (viewMode === "list" ? `<div class="board-list">${posts.map(lrow).join("")}</div>` : posts.map(p => card(p)).join("")) : `<p class="empty">${esc(T(route.type === "search" || route.type === "user" ? "c.noResults" : route.type === "following" ? "c.followEmpty" : "c.empty"))}</p>`;
  $("more").hidden = !hasMore; $("more").textContent = T("c.loadMore");
}
function renderDetail() {
  if (!single) { $("postList").innerHTML = `<p class="empty">${esc(T("c.noPostFound"))}</p>`; $("more").hidden = true; return; }
  const me = B.user();
  $("postList").innerHTML = card(single, true) + `<div class="thread">
    ${me && me.ban ? banNote() : me ? `<form class="cmt-form" id="cmtForm">${avatar(me.username || "?", me.accent, "", me.avatar_path)}<input id="cmtIn" maxlength="500" placeholder="${esc(T("c.commentPh"))}" autocomplete="off"><button class="cta small">${esc(T("c.send"))}</button></form>` : `<button class="linkish" data-a="login">${esc(T("c.loginToPost"))}</button>`}
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
    if (route.type === "following") { const ids = await B.followingIds(); if (my !== loadSeq) return; if (!ids.length) { posts = []; hasMore = false; renderList(); return; } q.authors = ids; }
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

/* ---------- 알림 ---------- */
const nrow = n => { const txt = T(n.type === "comment" ? "c.nComment" : n.type === "like" ? "c.nLike" : "c.nFollow", { u: n.actor_name }); const href = n.type === "follow" ? `#/u/${encodeURIComponent(n.actor_name)}` : `#/p/${n.post_id}`;
  return `<a class="nrow${n.read ? "" : " unread"}" href="${href}">${avatar(n.actor_name, n.actor_accent)}<span class="nt"><span>${esc(txt)}</span>${n.post_title && n.type !== "follow" ? `<small>${esc(n.post_title)}</small>` : ""}</span><time>${esc(DZ.ago(n.created_at))}</time></a>`; };
async function loadNotifs() {
  const my = ++loadSeq; $("more").hidden = true; $("postList").innerHTML = `<p class="fine pad">${esc(T("c.loading"))}</p>`;
  try {
    const rows = await B.notifications(); if (my !== loadSeq) return;
    $("postList").innerHTML = rows.length ? rows.map(nrow).join("") : `<p class="empty">${esc(T("c.notifNone"))}</p>`;
    if (rows.some(n => !n.read)) { await B.markAllRead(); DZ.refreshBell(); }
  } catch { if (my === loadSeq) $("postList").innerHTML = `<p class="empty">${esc(T("c.loadFail"))}</p>`; }
}

/* ---------- 프로필 / 음원 ---------- */
const HUES = [null, 0, 25, 50, 140, 190, 220, 270, 320];
const LINK_KEYS = [["instagram", "Instagram"], ["youtube", "YouTube"], ["tiktok", "TikTok"], ["soundcloud", "SoundCloud"], ["spotify", "Spotify"], ["website", "Website"]];
const LINK_RE = /^https:\/\/[^\s<>"]{3,200}$/;
let edit = null, upl = null, profileCur = null, musicRows = [];

async function coverCrop(file, w, h, name) {   // 가운데 기준으로 꽉 채워 자른 JPEG
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const sc = Math.max(w / bmp.width, h / bmp.height), cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d"); g.fillStyle = "#07060d"; g.fillRect(0, 0, w, h);
  g.drawImage(bmp, (w - bmp.width * sc) / 2, (h - bmp.height * sc) / 2, bmp.width * sc, bmp.height * sc);
  const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.88));
  return new File([blob], name, { type: "image/jpeg" });
}
const fileErr = ex => ex.code === "fileBig" ? T("c.fileBig") : ex.code === "fileBad" ? T("c.fileBad") : ex.code === "demoFile" ? T("c.demoFile") : DZ.errText(ex);

function trackCard(t) {
  const me = B.user(), mine = !!(me && me.id === t.owner), canDel = mine || !!(me && me.isAdmin);
  const au = B.fileUrl(t.audio_path), cu = t.cover_path ? B.fileUrl(t.cover_path) : null; if (!au) return "";
  return `<div class="trk" data-tid="${t.id}" data-ap="${esc(t.audio_path)}" data-cp="${esc(t.cover_path || "")}">
    <div class="tk-cover">${cu ? `<img src="${esc(cu)}" alt="" loading="lazy">` : "🎵"}</div>
    <div class="tk-main"><div class="tk-top"><b>${esc(t.title)}</b>${t.hidden ? `<span class="hid">${esc(T("c.hiddenTag"))}</span>` : ""}</div>
      <small>${[t.genre ? esc(t.genre) : "", t.username ? userLink(t.username) : "", esc(DZ.ago(t.created_at))].filter(Boolean).join(" · ")}</small>
      <audio controls preload="none" src="${esc(au)}"></audio></div>
    <div class="acts">${me && !mine ? `<button class="act sub" data-tk="report" aria-label="${esc(T("c.report"))}">⚑</button>` : ""}${canDel ? `<button class="act del" data-tk="del" aria-label="${esc(T("c.delete"))}">🗑</button>` : ""}</div></div>`;
}
async function trackClick(e) {
  const el = e.target.closest("[data-tk]"); if (!el) return;
  const card = el.closest(".trk"), id = +card.dataset.tid;
  try {
    if (el.dataset.tk === "del") {
      if (!confirm(T("c.confirmDelete"))) return;
      await B.deleteTrack(id); B.removeFiles([card.dataset.ap, card.dataset.cp].filter(Boolean));
      if (B.user() && B.user().isAdmin) { try { await B.deleteReportsFor("track", id); } catch {} }
      route.type === "music" ? loadMusic() : renderProfile();
    } else if (el.dataset.tk === "report") {
      if (!confirm(T("c.reportAsk"))) return;
      try { await B.report("track", id); DZ.toast(T("c.reported")); } catch (ex) { DZ.toast(ex.code === "reportedAlready" ? T("c.reportedAlready") : DZ.errText(ex)); }
    }
  } catch (ex) { DZ.toast(DZ.errText(ex)); }
}
$("postList").addEventListener("click", trackClick);
$("profileBox").addEventListener("click", trackClick);

function renderMusic() {
  $("more").hidden = true;
  $("postList").innerHTML = musicRows.length ? `<div class="trk-list">${musicRows.map(trackCard).join("")}</div>` : `<p class="empty">${esc(T("c.musicEmpty"))}</p>`;
}
async function loadMusic() {
  const my = ++loadSeq; $("more").hidden = true; $("postList").innerHTML = `<p class="fine pad">${esc(T("c.loading"))}</p>`;
  try { const rows = await B.latestTracks({ limit: 30 }); if (my !== loadSeq) return; musicRows = rows || []; renderMusic(); }
  catch { if (my === loadSeq) $("postList").innerHTML = `<p class="empty">${esc(T("c.loadFail"))}</p>`; }
}

async function renderProfile() {
  const box = $("profileBox"); if (route.type !== "user") { box.innerHTML = ""; return; }
  let pr = null; try { pr = await B.profileOf(route.user); } catch {}
  if (route.type !== "user") return;
  if (!pr) { box.innerHTML = `<p class="empty">${esc(T("c.noProfile"))}</p>`; return; }
  profileCur = pr;
  const me = B.user(), self = !!(me && me.username && me.username.toLowerCase() === pr.username.toLowerCase());
  let following = false; if (me && !self) { try { following = await B.isFollowing(pr.id); } catch {} }
  let tracks = []; try { tracks = (await B.tracksOf(pr.id)) || []; } catch {}
  const joined = new Intl.DateTimeFormat(DZ.lang, { year: "numeric", month: "short" }).format(new Date(pr.created_at));
  const bUrl = pr.banner_path ? B.fileUrl(pr.banner_path) : null;
  const links = LINK_KEYS.filter(([k]) => pr.links && LINK_RE.test(pr.links[k] || "")).map(([k, n]) => `<a class="chip-btn" href="${esc(pr.links[k])}" target="_blank" rel="noopener nofollow ugc">${n}</a>`).join("");
  box.innerHTML = `<div class="pbanner s${pr.banner_style == null ? 0 : +pr.banner_style}"${bUrl ? ` style="background-image:url('${esc(bUrl)}')"` : ""}></div>
    <div class="pcard">${avatar(pr.username, pr.accent, "lg", pr.avatar_path)}<div class="pc-main">
    <div class="pc-top"><h2 class="pc-name">@${esc(pr.username)}</h2>${self ? `<button class="chip-btn" data-p="edit">${esc(T("c.editProfile"))}</button>` : `<button class="chip-btn${following ? "" : " strong"}" data-p="follow" data-uid="${esc(pr.id)}" data-f="${following ? 1 : 0}">${esc(following ? T("c.unfollow") : T("c.follow"))}</button>`}</div>
    ${pr.bio ? `<p class="pc-bio">${esc(pr.bio)}</p>` : ""}
    ${links ? `<div class="pc-links">${links}</div>` : ""}
    <div class="pc-stats"><span><b>${pr.posts_count}</b> ${esc(T("c.postsN"))}</span><span><b>${pr.followers}</b> ${esc(T("c.followers"))}</span><span><b>${pr.following}</b> ${esc(T("c.followingN"))}</span><span class="fine">${esc(T("c.joined", { d: joined }))}</span></div></div></div>
    <div id="pedit"></div>
    <section class="ptracks"><div class="pt-head"><h3>🎧 ${esc(T("c.myMusic"))}</h3>${self && tracks.length < 5 ? `<button class="chip-btn strong" data-p="upload">${esc(T("c.uploadTrack"))}</button>` : ""}</div><div id="pupload"></div>
    ${tracks.length ? tracks.map(trackCard).join("") : `<p class="fine pad">${esc(T("c.noTracks"))}</p>`}</section>`;
}

function openEdit() {
  const pr = profileCur; edit = { avatarFile: null, avatarRemove: false, bannerFile: null, bannerRemove: false, style: pr.banner_style == null ? 0 : +pr.banner_style, accent: pr.accent == null ? null : +pr.accent };
  $("pedit").innerHTML = `<form class="pform" id="pform">
    <div class="pf"><span>${esc(T("c.avatarLbl"))}</span><div class="pf-row"><button type="button" class="chip-btn" data-p="pickAv">${esc(T("c.uploadImg"))}</button><button type="button" class="linkish" data-p="rmAv">${esc(T("c.removeImage"))}</button><span class="fine" id="pAvName"></span></div></div>
    <div class="pf"><span>${esc(T("c.bannerLbl"))}</span><div class="pf-row"><button type="button" class="chip-btn" data-p="pickBn">${esc(T("c.uploadImg"))}</button><button type="button" class="linkish" data-p="rmBn">${esc(T("c.removeImage"))}</button><span class="fine" id="pBnName"></span></div></div>
    <div class="pf"><span>${esc(T("c.bannerStyle"))}</span><div class="swatches">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<button type="button" class="sw bs s${i}${i === edit.style ? " on" : ""}" data-p="bstyle" data-i="${i}" aria-label="${i + 1}"></button>`).join("")}</div></div>
    <div class="pf"><span>${esc(T("c.accentLbl"))}</span><div class="swatches">${HUES.map(h => `<button type="button" class="sw ac${h === edit.accent ? " on" : ""}" data-p="hue" data-h="${h == null ? "" : h}" style="--h:${h == null ? 200 : h}" title="${h == null ? esc(T("c.auto")) : h}">${h == null ? "A" : ""}</button>`).join("")}</div></div>
    <textarea id="pBio" maxlength="300" rows="3" placeholder="${esc(T("c.bioPh"))}"></textarea>
    <div class="pf"><span>${esc(T("c.linksLbl"))}</span><div class="links-grid">${LINK_KEYS.map(([k, n]) => `<input data-link="${k}" placeholder="${n} — https://…" maxlength="200" inputmode="url" autocomplete="off" spellcheck="false">`).join("")}</div></div>
    <input type="file" id="fAv" accept="image/jpeg,image/png,image/webp" hidden><input type="file" id="fBn" accept="image/jpeg,image/png,image/webp" hidden>
    <div class="c-row"><button class="cta small" type="submit" id="pSave">${esc(T("c.saveProfile"))}</button><button type="button" class="linkish" data-p="cancel">${esc(T("auth.close"))}</button></div></form>`;
  $("pBio").value = pr.bio || "";
  document.querySelectorAll("[data-link]").forEach(i => i.value = (pr.links && pr.links[i.dataset.link]) || "");
  const pick = (id, key, nameId) => $(id).onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return DZ.toast(T("c.fileBad")); if (f.size > 15e6) return DZ.toast(T("c.fileBig")); edit[key + "File"] = f; edit[key + "Remove"] = false; $(nameId).textContent = f.name; };
  pick("fAv", "avatar", "pAvName"); pick("fBn", "banner", "pBnName");
  $("pform").onsubmit = saveProfile;
}
async function saveProfile(ev) {
  ev.preventDefault();
  const links = {};
  for (const inp of document.querySelectorAll("[data-link]")) { const v = inp.value.trim(); if (!v) continue; if (!LINK_RE.test(v)) return DZ.toast(T("c.badLink")); links[inp.dataset.link] = v; }
  const btn = $("pSave"); btn.disabled = true; const up = [], old = [];
  try {
    let avatar_path = profileCur.avatar_path || null, banner_path = profileCur.banner_path || null;
    if (edit.avatarRemove) { if (avatar_path) old.push(avatar_path); avatar_path = null; }
    if (edit.avatarFile) { const p = await B.upload(await coverCrop(edit.avatarFile, 256, 256, "avatar.jpg")); up.push(p); if (avatar_path) old.push(avatar_path); avatar_path = p; }
    if (edit.bannerRemove) { if (banner_path) old.push(banner_path); banner_path = null; }
    if (edit.bannerFile) { const p = await B.upload(await coverCrop(edit.bannerFile, 1200, 400, "banner.jpg")); up.push(p); if (banner_path) old.push(banner_path); banner_path = p; }
    await B.updateProfile({ bio: $("pBio").value.trim(), accent: edit.accent, avatar_path, banner_path, banner_style: edit.style, links });
    B.removeFiles(old); DZ.toast(T("c.profileSaved")); edit = null;
    renderComposer(); await renderProfile(); loadList(true);
  } catch (ex) { B.removeFiles(up); DZ.toast(fileErr(ex)); }
  finally { const b2 = $("pSave"); if (b2) b2.disabled = false; }
}

function openUpload() {
  upl = { audio: null, cover: null };
  $("pupload").innerHTML = `<form class="pform" id="tform">
    <div class="pf-row"><button type="button" class="chip-btn" data-p="pickAud">🎵 ${esc(T("c.pickAudio"))}</button><span class="fine" id="tAudName"></span></div>
    <input id="tTitle" maxlength="80" placeholder="${esc(T("c.trackTitle"))}"><input id="tGenre" maxlength="30" placeholder="${esc(T("c.trackGenre"))}">
    <div class="pf-row"><button type="button" class="chip-btn" data-p="pickCov">🖼 ${esc(T("c.trackCover"))}</button><span class="fine" id="tCovName"></span></div>
    <label class="show"><input type="checkbox" id="tRights"> <span>${esc(T("c.rights"))}</span></label>
    <p class="fine">${esc(T("c.trackHint"))}</p>
    <input type="file" id="fTa" accept="audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,.mp3,.m4a,.wav,.ogg,.aac" hidden><input type="file" id="fTc" accept="image/jpeg,image/png,image/webp" hidden>
    <div class="c-row"><button class="cta small" type="submit" id="tSave">${esc(T("c.post"))}</button><button type="button" class="linkish" data-p="cancelUp">${esc(T("auth.close"))}</button></div></form>`;
  $("fTa").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; if (kindOf(f) !== "audio") return DZ.toast(T("c.fileBad")); if (f.size > 12e6) return DZ.toast(T("c.fileBig")); upl.audio = f; $("tAudName").textContent = f.name; if (!$("tTitle").value) $("tTitle").value = f.name.replace(/\.[^.]+$/, "").slice(0, 80); };
  $("fTc").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return DZ.toast(T("c.fileBad")); if (f.size > 15e6) return DZ.toast(T("c.fileBig")); upl.cover = f; $("tCovName").textContent = f.name; };
  $("tform").onsubmit = async ev => {
    ev.preventDefault();
    if (!upl.audio) return DZ.toast(T("c.pickAudioFirst"));
    if (!$("tRights").checked) return DZ.toast(T("c.rightsErr"));
    const title = $("tTitle").value.trim() || upl.audio.name.replace(/\.[^.]+$/, "").slice(0, 80), btn = $("tSave"), up = [];
    btn.disabled = true;
    try {
      const ap = await B.upload(new File([upl.audio], upl.audio.name, { type: audType(upl.audio) })); up.push(ap);
      let cp = null; if (upl.cover) { cp = await B.upload(await coverCrop(upl.cover, 600, 600, "cover.jpg")); up.push(cp); }
      await B.addTrack({ title, genre: $("tGenre").value.trim(), audio_path: ap, cover_path: cp });
      DZ.toast(T("c.trackAdded")); upl = null; await renderProfile();
    } catch (ex) { B.removeFiles(up); DZ.toast(fileErr(ex)); }
    finally { const b2 = $("tSave"); if (b2) b2.disabled = false; }
  };
}

$("profileBox").onclick = async e => {
  const b = e.target.closest("[data-p]"); if (!b) return; const a = b.dataset.p;
  try {
    if (a === "follow") {
      if (!B.user()) return DZ.openAuth("login");
      b.dataset.f === "1" ? await B.unfollow(b.dataset.uid) : await B.follow(b.dataset.uid); await renderProfile();
    } else if (a === "edit") openEdit();
    else if (a === "cancel") $("pedit").innerHTML = "";
    else if (a === "hue") { edit.accent = b.dataset.h === "" ? null : +b.dataset.h; document.querySelectorAll(".sw.ac").forEach(x => x.classList.toggle("on", x === b)); }
    else if (a === "bstyle") { edit.style = +b.dataset.i; document.querySelectorAll(".sw.bs").forEach(x => x.classList.toggle("on", x === b)); }
    else if (a === "pickAv") $("fAv").click();
    else if (a === "pickBn") $("fBn").click();
    else if (a === "rmAv") { edit.avatarRemove = true; edit.avatarFile = null; $("pAvName").textContent = "✕"; }
    else if (a === "rmBn") { edit.bannerRemove = true; edit.bannerFile = null; $("pBnName").textContent = "✕"; }
    else if (a === "upload") openUpload();
    else if (a === "cancelUp") $("pupload").innerHTML = "";
    else if (a === "pickAud") $("fTa").click();
    else if (a === "pickCov") $("fTc").click();
  } catch (ex) { DZ.toast(DZ.errText(ex)); }
};

/* ---------- 관리자: 신고 ---------- */

function renderBans() {
  $("more").hidden = true;
  $("postList").innerHTML = bansRows.length ? bansRows.map(b => `<div class="rep brow"><div class="p-top"><b>@${esc(b.username)}</b><span class="dot">·</span><span>${esc(b.until ? T("c.untilDate", { d: new Date(b.until).toLocaleString(DZ.lang) }) : T("c.untilPerm"))}</span></div>${b.reason ? `<div class="fine">${esc(b.reason)}</div>` : ""}<div class="acts"><button class="act" data-a="aunban" data-uid="${esc(b.user_id)}">${esc(T("c.unban"))}</button></div></div>`).join("") : `<p class="empty">${esc(T("c.noBans"))}</p>`;
}
function renderStats() {
  $("more").hidden = true;
  const d = statsData || { events: [], members: [], posts: [] }, ev = d.events.filter(e => !/^setup/.test(e.key));
  const sum = (t, f = () => true) => ev.filter(e => e.type === t && f(e)).reduce((a, e) => a + Number(e.n), 0);
  const group = (t, key) => { const m = new Map(); ev.filter(e => e.type === t).forEach(e => { const k = key(e); m.set(k, (m.get(k) || 0) + Number(e.n)); }); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8); };
  const bars = rows => { const mx = Math.max(1, ...rows.map(r => r[1])); return rows.length ? rows.map(([k, n]) => `<div class="bar"><span style="width:${Math.round(n / mx * 100)}%"></span><b>${esc(k)}</b><i>${n}</i></div>`).join("") : `<p class="fine">${esc(T("c.sNoData"))}</p>`; };
  const days = [...Array(14)].map((_, i) => { const dt = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10); return [dt.slice(5), sum("visit", e => e.day === dt)]; });
  const tile = (l, v) => `<div class="tile"><b>${v}</b><span>${esc(l)}</span></div>`;
  $("postList").innerHTML = `<div class="stats"><p class="fine">${esc(T("c.sLast30"))}</p>
    <div class="tiles">${tile(T("c.sVisits"), sum("visit"))}${tile(T("c.sPlays"), sum("play"))}${tile(T("c.sShares"), sum("share"))}${tile(T("c.sMembers"), d.members.length)}${tile(T("c.sPosts"), d.posts.length)}</div>
    <h3>${esc(T("c.sVisits"))} · 14d</h3>${bars(days)}
    <h3>${esc(T("c.sByTrack"))}</h3>${bars(group("play", e => e.key))}
    <h3>${esc(T("c.sBySrc"))}</h3>${bars(group("visit", e => e.src || T("c.sDirect")))}
    <h3>${esc(T("c.sByLang"))}</h3>${bars(group("visit", e => e.lang || "?"))}</div>`;
}
function renderAdmin() {
  if (route.tab === "stats") return renderStats();
  if (route.tab === "bans") return renderBans();
  $("more").hidden = true;
  $("postList").innerHTML = reportRows.length ? reportRows.map(r => `<div class="rep" data-rid="${r.id}" data-type="${esc(r.target_type)}" data-tid="${r.target_id}">
    <div class="p-top"><span class="rtype">${esc(T(r.target_type === "post" ? "c.typePost" : r.target_type === "track" ? "c.typeTrack" : "c.typeComment"))}</span><span class="dot">·</span><span>${esc(T("c.byReporter", { u: r.reporter_name }))}</span><span class="dot">·</span><time>${esc(DZ.ago(r.created_at))}</time></div>
    <div class="p-body">${r.preview ? esc(r.preview) : `<i>${esc(T("c.adminGone"))}</i>`}</div>
    ${r.reason ? `<div class="fine">“${esc(r.reason)}”</div>` : ""}
    <div class="acts"><a class="act" href="${r.target_type === "track" ? "#/music" : "#/p/" + r.post_id}">${esc(T("c.adminOpen"))}</a>${r.preview ? `<button class="act del" data-a="adel">${esc(T("c.adminDelete"))}</button>` : ""}${r.target_hidden ? `<button class="act" data-a="aunhide">${esc(T("c.restore"))}</button>` : ""}<button class="act" data-a="adis">${esc(T("c.adminDismiss"))}</button></div>
    ${r.target_author && r.preview ? `<div class="susp-row"><select class="susp" aria-label="${esc(T("c.suspendBtn"))}"><option value="1">${esc(T("c.nDays", { n: 1 }))}</option><option value="7">${esc(T("c.nDays", { n: 7 }))}</option><option value="30">${esc(T("c.nDays", { n: 30 }))}</option><option value="0">${esc(T("c.permanent"))}</option></select><input class="susp-why" maxlength="100" placeholder="${esc(T("c.suspendReason"))}"><button class="act del" data-a="aban" data-uid="${esc(r.target_author)}">${esc(T("c.suspendBtn"))} @${esc(r.target_author_name || "")}</button></div>` : ""}</div>`).join("") : `<p class="empty">${esc(T("c.adminNone"))}</p>`;
}
async function loadAdmin() {
  const my = ++loadSeq; $("postList").innerHTML = `<p class="fine pad">${esc(T("c.loading"))}</p>`; $("more").hidden = true;
  try {
    if (route.tab === "stats") { const d = await B.stats(); if (my !== loadSeq) return; statsData = d; renderStats(); }
    else if (route.tab === "bans") { const rows = await B.bans(); if (my !== loadSeq) return; bansRows = rows || []; renderBans(); }
    else { const rows = await B.reports(); if (my !== loadSeq) return; reportRows = rows || []; adminCount = reportRows.length; renderNav(); renderAdmin(); }
  }
  catch { if (my === loadSeq) $("postList").innerHTML = `<p class="empty">${esc(T("c.loadFail"))}</p>`; }
}
const reload = () => route.type === "post" ? loadPost() : route.type === "admin" ? loadAdmin() : route.type === "notifs" ? loadNotifs() : route.type === "music" ? loadMusic() : loadList(true);

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
  if (route.type === "admin" && !(B.user() && B.user().isAdmin)) { location.hash = "#/"; return; }
  if ((route.type === "notifs" || route.type === "following") && !B.user()) { DZ.openAuth("login"); location.hash = "#/"; return; }
  if (route.type === "search" || route.type === "user") sort = "latest";
  $("q").value = route.type === "search" ? route.q : "";
  renderNav(); renderHead(); renderComposer(); renderProfile();
  if (B.user() && B.user().isAdmin && route.type !== "admin") B.reports().then(r => { adminCount = (r || []).length; renderNav(); }).catch(() => {});
  reload();
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
  if (el && el.dataset.a === "aunban") { try { await B.adminUnban(el.dataset.uid); DZ.toast(T("c.unbanOk")); await loadAdmin(); } catch (ex) { DZ.toast(DZ.errText(ex)); } return; }
  if (el && el.dataset.a === "aban") {
    const row = el.closest(".rep"), days = +row.querySelector(".susp").value, why = row.querySelector(".susp-why").value.trim();
    try { await B.adminBan(el.dataset.uid, days || null, why); DZ.toast(T("c.suspendOk")); } catch (ex) { DZ.toast(DZ.errText(ex)); }
    return;
  }
  if (el && el.dataset.a === "aunhide") {
    const row = el.closest(".rep");
    try { await B.unhide(row.dataset.type, +row.dataset.tid); DZ.toast(T("c.restored")); await loadAdmin(); } catch (ex) { DZ.toast(DZ.errText(ex)); }
    return;
  }
  if (el && (el.dataset.a === "adel" || el.dataset.a === "adis")) {
    const row = el.closest(".rep"), type = row.dataset.type, tid = +row.dataset.tid, rid = +row.dataset.rid;
    try {
      if (el.dataset.a === "adel") {
        if (!confirm(T("c.adminConfirm"))) return;
        const rr = reportRows.find(x => x.id === rid);
        if (type === "post") { await B.deletePost(tid); B.removeFiles(((rr && rr.attachments) || []).map(a => a.p)); } else if (type === "track") { await B.deleteTrack(tid); B.removeFiles(((rr && rr.attachments) || []).map(a => a.p)); } else await B.deleteComment(tid);
        await B.deleteReportsFor(type, tid); DZ.toast(T("c.adminDeleted"));
      } else await B.dismissReport(rid);
      tagsCache = null; await loadAdmin();
    } catch (ex) { DZ.toast(DZ.errText(ex)); }
    return;
  }
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
      if (!confirm(T("c.confirmDelete"))) return; await B.deletePost(id); B.removeFiles(((p && p.attachments) || []).map(x => x.p)); tagsCache = null;
      if (B.user() && B.user().isAdmin) { try { await B.deleteReportsFor("post", id); } catch {} }
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
  DZ.onLang(() => { renderNav(); renderHead(); renderComposer(); renderProfile(); route.type === "post" ? renderDetail() : renderList(); renderTags(); });
  DZ.onAuth(() => { if (route.type === "admin" && !(B.user() && B.user().isAdmin)) { location.hash = "#/"; return; } renderNav(); renderComposer(); renderProfile(); reload(); });
  DZ.applyLang(); onRoute(); renderTags();
})().catch(() => DZ.toast("Error"));
})();
