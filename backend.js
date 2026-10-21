// 커뮤니티 백엔드 어댑터. window.DZB 로 노출.
//  - 라이브: Supabase (Auth + Postgres/RLS) 를 REST 로 직접 호출 (SDK 없음)
//  - 데모: localStorage (설정이 비어 있을 때. 이 브라우저에만 저장됨)
(() => {
const C = window.DZ_CONFIG || {};
const live = !!(C.supabaseUrl && C.supabaseKey);
const ID_RE = /^[A-Za-z0-9_]{3,20}$/;
const BOARDS = ["lounge", "share", "feedback", "producers", "gear", "events", "collab", "memes"];
const fail = (code, msg) => Object.assign(new Error(msg || code), { code });
const emailOf = u => u.toLowerCase() + "@" + (C.emailDomain || "dropzone-users.app");
const rd = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ---------------- Supabase ---------------- */
function supabase() {
  let sess = rd("dz_session");
  const save = s => { sess = s; s ? wr("dz_session", s) : localStorage.removeItem("dz_session"); };
  const jwt = t => { const b = atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")); return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0)))); };
  const toSess = j => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, username: (j.user.user_metadata || {}).username || null, needsUsername: false } });

  // 구글 로그인 복귀: URL 해시에 토큰이 실려 온다 → 저장하고 주소창에서 지운다 (community.js 의 #게시판 라우팅과 충돌 방지)
  if (/access_token=|error_description=/.test(location.hash)) {
    const p = new URLSearchParams(location.hash.slice(1)), at = p.get("access_token");
    if (at) { try { const c = jwt(at); save({ access_token: at, refresh_token: p.get("refresh_token"), expires_at: +p.get("expires_at") || c.exp, user: { id: c.sub, username: null, needsUsername: false } }); } catch {} }
    history.replaceState(null, "", location.pathname + location.search);
  }

  async function token() {
    if (!sess) return null;
    if (sess.expires_at - 60 < Date.now() / 1000) {
      try { const u = sess.user; save({ ...toSess(await raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: sess.refresh_token }, noAuth: true })), user: u }); }
      catch { save(null); }
    }
    return sess && sess.access_token;
  }
  async function raw(path, { method = "GET", body, noAuth, prefer } = {}) {
    const t = noAuth ? null : await token();
    const auth = t ? { Authorization: "Bearer " + t } : C.supabaseKey.startsWith("sb_") ? {} : { Authorization: "Bearer " + C.supabaseKey };
    const r = await fetch(C.supabaseUrl + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { apikey: C.supabaseKey, ...auth, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }
    });
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) {
      const msg = (j && (j.msg || j.message || j.error_description)) || r.statusText;
      let code = (j && (j.error_code || j.code)) || "generic";
      if (/rate_limit/.test(msg) || /over_.*rate_limit/.test(code)) code = "cooldown";
      else if (/daily_limit/.test(msg)) code = "daily";
      else if (/captcha/i.test(code + msg)) code = "captcha";
      else if (code === "23505") code = "taken";
      else if (/bad_username/.test(msg)) code = "bad_username";
      throw Object.assign(fail(code, msg), { status: r.status });
    }
    return j;
  }
  const q = s => encodeURIComponent(s);
  // 서버의 프로필(닉네임/임시닉네임 여부)로 세션 사용자 정보를 갱신
  async function profile() {
    if (!sess) return;
    try {
      const [p] = await raw(`/rest/v1/profiles?id=eq.${sess.user.id}&select=username,needs_username`);
      if (p && sess) save({ ...sess, user: { ...sess.user, username: p.username, needsUsername: !!p.needs_username } });
      else if (!p) save(null); // 계정이 삭제된 경우
    } catch (e) { if (e.status === 401) save(null); }
  }
  const q_ = encodeURIComponent;
  async function withLiked(rows) {
    if (!sess || !rows.length) return rows.map(p => ({ ...p, liked: false }));
    const ids = rows.map(p => p.id).join(",");
    const liked = new Set((await raw(`/rest/v1/likes?select=post_id&user_id=eq.${sess.user.id}&post_id=in.(${ids})`)).map(x => x.post_id));
    return rows.map(p => ({ ...p, liked: liked.has(p.id) }));
  }
  const sec = cap => cap ? { gotrue_meta_security: { captcha_token: cap } } : {};
  const api = {
    live: true,
    user: () => sess && sess.user,
    ready: profile(),
    googleUrl: () => `${C.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${q(location.origin + location.pathname)}`,
    async signUp(id, pw, cap) {
      let j;
      try { j = await raw("/auth/v1/signup", { method: "POST", noAuth: true, body: { email: emailOf(id), password: pw, data: { username: id }, ...sec(cap) } }); }
      catch (e) { if (/already|database error/i.test(e.message) || e.code === "user_already_exists") throw fail("taken"); throw e; }
      if (!j.access_token) throw fail("confirm");
      save(toSess(j)); await profile();
    },
    async signIn(id, pw, cap) {
      try { save(toSess(await raw("/auth/v1/token?grant_type=password", { method: "POST", noAuth: true, body: { email: emailOf(id), password: pw, ...sec(cap) } }))); }
      catch (e) { throw fail(e.code === "invalid_credentials" ? "invalid" : e.code, e.message); }
      await profile();
    },
    async signOut() { try { await raw("/auth/v1/logout", { method: "POST" }); } catch {} save(null); },
    async setUsername(name) { await raw("/rest/v1/rpc/set_username", { method: "POST", body: { new_name: name } }); await profile(); },
    async deleteAccount() { await raw("/rest/v1/rpc/delete_my_account", { method: "POST", body: {} }); save(null); },
    async posts({ board, sort = "latest", q, author, offset = 0, limit = 20 } = {}) {
      const f = [];
      if (board) f.push(`board=eq.${q_(board)}`);
      if (author) f.push(`username=eq.${q_(author)}`);
      const term = (q || "").replace(/[,()*"\%]/g, " ").trim().slice(0, 60);
      if (term) f.push(`or=(title.ilike.*${q_(term)}*,body.ilike.*${q_(term)}*)`);
      const ord = sort === "top" ? "like_count.desc,created_at.desc" : "created_at.desc";
      const rows = await raw(`/rest/v1/posts_feed?${f.join("&")}&order=${ord}&limit=${limit}&offset=${offset}`);
      return withLiked(rows);
    },
    async post(id) { const rows = await withLiked(await raw(`/rest/v1/posts_feed?id=eq.${+id}`)); return rows[0] || null; },
    async texts() { return raw("/rest/v1/posts_feed?select=title,body&order=created_at.desc&limit=200"); },
    async createPost(board, title, body) { const r = await raw("/rest/v1/posts", { method: "POST", body: { board, title, body }, prefer: "return=representation" }); return r && r[0] && r[0].id; },
    async report(type, id, reason) { try { await raw("/rest/v1/reports", { method: "POST", body: { target_type: type, target_id: id, reason: reason || null }, prefer: "return=minimal" }); } catch (e) { if (e.code === "taken" || /duplicate|23505/.test(e.message)) throw fail("reportedAlready"); throw e; } },
    deletePost: id => raw(`/rest/v1/posts?id=eq.${id}`, { method: "DELETE" }),
    comments: id => raw(`/rest/v1/comments_feed?post_id=eq.${id}&order=created_at.asc&limit=200`),
    createComment: (post_id, body) => raw("/rest/v1/comments", { method: "POST", body: { post_id, body }, prefer: "return=minimal" }),
    deleteComment: id => raw(`/rest/v1/comments?id=eq.${id}`, { method: "DELETE" }),
    async toggleLike(id, liked) {
      if (liked) await raw(`/rest/v1/likes?post_id=eq.${id}&user_id=eq.${sess.user.id}`, { method: "DELETE" });
      else await raw("/rest/v1/likes", { method: "POST", body: { post_id: id }, prefer: "return=minimal" });
    }
  };
  return api;
}

/* ---------------- 데모(localStorage) ---------------- */
function demo() {
  const K = "dz_demo";
  const db = () => rd(K) || { users: {}, posts: [], comments: [], likes: [], seq: 1, session: null };
  const put = d => wr(K, d);
  const hash = async (id, pw) => { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id.toLowerCase() + ":" + pw)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); };
  const me = () => { const d = db(); return d.session && d.users[d.session] ? { id: d.session, username: d.users[d.session].username, needsUsername: false } : null; };
  const need = () => { const u = me(); if (!u) throw fail("auth"); return u; };
  return {
    live: false,
    user: me,
    ready: Promise.resolve(),
    googleUrl: () => { throw fail("demo"); },
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
    async setUsername() { throw fail("demo"); },
    async deleteAccount() {
      const u = need(), d = db(); delete d.users[u.id]; d.posts = d.posts.filter(p => p.author !== u.id); d.comments = d.comments.filter(c => c.author !== u.id); d.likes = d.likes.filter(l => l.user_id !== u.id); d.session = null; put(d);
    },
    async posts({ board, sort = "latest", q, author, offset = 0, limit = 20 } = {}) {
      const d = db(), u = me(), t = (q || "").toLowerCase();
      let rows = d.posts.filter(p => (!board || p.board === board) && (!author || p.username.toLowerCase() === author.toLowerCase()) && (!t || (p.title + " " + p.body).toLowerCase().includes(t))).map(p => ({
        ...p, like_count: d.likes.filter(l => l.post_id === p.id).length,
        comment_count: d.comments.filter(c => c.post_id === p.id).length,
        liked: !!u && d.likes.some(l => l.post_id === p.id && l.user_id === u.id)
      }));
      rows.sort((a, b) => sort === "top" ? (b.like_count - a.like_count) || (b.id - a.id) : b.id - a.id);
      return rows.slice(offset, offset + limit);
    },
    async post(id) { return (await this.posts({ limit: 1e6 })).find(p => p.id === +id) || null; },
    async texts() { return db().posts.slice(-200).map(p => ({ title: p.title, body: p.body })); },
    async createPost(board, title, body) { const u = need(), d = db(), id = d.seq++; d.posts.push({ id, board, title, body, author: u.id, username: u.username, created_at: new Date().toISOString() }); put(d); return id; },
    async report() { need(); },
    async deletePost(id) { const u = need(), d = db(); d.posts = d.posts.filter(p => !(p.id === id && p.author === u.id)); d.comments = d.comments.filter(c => c.post_id !== id); d.likes = d.likes.filter(l => l.post_id !== id); put(d); },
    async comments(id) { return db().comments.filter(c => c.post_id === id); },
    async createComment(post_id, body) { const u = need(), d = db(); d.comments.push({ id: d.seq++, post_id, body, author: u.id, username: u.username, created_at: new Date().toISOString() }); put(d); },
    async deleteComment(id) { const u = need(), d = db(); d.comments = d.comments.filter(c => !(c.id === id && c.author === u.id)); put(d); },
    async toggleLike(id, liked) { const u = need(), d = db(); d.likes = d.likes.filter(l => !(l.post_id === id && l.user_id === u.id)); if (!liked) d.likes.push({ post_id: id, user_id: u.id }); put(d); }
  };
}

window.DZB = Object.assign(live ? supabase() : demo(), { BOARDS, ID_RE });
})();
