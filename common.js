// 모든 페이지 공통: 다국어, 토스트, 로그인/회원가입/계정 UI.  window.DZ
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CFG = window.DZ_CONFIG || {};
const DZ = window.DZ = { $, esc, lang: "en", I: null, titleKey: "tagline", _l: [], _a: [] };
const B = () => window.DZB;

DZ.T = (k, vars) => {
  let s = (DZ.I.strings[DZ.lang] && DZ.I.strings[DZ.lang][k]) || DZ.I.strings.en[k] || k;
  if (vars) for (const v in vars) s = s.split("{" + v + "}").join(vars[v]);
  return s;
};
DZ.toast = m => { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(DZ.toast.t); DZ.toast.t = setTimeout(() => t.classList.remove("show"), 2600); };
DZ.onLang = fn => DZ._l.push(fn);
DZ.onAuth = fn => DZ._a.push(fn);
const fireAuth = () => { renderAuthBar(); DZ._a.forEach(f => f()); checkNick(); };
DZ.ago = iso => {
  const s = (new Date(iso) - Date.now()) / 1000, r = new Intl.RelativeTimeFormat(DZ.lang, { numeric: "auto" });
  for (const [u, n] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]]) if (Math.abs(s) >= n) return r.format(Math.round(s / n), u);
  return r.format(0, "second");
};
DZ.errText = e => { const k = "err." + (e && e.code); return DZ.I.strings.en[k] ? DZ.T(k) : DZ.T("err.generic"); };

function applyLang() {
  document.documentElement.lang = DZ.lang;
  document.title = $("siteName").textContent + " — " + DZ.T(DZ.titleKey);
  document.querySelectorAll("[data-i18n]").forEach(el => el.textContent = DZ.T(el.dataset.i18n));
  document.querySelectorAll("[data-i18n-html]").forEach(el => el.innerHTML = DZ.T(el.dataset.i18nHtml)); // 신뢰된 i18n.json 문자열만
  document.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", DZ.T(el.dataset.i18nAria)));
  document.querySelectorAll("[data-i18n-ph]").forEach(el => el.setAttribute("placeholder", DZ.T(el.dataset.i18nPh)));
  renderAuthBar(); renderDialogText(); renderAcct();
  DZ._l.forEach(f => f());
}
DZ.setLang = l => { DZ.lang = l; try { localStorage.setItem("lang", l); } catch {} applyLang(); };

/* ---------- Turnstile (봇 차단, config.turnstileSiteKey 가 있을 때만) ---------- */
let capTok = null, capId = null, capLoading = false;
function renderCaptcha() {
  const box = $("aCaptcha"), key = CFG.turnstileSiteKey;
  box.hidden = !key; if (!key) return;
  const go = () => {
    if (capId !== null) { window.turnstile.reset(capId); capTok = null; return; }
    capId = window.turnstile.render(box, { sitekey: key, theme: "dark", callback: t => { capTok = t; }, "expired-callback": () => { capTok = null; }, "error-callback": () => { capTok = null; } });
  };
  if (window.turnstile) go();
  else if (!capLoading) { capLoading = true; const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = go; document.head.appendChild(s); }
}
const resetCaptcha = () => { capTok = null; if (capId !== null && window.turnstile) window.turnstile.reset(capId); };

