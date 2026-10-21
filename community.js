(() => {
const { $, esc } = DZ, B = window.DZB, T = (k, v) => DZ.T(k, v);
let board = "lounge", posts = [], open = new Set(), last = { post: 0, cmt: 0 }, comments = {};
const hash = () => { const b = location.hash.slice(1); if (B.BOARDS.includes(b)) board = b; };

// 본문: 이스케이프 후 줄바꿈과 http(s) 링크만 허용
const rich = s => esc(s).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow ugc">${u}</a>`);
const WAIT = { post: 15000, cmt: 4000 };
const cooldown = k => { if (Date.now() - last[k] < WAIT[k]) { DZ.toast(T("err.cooldown")); return false; } return true; };

function renderBoards() {
  $("boardChips").innerHTML = B.BOARDS.map(b => `<button role="tab" aria-selected="${b === board}" data-b="${b}" class="${b === board ? "on" : ""}">${esc(T("board." + b))}</button>`).join("");
  $("boardDesc").textContent = T("board." + board + ".d");
}
function renderComposer() {
  const u = B.user(), box = $("composerBox");
  if (!u) { box.innerHTML = `<button class="cta" id="loginToPost">${esc(T("c.loginToPost"))}</button>`; $("loginToPost").onclick = () => DZ.openAuth("login"); return; }
  const keep = box.querySelector("#pTitle") ? [box.querySelector("#pTitle").value, box.querySelector("#pBody").value] : ["", ""];
  box.innerHTML = `<form class="composer" id="composer"><b>${esc(T("c.new"))}</b>
    <input id="pTitle" maxlength="100" placeholder="${esc(T("c.titlePh"))}">
    <textarea id="pBody" rows="3" maxlength="2000" placeholder="${esc(T("c.bodyPh"))}"></textarea>
    <div class="row"><button class="cta" type="submit">${esc(T("c.post"))}</button></div></form>`;
  $("pTitle").value = keep[0]; $("pBody").value = keep[1];
  $("composer").onsubmit = async e => {
    e.preventDefault();
    const t = $("pTitle").value.trim(), b = $("pBody").value.trim();
    if (!t || !b) return DZ.toast(T("err.fields"));
    if (!cooldown("post")) return;
    try { await B.createPost(board, t, b); last.post = Date.now(); $("pTitle").value = $("pBody").value = ""; await load(); }
    catch (ex) { DZ.toast(DZ.errText(ex)); }
  };
}

function cardHtml(p) {
  const me = B.user(), mine = me && me.id === p.author, isOpen = open.has(p.id);
  return `<article class="post" data-id="${p.id}">
    <h3>${esc(p.title)}</h3>
    <p class="body">${rich(p.body)}</p>
    <div class="meta"><span>@${esc(p.username)} · ${esc(DZ.ago(p.created_at))}</span>
      <span class="acts">
        <button class="act like${p.liked ? " on" : ""}" data-a="like" aria-pressed="${!!p.liked}" aria-label="${esc(T("c.like"))}">🔥 ${p.like_count}</button>
        <button class="act" data-a="cm" aria-expanded="${isOpen}">💬 ${p.comment_count}</button>
        ${mine ? `<button class="act del" data-a="del">${esc(T("c.delete"))}</button>` : ""}
      </span></div>
    <div class="cmts" ${isOpen ? "" : "hidden"}>${isOpen ? cmtHtml(p.id) : ""}</div></article>`;
}
function cmtHtml(id) {
  const me = B.user(), list = comments[id];
  if (!list) return `<p class="fine">${esc(T("c.loading"))}</p>`;
  return list.map(c => `<div class="cmt" data-c="${c.id}"><span><b>@${esc(c.username)}</b> ${rich(c.body)} <small>${esc(DZ.ago(c.created_at))}</small></span>${me && me.id === c.author ? `<button class="act del" data-a="delc">✕</button>` : ""}</div>`).join("")
    + (me ? `<form class="cmt-form"><input maxlength="500" placeholder="${esc(T("c.commentPh"))}"><button class="chip-btn strong">${esc(T("c.send"))}</button></form>` : `<button class="linkish" data-a="login">${esc(T("c.loginToPost"))}</button>`);
}
function renderPosts() {
  $("postList").innerHTML = posts.length ? posts.map(cardHtml).join("") : `<p class="empty">${esc(T("c.empty"))}</p>`;
}

async function load() {
  $("postList").innerHTML = `<p class="fine">${esc(T("c.loading"))}</p>`;
  try { posts = await B.posts(board); renderPosts(); }
  catch { $("postList").innerHTML = `<p class="empty">${esc(T("c.loadFail"))}</p>`; }
}
async function loadComments(id) {
  try { comments[id] = await B.comments(id); } catch { comments[id] = []; }
  const card = document.querySelector(`.post[data-id="${id}"] .cmts`); if (card && open.has(id)) card.innerHTML = cmtHtml(id);
}

$("boardChips").onclick = e => { const b = e.target.closest("button"); if (!b) return; location.hash = b.dataset.b; };
window.addEventListener("hashchange", () => { hash(); open.clear(); renderBoards(); load(); });

$("postList").onclick = async e => {
  const el = e.target.closest("[data-a]"); if (!el) return;
  const card = el.closest(".post"), id = card && +card.dataset.id, a = el.dataset.a;
  if (a === "login") return DZ.openAuth("login");
  try {
    if (a === "like") {
      if (!B.user()) return DZ.openAuth("login");
      const p = posts.find(x => x.id === id); await B.toggleLike(id, p.liked);
      p.liked = !p.liked; p.like_count += p.liked ? 1 : -1; card.outerHTML = cardHtml(p);
    } else if (a === "cm") {
      open.has(id) ? open.delete(id) : open.add(id);
      const c = card.querySelector(".cmts"); c.hidden = !open.has(id); el.setAttribute("aria-expanded", open.has(id));
      if (open.has(id)) { c.innerHTML = cmtHtml(id); loadComments(id); }
    } else if (a === "del") {
      if (!confirm(T("c.confirmDelete"))) return; await B.deletePost(id); await load();
    } else if (a === "delc") {
      if (!confirm(T("c.confirmDelete"))) return; await B.deleteComment(+el.closest(".cmt").dataset.c);
      await loadComments(id); const p = posts.find(x => x.id === id); p.comment_count = comments[id].length; card.outerHTML = cardHtml(p);
    }
  } catch (ex) { DZ.toast(DZ.errText(ex)); }
};
$("postList").addEventListener("submit", async e => {
  if (!e.target.classList.contains("cmt-form")) return; e.preventDefault();
  const card = e.target.closest(".post"), id = +card.dataset.id, inp = e.target.querySelector("input"), v = inp.value.trim();
  if (!v || !cooldown("cmt")) return;
  try { await B.createComment(id, v); last.cmt = Date.now(); await loadComments(id); const p = posts.find(x => x.id === id); p.comment_count = comments[id].length; card.querySelector('[data-a="cm"]').textContent = "💬 " + p.comment_count; }
  catch (ex) { DZ.toast(DZ.errText(ex)); }
});

(async () => {
  await DZ.init();
  DZ.titleKey = "c.title"; hash();
  $("demoBanner").hidden = B.live;
  DZ.onLang(() => { renderBoards(); renderComposer(); renderPosts(); });
  DZ.onAuth(() => { comments = {}; renderComposer(); load(); });
  DZ.applyLang(); load();
})().catch(() => DZ.toast("Error"));
})();
