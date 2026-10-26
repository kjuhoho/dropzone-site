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
      else if (/new_account_limit/.test(msg)) code = "newAccount";
      else if (/track_limit/.test(msg)) code = "trackLimit";
      else if (/bad_links|bad_path/.test(msg)) code = msg.match(/bad_links|bad_path/)[0];
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
      const [p] = await raw(`/rest/v1/profiles?id=eq.${sess.user.id}&select=username,needs_username,accent,avatar_path`);
      if (p && sess) {
        let adm = false; try { adm = (await raw("/rest/v1/rpc/is_admin", { method: "POST", body: {} })) === true; } catch {}
        let ban = null; try { ban = await raw("/rest/v1/rpc/my_ban", { method: "POST", body: {} }); } catch {}
        save({ ...sess, user: { ...sess.user, username: p.username, needsUsername: !!p.needs_username, isAdmin: adm, ban: ban || null, accent: p.accent == null ? null : p.accent, avatar_path: p.avatar_path || null } });
      }
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
  const PATH_RE = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/;
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
    async deleteAccount() {
      try {
        const uid = sess.user.id, t = await token();
        const r = await fetch(`${C.supabaseUrl}/storage/v1/object/list/community`, { method: "POST", headers: { apikey: C.supabaseKey, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: uid, limit: 1000 }) });
        const items = r.ok ? await r.json() : [];
        await api.removeFiles(items.map(o => `${uid}/${o.name}`));
      } catch {}
      await raw("/rest/v1/rpc/delete_my_account", { method: "POST", body: {} }); save(null);
    },
    fileUrl: p => PATH_RE.test(p || "") ? `${C.supabaseUrl}/storage/v1/object/public/community/${p}` : null,
    async upload(file) {
      const t = await token(); if (!t) throw fail("auth");
      const ext = ((file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)) || "bin";
      const path = `${sess.user.id}/${crypto.randomUUID()}.${ext}`;
      const r = await fetch(`${C.supabaseUrl}/storage/v1/object/community/${path}`, { method: "POST", headers: { apikey: C.supabaseKey, Authorization: "Bearer " + t, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false", "cache-control": "max-age=31536000" }, body: file });
      if (!r.ok) {
        let j = null; try { j = await r.json(); } catch {}
        const m = (j && (j.message || j.error)) || r.statusText;
        throw fail(/exceed|too large|size/i.test(m) ? "fileBig" : /mime|type/i.test(m) ? "fileBad" : /row-level|polic|violat/i.test(m) ? "daily" : "generic", m);
      }
      return path;
    },
    async removeFiles(paths) { const ps = (paths || []).filter(p => PATH_RE.test(p || "")); if (!ps.length) return; try { await raw("/storage/v1/object/community", { method: "DELETE", body: { prefixes: ps } }); } catch {} },
    reports: () => raw("/rest/v1/reports_feed?order=created_at.desc&limit=100"),
    bans: () => raw("/rest/v1/bans_feed?order=created_at.desc&limit=100"),
    adminBan: (uid, days, why) => raw("/rest/v1/rpc/admin_ban", { method: "POST", body: { target: uid, days: days || null, why: why || null } }),
    adminUnban: uid => raw("/rest/v1/rpc/admin_unban", { method: "POST", body: { target: uid } }),
    async profileOf(name) { const r = await raw(`/rest/v1/profile_stats?username=eq.${q_(name)}&limit=1`); return r[0] || null; },
    async isFollowing(id) { if (!sess) return false; const r = await raw(`/rest/v1/follows?follower=eq.${sess.user.id}&followee=eq.${q_(id)}&select=followee`); return r.length > 0; },
    follow: id => raw("/rest/v1/follows", { method: "POST", body: { followee: id }, prefer: "return=minimal" }),
    unfollow: id => raw(`/rest/v1/follows?follower=eq.${sess.user.id}&followee=eq.${q_(id)}`, { method: "DELETE" }),
    async followingIds() { if (!sess) return []; return (await raw(`/rest/v1/follows?follower=eq.${sess.user.id}&select=followee&limit=500`)).map(x => x.followee); },
    async updateProfile(f) { await raw(`/rest/v1/profiles?id=eq.${sess.user.id}`, { method: "PATCH", body: { bio: f.bio || null, accent: f.accent == null ? null : f.accent, avatar_path: f.avatar_path || null, banner_path: f.banner_path || null, banner_style: f.banner_style == null ? null : f.banner_style, links: f.links || {} }, prefer: "return=minimal" }); await profile(); },
    tracksOf: id => raw(`/rest/v1/tracks_feed?owner=eq.${q_(id)}&order=created_at.desc&limit=20`),
    latestTracks: ({ offset = 0, limit = 30 } = {}) => raw(`/rest/v1/tracks_feed?order=created_at.desc&limit=${limit}&offset=${offset}`),
    addTrack: t => raw("/rest/v1/profile_tracks", { method: "POST", body: { title: t.title, genre: t.genre || null, audio_path: t.audio_path, cover_path: t.cover_path || null }, prefer: "return=minimal" }),
    deleteTrack: id => raw(`/rest/v1/profile_tracks?id=eq.${+id}`, { method: "DELETE" }),
    notifications: () => raw("/rest/v1/notifications_feed?order=created_at.desc&limit=50"),
    async unreadCount() { if (!sess) return 0; return (await raw("/rest/v1/notifications_feed?read=eq.false&select=id&limit=100")).length; },
    markAllRead: () => raw("/rest/v1/notifications?read=eq.false", { method: "PATCH", body: { read: true }, prefer: "return=minimal" }),
    logEvent(t, k, src, lang) { try { fetch(`${C.supabaseUrl}/rest/v1/rpc/log_event`, { method: "POST", keepalive: true, headers: { apikey: C.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify({ t, k, s: src || "", l: lang || "" }) }).catch(() => {}); } catch {} },
    async stats() {
      const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const [events, members, posts] = await Promise.all([
        raw(`/rest/v1/event_counts?day=gte.${since}&limit=3000`),
        raw(`/rest/v1/profiles?select=created_at&created_at=gte.${since}&limit=2000`),
        raw(`/rest/v1/posts_feed?select=created_at&created_at=gte.${since}&limit=2000`)]);
      return { events, members, posts };
    },
    unhide: (type, id) => raw(`/rest/v1/${type === "post" ? "posts" : type === "track" ? "profile_tracks" : "comments"}?id=eq.${+id}`, { method: "PATCH", body: { hidden: false }, prefer: "return=minimal" }),
    dismissReport: id => raw(`/rest/v1/reports?id=eq.${+id}`, { method: "DELETE" }),
    deleteReportsFor: (type, id) => raw(`/rest/v1/reports?target_type=eq.${q_(type)}&target_id=eq.${+id}`, { method: "DELETE" }),
    async posts({ board, sort = "latest", q, author, authors, offset = 0, limit = 20 } = {}) {
      const f = [];
      if (authors) { if (!authors.length) return []; f.push(`author=in.(${authors.join(",")})`); }
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
    async createPost(board, title, body, attachments = []) { const r = await raw("/rest/v1/posts", { method: "POST", body: { board, title, body, attachments }, prefer: "return=representation" }); return r && r[0] && r[0].id; },
    async report(type, id, reason) { try { await raw("/rest/v1/reports", { method: "POST", body: { target_type: type, target_id: id, reason: reason || null }, prefer: "return=minimal" }); } catch (e) { if (e.code === "taken" || /duplicate|23505/.test(e.message)) throw fail("reportedAlready"); if (e.code === "42501") throw fail("reportAge"); throw e; } },
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
  const me = () => { const d = db(); return d.session && d.users[d.session] ? { id: d.session, username: d.users[d.session].username, needsUsername: false, accent: d.users[d.session].accent == null ? null : d.users[d.session].accent, avatar_path: d.users[d.session].avatar_path || null, isAdmin: d.users[d.session].username === "admin", ban: (d.bans || {})[d.session] || null } : null; };
  const need = () => { const u = me(); if (!u) throw fail("auth"); return u; };
  return {
    live: false,
    user: me,
    ready: Promise.resolve(),
    googleUrl: () => { throw fail("demo"); },
    async signUp(id, pw) {
      const d = db(), k = id.toLowerCase();
      if (d.users[k]) throw fail("taken");
      d.users[k] = { username: id, hash: await hash(id, pw), at: new Date().toISOString() }; d.session = k; put(d);
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
    async posts({ board, sort = "latest", q, author, authors, offset = 0, limit = 20 } = {}) {
      const d = db(), u = me(), t = (q || "").toLowerCase();
      let rows = d.posts.filter(p => (!board || p.board === board) && (!authors || authors.includes(p.author)) && (!author || p.username.toLowerCase() === author.toLowerCase()) && (!t || (p.title + " " + p.body).toLowerCase().includes(t))).map(p => ({
        ...p, like_count: d.likes.filter(l => l.post_id === p.id).length,
        comment_count: d.comments.filter(c => c.post_id === p.id).length,
        liked: !!u && d.likes.some(l => l.post_id === p.id && l.user_id === u.id)
      }));
      rows.sort((a, b) => sort === "top" ? (b.like_count - a.like_count) || (b.id - a.id) : b.id - a.id);
      return rows.slice(offset, offset + limit);
    },
    async post(id) { return (await this.posts({ limit: 1e6 })).find(p => p.id === +id) || null; },
    async texts() { return db().posts.slice(-200).map(p => ({ title: p.title, body: p.body })); },
    async createPost(board, title, body, attachments = []) { const u = need(); if (u.ban) throw fail("banned"); const d = db(), id = d.seq++; d.posts.push({ id, board, title, body, attachments, author: u.id, username: u.username, created_at: new Date().toISOString() }); put(d); return id; },
    fileUrl: p => typeof p === "string" && p.startsWith("data:") ? p : null,
    async upload(file) {
      if (file.size > 1.5e6) throw fail("demoFile");
      return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    },
    async removeFiles() {},
    async report(type, id, reason) { const u = need(), d = db(); d.reports = d.reports || []; if (d.reports.some(r => r.reporter === u.id && r.target_type === type && r.target_id === id)) throw fail("reportedAlready"); d.reports.push({ id: d.seq++, reporter: u.id, reporter_name: u.username, target_type: type, target_id: id, reason: reason || null, created_at: new Date().toISOString() }); put(d); },
    async reports() {
      const u = need(); if (!u.isAdmin) return []; const d = db();
      return (d.reports || []).slice().reverse().map(r => { const c = r.target_type === "comment" ? d.comments.find(x => x.id === r.target_id) : null, p = r.target_type === "post" ? d.posts.find(x => x.id === r.target_id) : null, tk = r.target_type === "track" ? (d.tracks || []).find(x => x.id === r.target_id) : null;
        const t = p || c || (tk && { author: tk.owner, username: tk.username, hidden: tk.hidden }); return { ...r, preview: p ? (p.title + " — " + p.body).slice(0, 300) : c ? c.body.slice(0, 300) : tk ? tk.title : null, attachments: p ? p.attachments || [] : tk ? [{ p: tk.audio_path }] : null, post_id: c ? c.post_id : r.target_id, target_author: t ? t.author : null, target_author_name: t ? t.username : null, target_hidden: !!(t && t.hidden) }; });
    },
    async dismissReport(id) { const u = need(); if (!u.isAdmin) return; const d = db(); d.reports = (d.reports || []).filter(r => r.id !== id); put(d); },
    async deleteReportsFor(type, id) { const u = need(); if (!u.isAdmin) return; const d = db(); d.reports = (d.reports || []).filter(r => !(r.target_type === type && r.target_id === id)); put(d); },
    async bans() { const u = need(); if (!u.isAdmin) return []; const d = db(); return Object.entries(d.bans || {}).map(([k, b]) => ({ user_id: k, username: d.users[k] ? d.users[k].username : k, until: b.until, reason: b.reason, created_at: b.at })); },
    async adminBan(uid, days, why) { const u = need(); if (!u.isAdmin) return; const d = db(); d.bans = d.bans || {}; d.bans[uid] = { until: days ? new Date(Date.now() + days * 864e5).toISOString() : null, reason: why || null, at: new Date().toISOString() }; put(d); },
    async adminUnban(uid) { const u = need(); if (!u.isAdmin) return; const d = db(); if (d.bans) delete d.bans[uid]; put(d); },
    async unhide(type, id) { const u = need(); if (!u.isAdmin) return; const d = db(), row = (type === "post" ? d.posts : d.comments).find(x => x.id === id); if (row) row.hidden = false; put(d); },
    async deletePost(id) { const u = need(), d = db(); d.posts = d.posts.filter(p => !(p.id === id && (p.author === u.id || u.isAdmin))); d.comments = d.comments.filter(c => c.post_id !== id); d.likes = d.likes.filter(l => l.post_id !== id); put(d); },
    async comments(id) { return db().comments.filter(c => c.post_id === id); },
    async createComment(post_id, body) { const u = need(), d = db(); d.comments.push({ id: d.seq++, post_id, body, author: u.id, username: u.username, created_at: new Date().toISOString() }); const po = d.posts.find(x => x.id === post_id); if (po && po.author !== u.id) (d.notifs = d.notifs || []).push({ id: d.seq++, user_id: po.author, type: "comment", post_id, actor_name: u.username, post_title: po.title, created_at: new Date().toISOString(), read: false }); put(d); },
    async deleteComment(id) { const u = need(), d = db(); d.comments = d.comments.filter(c => !(c.id === id && (c.author === u.id || u.isAdmin))); put(d); },
    async toggleLike(id, liked) { const u = need(), d = db(); d.likes = d.likes.filter(l => !(l.post_id === id && l.user_id === u.id)); if (!liked) { d.likes.push({ post_id: id, user_id: u.id }); const po = d.posts.find(x => x.id === id); if (po && po.author !== u.id) (d.notifs = d.notifs || []).push({ id: d.seq++, user_id: po.author, type: "like", post_id: id, actor_name: u.username, post_title: po.title, created_at: new Date().toISOString(), read: false }); } put(d); },
    async profileOf(name) { const d = db(), k = name.toLowerCase(), u = d.users[k]; if (!u) return null; return { id: k, username: u.username, bio: u.bio || null, accent: u.accent == null ? null : u.accent, created_at: u.at || new Date().toISOString(), posts_count: d.posts.filter(p => p.author === k).length, followers: (d.follows || []).filter(f => f[1] === k).length, following: (d.follows || []).filter(f => f[0] === k).length, avatar_path: u.avatar_path || null, banner_path: u.banner_path || null, banner_style: u.banner_style == null ? null : u.banner_style, links: u.links || {}, tracks_count: (d.tracks || []).filter(t => t.owner === k).length }; },
    async isFollowing(id) { const u = me(); return !!u && (db().follows || []).some(f => f[0] === u.id && f[1] === id); },
    async follow(id) { const u = need(), d = db(); d.follows = d.follows || []; if (!d.follows.some(f => f[0] === u.id && f[1] === id)) { d.follows.push([u.id, id]); (d.notifs = d.notifs || []).push({ id: d.seq++, user_id: id, type: "follow", post_id: null, actor_name: u.username, post_title: null, created_at: new Date().toISOString(), read: false }); } put(d); },
    async unfollow(id) { const u = need(), d = db(); d.follows = (d.follows || []).filter(f => !(f[0] === u.id && f[1] === id)); put(d); },
    async followingIds() { const u = me(); return u ? (db().follows || []).filter(f => f[0] === u.id).map(f => f[1]) : []; },
    async updateProfile(f) { const u = need(), d = db(), x = d.users[u.id]; x.bio = f.bio || null; x.accent = f.accent == null ? null : f.accent; x.avatar_path = f.avatar_path || null; x.banner_path = f.banner_path || null; x.banner_style = f.banner_style == null ? null : f.banner_style; x.links = f.links || {}; put(d); },
    async tracksOf(id) { return (db().tracks || []).filter(t => t.owner === id).slice().reverse(); },
    async latestTracks() { return (db().tracks || []).slice().reverse(); },
    async addTrack(t) { const u = need(), d = db(); d.tracks = d.tracks || []; if (d.tracks.filter(x => x.owner === u.id).length >= 5) throw fail("trackLimit"); d.tracks.push({ id: d.seq++, owner: u.id, username: u.username, accent: u.accent, avatar_path: u.avatar_path, title: t.title, genre: t.genre || null, audio_path: t.audio_path, cover_path: t.cover_path || null, hidden: false, created_at: new Date().toISOString() }); put(d); },
    async deleteTrack(id) { const u = need(), d = db(); d.tracks = (d.tracks || []).filter(t => !(t.id === id && (t.owner === u.id || u.isAdmin))); put(d); },
    async notifications() { const u = me(); return u ? (db().notifs || []).filter(n => n.user_id === u.id).slice().reverse() : []; },
    async unreadCount() { const u = me(); return u ? (db().notifs || []).filter(n => n.user_id === u.id && !n.read).length : 0; },
    async markAllRead() { const u = need(), d = db(); (d.notifs || []).forEach(n => { if (n.user_id === u.id) n.read = true; }); put(d); },
    logEvent() {},
    async stats() { return { events: [], members: [], posts: [] }; }
  };
}

window.DZB = Object.assign(live ? supabase() : demo(), { BOARDS, ID_RE });
})();