/* ---------- 로그인 / 가입 ---------- */
let mode = "login";
function renderAuthBar() {
  const u = B().user(), bar = $("authBar");
  bar.innerHTML = u
    ? `<button class="chip-btn me-btn" id="meBtn" aria-label="${esc(DZ.T("acct.title"))}">@${esc(u.username || "…")}</button>`
    : `<button class="chip-btn strong" id="loginBtn">${esc(DZ.T("auth.login"))}</button>`;
  const me = $("meBtn"), li = $("loginBtn");
  if (me) me.onclick = () => { renderAcct(); $("acctDlg").showModal(); };
  if (li) li.onclick = () => DZ.openAuth("login");
}
function renderDialogText() {
  const su = mode === "signup";
  $("aTitle").textContent = DZ.T(su ? "auth.signup" : "auth.login");
  $("aSubmit").textContent = DZ.T(su ? "auth.signup" : "auth.login");
  $("aSwitch").textContent = DZ.T(su ? "auth.toLogin" : "auth.toSignup");
  $("aSignupOnly").hidden = !su; $("aConsent").hidden = !su;
  $("aPw").autocomplete = su ? "new-password" : "current-password";
  $("aGoogleBox").hidden = !CFG.googleLogin;
}
DZ.openAuth = m => { mode = m || "login"; $("aErr").textContent = ""; renderDialogText(); renderCaptcha(); const d = $("authDlg"); if (!d.open) d.showModal(); $("aId").focus(); };

/* ---------- 계정 / 닉네임 ---------- */
function renderAcct() {
  const u = B().user(); if (!u) return;
  $("acctName").textContent = "@" + (u.username || "");
}
let nickAsked = false;
function checkNick() {
  const u = B().user();
  if (u && u.needsUsername && !nickAsked && !$("nickDlg").open) { nickAsked = true; $("nErr").textContent = ""; $("nId").value = ""; $("nickDlg").showModal(); }
}

