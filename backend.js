// 커뮤니티 백엔드 어댑터. window.DZB 로 노출.
//  - 라이브: Supabase (Auth + Postgres/RLS) 를 REST 로 직접 호출 (SDK 없음)
//  - 데모: localStorage (설정이 비어 있을 때. 이 브라우저에만 저장됨)
(() => {
const C = window.DZ_CONFIG || {};
const live = !!(C.supabaseUrl && C.supabaseKey);
const ID_RE = /^[A-Za-z0-9_]{3,20}$/;
const BOARDS = ["lounge", "share", "producers", "events"];
const fail = (code, msg) => Object.assign(new Error(msg || code), { code });
const emailOf = u => u.toLowerCase() + "@" + (C.emailDomain || "dropzone-users.app");
const rd = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ---------------- Supabase ---------------- */
function supabase() {
  let sess = rd("dz_session");
  const save = s => { sess = s; s ? wr("dz_session", s) : localStorage.removeItem("dz_session"); };
  const toSess = j => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, username: (j.user.user_metadata || {}).username } });
  async function token() {
    if (!sess) return null;
    if (sess.expires_at - 60 < Date.now() / 1000) {
      try { save(toSess(await raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: sess.refresh_token }, noAuth: true }))); }
      catch { save(null); }
    }
    return sess && sess.access_token;
  }
  async function raw(path, { method = "GET", body, noAuth, prefer } = {}) {
    const t = noAuth ? null : await token();
    const r = await fetch(C.supabaseUrl + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { apikey: C.supabaseKey, ...(t ? { Authorization: "Bearer " + t } : C.supabaseKey.startsWith("sb_") ? {} : { Authorization: "Bearer " + C.supabaseKey }), "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }
    });
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) throw fail((j && (j.error_code || j.code)) || "generic", (j && (j.msg || j.message || j.error_description)) || r.statusText);
    return j;
  }
  const q = s => encodeURIComponent(s);
  return {
    live: true,
    user: () => sess && sess.user,
    async signUp(id, pw) {
      let j;
      try { j = await raw("/auth/v1/signup", { method: "POST", noAuth: true, body: { email: emailOf(id), password: pw, data: { username: id } } }); }
      catch (e) { if (/already|database error/i.test(e.message) || e.code === "user_already_exists") throw fail("taken"); throw e; }
      if (!j.access_token) throw fail("confirm");
      save(toSess(j));
    },
    async signIn(id, pw) {
      try { save(toSess(await raw("/auth/v1/token?grant_type=password", { method: "POST", noAuth: true, body: { email: emailOf(id), password: pw } }))); }
      catch (e) { throw fail(e.code === "invalid_credentials" ? "invalid" : e.code, e.message); }
    },
    async signOut() { try { await raw("/auth/v1/logout", { method: "POST" }); } catch {} save(null); },
    async posts(board) {
      const rows = await raw(`/rest/v1/posts_feed?board=eq.${q(board)}&order=created_at.desc&limit=50`);
      const liked = sess ? new Set((await raw(`/rest/v1/likes?select=post_id&user_id=eq.${sess.user.id}`)).map(x => x.post_id)) : new Set();
      return rows.map(p => ({ ...p, liked: liked.has(p.id) }));
    },
    async createPost(board, title, body) { const r = await raw("/rest/v1/posts", { method: "POST", body: { board, title, body }, prefer: "return=minimal" }); return r; },
    deletePost: id => raw(`/rest/v1/posts?id=eq.${id}`, { method: "DELETE" }),
    comments: id => raw(`/rest/v1/comments_feed?post_id=eq.${id}&order=created_at.asc&limit=200`),
    createComment: (post_id, body) => raw("/rest/v1/comments", { method: "POST", body: { post_id, body }, prefer: "return=minimal" }),
    deleteComment: id => raw(`/rest/v1/comments?id=eq.${id}`, { method: "DELETE" }),
    async toggleLike(id, liked) {
      if (liked) await raw(`/rest/v1/likes?post_id=eq.${id}&user_id=eq.${sess.user.id}`, { method: "DELETE" });
      else await raw("/rest/v1/likes", { method: "POST", body: { post_id: id }, prefer: "return=minimal" });
    }
  };
}

/* ---------------- 데모(localStorage) ---------------- */
function demo() {
  const K = "dz_demo";
  const db = () => rd(K) || { users: {}, posts: [], comments: [], likes: [], seq: 1, session: null };
  const put = d => wr(K, d);
  const hash = async (id, pw) => { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id.toLowerCase() + ":" + pw)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); };
  const me = () => { const d = db(); return d.session && d.users[d.session] ? { id: d.session, username: d.users[d.session].username } : null; };
  const need = () => { const u = me(); if (!u) throw fail("auth"); return u; };
  return {
    live: false,
    user: me,
    async signUp(id, pw) {
      const d = db(), k = id.toLowerCase();
      if (d.users[k]) throw fail("taken");
      d.users[k] = { username: id, hash: await hash(id, pw) }; d.session = k; put(d);
    },
    async signIn(id, pw) {
      const d = db(), u = d.users[id.toLowerCase()];
      if (!u || u.hash !== await hash(id, pw)) throw fail("invalid");
      d.session = id.toLowerCase(); put(d);
    },
    async signOut() { const d = db(); d.session = null; put(d); },
    async posts(board) {
      const d = db(), u = me();
      return d.posts.filter(p => p.board === board).sort((a, b) => b.id - a.id).map(p => ({
        ...p, like_count: d.likes.filter(l => l.post_id === p.id).length,
        comment_count: d.comments.filter(c => c.post_id === p.id).length,
        liked: !!u && d.likes.some(l => l.post_id === p.id && l.user_id === u.id)
      }));
    },
    async createPost(board, title, body) { const u = need(), d = db(); d.posts.push({ id: d.seq++, board, title, body, author: u.id, username: u.username, created_at: new Date().toISOString() }); put(d); },
    async deletePost(id) { const u = need(), d = db(); d.posts = d.posts.filter(p => !(p.id === id && p.author === u.id)); d.comments = d.comments.filter(c => c.post_id !== id); d.likes = d.likes.filter(l => l.post_id !== id); put(d); },
    async comments(id) { return db().comments.filter(c => c.post_id === id); },
    async createComment(post_id, body) { const u = need(), d = db(); d.comments.push({ id: d.seq++, post_id, body, author: u.id, username: u.username, created_at: new Date().toISOString() }); put(d); },
    async deleteComment(id) { const u = need(), d = db(); d.comments = d.comments.filter(c => !(c.id === id && c.author === u.id)); put(d); },
    async toggleLike(id, liked) { const u = need(), d = db(); d.likes = d.likes.filter(l => !(l.post_id === id && l.user_id === u.id)); if (!liked) d.likes.push({ post_id: id, user_id: u.id }); put(d); }
  };
}

window.DZB = Object.assign(live ? supabase() : demo(), { BOARDS, ID_RE });
})();
