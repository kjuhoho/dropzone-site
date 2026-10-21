// 모든 페이지 공통: 다국어, 토스트, 로그인/회원가입 UI.  window.DZ
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DZ = window.DZ = { $, esc, lang: "en", I: null, titleKey: "tagline", _l: [], _a: [] };
const B = () => window.DZB;

DZ.T = (k, vars) => {
  let s = (DZ.I.strings[DZ.lang] && DZ.I.strings[DZ.lang][k]) || DZ.I.strings.en[k] || k;
  if (vars) for (const v in vars) s = s.split("{" + v + "}").join(vars[v]);
  return s;
};
DZ.toast = m => { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(DZ.toast.t); DZ.toast.t = setTimeout(() => t.classList.remove("show"), 2200); };
DZ.onLang = fn => DZ._l.push(fn);
DZ.onAuth = fn => DZ._a.push(fn);
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
  document.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", DZ.T(el.dataset.i18nAria)));
  document.querySelectorAll("[data-i18n-ph]").forEach(el => el.setAttribute("placeholder", DZ.T(el.dataset.i18nPh)));
  renderAuthBar(); renderDialogText();
  DZ._l.forEach(f => f());
}
DZ.setLang = l => { DZ.lang = l; try { localStorage.setItem("lang", l); } catch {} applyLang(); };

/* ---------- 로그인 UI ---------- */
let mode = "login";
function renderAuthBar() {
  const u = B().user(), bar = $("authBar");
  bar.innerHTML = u
    ? `<span class="me">@${esc(u.username)}</span><button class="chip-btn" id="logoutBtn">${esc(DZ.T("auth.logout"))}</button>`
    : `<button class="chip-btn strong" id="loginBtn">${esc(DZ.T("auth.login"))}</button>`;
  const lo = $("logoutBtn"), li = $("loginBtn");
  if (lo) lo.onclick = async () => { await B().signOut(); renderAuthBar(); DZ._a.forEach(f => f()); };
  if (li) li.onclick = () => DZ.openAuth("login");
}
function renderDialogText() {
  const su = mode === "signup";
  $("aTitle").textContent = DZ.T(su ? "auth.signup" : "auth.login");
  $("aSubmit").textContent = DZ.T(su ? "auth.signup" : "auth.login");
  $("aSwitch").textContent = DZ.T(su ? "auth.toLogin" : "auth.toSignup");
  $("aSignupOnly").hidden = !su;
  $("aPw").autocomplete = su ? "new-password" : "current-password";
}
DZ.openAuth = m => { mode = m || "login"; $("aErr").textContent = ""; renderDialogText(); const d = $("authDlg"); if (!d.open) d.showModal(); $("aId").focus(); };

function buildDialog() {
  const d = document.createElement("dialog"); d.id = "authDlg";
  d.innerHTML = `<form id="aForm" novalidate>
    <button type="button" class="x" id="aClose" data-i18n-aria="auth.close">×</button>
    <h3 id="aTitle"></h3>
    <label><span data-i18n="auth.id"></span><input id="aId" autocomplete="username" maxlength="20" autocapitalize="none" spellcheck="false"></label>
    <small data-i18n="auth.idHint"></small>
    <label><span data-i18n="auth.pw"></span><input id="aPw" type="password" maxlength="72"></label>
    <small data-i18n="auth.pwHint"></small>
    <label class="show"><input type="checkbox" id="aShow"> <span data-i18n="auth.show"></span></label>
    <p class="err" id="aErr" role="alert"></p>
    <button class="cta" id="aSubmit" type="submit"></button>
    <button type="button" class="linkish" id="aSwitch"></button>
    <p class="fine" data-i18n="auth.noPII"></p>
    <p class="fine warn" id="aSignupOnly" data-i18n="auth.noRecovery"></p>
  </form>`;
  document.body.appendChild(d);
  $("aClose").onclick = () => d.close();
  d.addEventListener("click", e => { if (e.target === d) d.close(); });
  $("aShow").onchange = e => $("aPw").type = e.target.checked ? "text" : "password";
  $("aSwitch").onclick = () => { mode = mode === "login" ? "signup" : "login"; $("aErr").textContent = ""; renderDialogText(); };
  $("aForm").onsubmit = async e => {
    e.preventDefault();
    const id = $("aId").value.trim(), pw = $("aPw").value, err = m => $("aErr").textContent = m;
    if (!B().ID_RE.test(id)) return err(DZ.T("err.idFormat"));
    if (pw.length < 8) return err(DZ.T("err.pwShort"));
    $("aSubmit").disabled = true;
    try { await (mode === "signup" ? B().signUp(id, pw) : B().signIn(id, pw)); d.close(); $("aPw").value = ""; renderAuthBar(); DZ._a.forEach(f => f()); }
    catch (ex) { err(DZ.errText(ex)); }
    finally { $("aSubmit").disabled = false; }
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
  buildDialog();
  applyLang();
};
DZ.applyLang = applyLang;
})();