function buildDialogs() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <dialog id="authDlg"><form id="aForm" novalidate>
    <button type="button" class="x" id="aClose" data-i18n-aria="auth.close">×</button>
    <h3 id="aTitle"></h3>
    <div id="aGoogleBox" hidden>
      <button type="button" class="google-btn" id="aGoogle"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg><span data-i18n="auth.google"></span></button>
      <div class="or"><span data-i18n="auth.or"></span></div>
    </div>
    <label><span data-i18n="auth.id"></span><input id="aId" autocomplete="username" maxlength="20" autocapitalize="none" spellcheck="false"></label>
    <small data-i18n="auth.idHint"></small>
    <label><span data-i18n="auth.pw"></span><input id="aPw" type="password" maxlength="72"></label>
    <small data-i18n="auth.pwHint"></small>
    <label class="show"><input type="checkbox" id="aShow"> <span data-i18n="auth.show"></span></label>
    <label class="show" id="aConsent"><input type="checkbox" id="aAgree"> <span data-i18n-html="auth.agree"></span></label>
    <div id="aCaptcha" hidden></div>
    <p class="err" id="aErr" role="alert"></p>
    <button class="cta" id="aSubmit" type="submit"></button>
    <button type="button" class="linkish" id="aSwitch"></button>
    <p class="fine" data-i18n="auth.noPII"></p>
    <p class="fine warn" id="aSignupOnly" data-i18n="auth.noRecovery"></p>
  </form></dialog>

  <dialog id="nickDlg"><form id="nForm" novalidate>
    <button type="button" class="x" id="nClose" data-i18n-aria="auth.close">×</button>
    <h3 data-i18n="nick.title"></h3>
    <p class="fine" data-i18n="nick.text"></p>
    <input id="nId" maxlength="20" autocapitalize="none" spellcheck="false" aria-label="ID">
    <p class="err" id="nErr" role="alert"></p>
    <button class="cta" type="submit" data-i18n="nick.save"></button>
    <button type="button" class="linkish" id="nLater" data-i18n="nick.later"></button>
  </form></dialog>

  <dialog id="acctDlg"><form id="acForm" novalidate>
    <button type="button" class="x" id="acClose" data-i18n-aria="auth.close">×</button>
    <h3 data-i18n="acct.title"></h3>
    <p class="acct-name" id="acctName"></p>
    <button type="button" class="chip-btn" id="acLogout" data-i18n="auth.logout"></button>
    <hr>
    <b class="danger" data-i18n="acct.delete"></b>
    <p class="fine" data-i18n="acct.warn"></p>
    <input id="acConfirm" autocapitalize="none" spellcheck="false" data-i18n-ph="acct.typeId" aria-label="ID">
    <p class="err" id="acErr" role="alert"></p>
    <button type="submit" class="danger-btn" data-i18n="acct.deleteBtn"></button>
  </form></dialog>`;
  document.body.append(...wrap.children);
  const authDlg = $("authDlg"), nickDlg = $("nickDlg"), acctDlg = $("acctDlg");
  for (const d of [authDlg, nickDlg, acctDlg]) d.addEventListener("click", e => { if (e.target === d) d.close(); });
  $("aClose").onclick = () => authDlg.close(); $("nClose").onclick = $("nLater").onclick = () => nickDlg.close(); $("acClose").onclick = () => acctDlg.close();
  $("aShow").onchange = e => $("aPw").type = e.target.checked ? "text" : "password";
  $("aSwitch").onclick = () => { mode = mode === "login" ? "signup" : "login"; $("aErr").textContent = ""; renderDialogText(); };
  $("aGoogle").onclick = () => { try { location.href = B().googleUrl(); } catch (e) { $("aErr").textContent = DZ.errText(e); } };

  $("aForm").onsubmit = async e => {
    e.preventDefault();
    const id = $("aId").value.trim(), pw = $("aPw").value, err = m => $("aErr").textContent = m, su = mode === "signup";
    if (!B().ID_RE.test(id)) return err(DZ.T("err.idFormat"));
    if (pw.length < 8) return err(DZ.T("err.pwShort"));
    if (su && !$("aAgree").checked) return err(DZ.T("err.consent"));
    if (CFG.turnstileSiteKey && !capTok) return err(DZ.T("err.captcha"));
    $("aSubmit").disabled = true;
    try { await (su ? B().signUp(id, pw, capTok) : B().signIn(id, pw, capTok)); authDlg.close(); $("aPw").value = ""; fireAuth(); }
    catch (ex) { err(DZ.errText(ex)); }
    finally { $("aSubmit").disabled = false; resetCaptcha(); }
  };
  $("nForm").onsubmit = async e => {
    e.preventDefault();
    const n = $("nId").value.trim();
    if (!B().ID_RE.test(n)) return $("nErr").textContent = DZ.T("err.idFormat");
    try { await B().setUsername(n); nickDlg.close(); DZ.toast(DZ.T("nick.saved")); renderAuthBar(); DZ._a.forEach(f => f()); }
    catch (ex) { $("nErr").textContent = DZ.errText(ex); }
  };
  $("acLogout").onclick = async () => { await B().signOut(); acctDlg.close(); nickAsked = false; fireAuth(); };
  $("acForm").onsubmit = async e => {
    e.preventDefault();
    const u = B().user(); if (!u) return;
    if ($("acConfirm").value.trim().toLowerCase() !== (u.username || "").toLowerCase()) return $("acErr").textContent = DZ.T("acct.mismatch");
    try { await B().deleteAccount(); acctDlg.close(); $("acConfirm").value = ""; $("acErr").textContent = ""; nickAsked = false; fireAuth(); DZ.toast(DZ.T("acct.deleted")); }
    catch (ex) { $("acErr").textContent = DZ.errText(ex); }
  };
}

DZ.init = async () => {
  DZ.I = await fetch("data/i18n.json").then(r => r.json());
  let l = null; try { l = new URLSearchParams(location.search).get("lang") || localStorage.getItem("lang"); } catch {}
  DZ.lang = DZ.I.languages[l] ? l : "en";
  const sel = $("lang");
  sel.innerHTML = Object.entries(DZ.I.languages).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("");
  sel.value = DZ.lang; sel.onchange = e => DZ.setLang(e.target.value);
  $("yr").textContent = new Date().getFullYear();
  buildDialogs();
  await B().ready;
  applyLang(); checkNick();
};
DZ.applyLang = applyLang;
})();
