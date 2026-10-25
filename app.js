(() => {
const $ = id => document.getElementById(id);
const fmt = s => isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";
const audio = new Audio(); audio.preload = "metadata";
let tracks = [], shorts = [], cur = -1, ctx, analyser, buf, mood = "all", moodKeys = [], producer = {};
const T = (k, v) => DZ.T(k, v), toast = m => DZ.toast(m);

const trackUrl = t => location.origin + location.pathname.replace(/[^/]*$/, "") + "t/" + t.slug + ".html";
const siteBase = () => location.origin + location.pathname.replace(/[^/]*$/, "");
const PULSE_LAB = "https://kjuhoho.github.io/pulse-lab/";
const gameUrl = t => PULSE_LAB + "?src=" + encodeURIComponent(siteBase() + t.audio) + "&title=" + encodeURIComponent(t.title + " — ARUGA") + "&cover=" + encodeURIComponent(siteBase() + t.cover) + "&back=" + encodeURIComponent(location.origin + location.pathname);

async function init() {
  await DZ.init();
  const [tj, sj] = await Promise.all(["tracks", "shorts"].map(n => fetch(`data/${n}.json`).then(r => r.json())));
  tracks = tj.tracks; shorts = sj.shorts;
  const s = tj.site, p = tj.producer; producer = p; moodKeys = ["all", ...tj.moods];
  $("siteName").textContent = s.name; $("footName").textContent = s.name; $("prName").textContent = p.name; $("prAvatar").src = p.avatar;
  $("moodChips").onclick = e => { const b = e.target.closest("button"); if (!b) return; mood = b.dataset.m; renderMoods(); renderTracks(); };
  if (tracks.length) { const hg = $("heroGame"); hg.href = gameUrl(tracks[0]); hg.hidden = false; }
  DZ.onLang(() => { renderMoods(); renderAllLinks(); sync(); renderTracks(); renderShorts(); if (tracks.length) $("heroGame").textContent = T("play.game"); });
  DZ.applyLang();
  const want = new URLSearchParams(location.search).get("t");
  const i = tracks.findIndex(t => t.slug === want);
  if (i >= 0) { load(i); toast(T("t.tap")); } // 자동재생은 브라우저가 막으므로 로드만
}

function renderTracks() {
  $("trackList").innerHTML = tracks.map((t, i) => [t, i]).filter(([t]) => mood === "all" || (t.moods || []).includes(mood)).map(([t, i]) => `
    <li class="track${i === cur ? " on" : ""}" data-i="${i}"><img src="${t.cover}" alt="" loading="lazy">
    <div><b>${t.title}</b><small>${[t.genre, t.bpm && t.bpm + " BPM"].filter(Boolean).join(" · ")}</small></div>
    <div class="track-actions"><a class="chip-btn strong go-game" href="${gameUrl(t)}" target="_blank" rel="noopener" title="${T("play.game")}" aria-label="${T("play.game")}" onclick="event.stopPropagation()">🎮</a><span class="go">▶</span></div></li>`).join("") || `<li class="empty">${T("noTracks")}</li>`;
  $("trackList").onclick = e => { if (e.target.closest(".go-game")) return; const li = e.target.closest(".track"); if (li) { const i = +li.dataset.i; i === cur ? toggle() : (load(i), play()); } };
}

function renderShorts() {
  const g = $("shortGrid");
  g.innerHTML = shorts.map(s => {
    const t = tracks.find(x => x.slug === s.track);
    const ext = Object.entries(s.external || {}).find(([, u]) => u);
    return `<div class="short" data-id="${s.id}"><img src="${s.poster}" alt="" loading="lazy">
      <span class="badge">${t ? t.title : ""}</span>${ext ? `<a class="ext" href="${ext[1]}" target="_blank" rel="noopener">${ext[0]}↗</a>` : ""}
      <button aria-label="${T("a.short")}"></button></div>`;
  }).join("");
  g.onclick = e => {
    const box = e.target.closest(".short"); if (!box || e.target.closest("a")) return;
    const s = shorts.find(x => x.id === box.dataset.id);
    const old = box.querySelector("video");
    if (old) { old.paused ? old.play() : old.pause(); return; }
    audio.pause();
    g.querySelectorAll("video").forEach(v => { const im = new Image(); im.src = v.poster; v.replaceWith(im); });
    const v = Object.assign(document.createElement("video"), { src: s.video, poster: s.poster, playsInline: true, loop: true });
    box.querySelector("img")?.remove(); box.prepend(v); v.play();
  };
}

function renderAllLinks() { renderLinks($("prLinks"), producer.links, false); renderLinks($("links"), producer.links, true); }
function renderLinks(el, l, showEmpty) {
  const on = Object.entries(l).filter(([, u]) => u);
  el.innerHTML = on.length ? on.map(([k, u]) => `<a href="${u}" target="_blank" rel="noopener">${k}</a>`).join("") : (showEmpty ? `<span class="empty">${T("linksSoon")}</span>` : "");
}

function renderMoods() {
  $("moodChips").innerHTML = moodKeys.map(m => `<button data-m="${m}" class="${m === mood ? "on" : ""}">${T("mood." + m)}</button>`).join("");
}
function load(i) {
  cur = i; const t = tracks[i];
  audio.src = t.audio; $("player").hidden = false;
  $("pCover").src = t.cover; $("pTitle").textContent = t.title; $("pSub").textContent = "ARUGA · " + t.genre;
  document.querySelectorAll(".track").forEach((el, k) => el.classList.toggle("on", k === i));
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "ARUGA", artwork: [{ src: t.cover, sizes: "600x600", type: "image/jpeg" }] });
}
function setupViz() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = ctx.createAnalyser(); analyser.fftSize = 256; buf = new Uint8Array(analyser.frequencyBinCount);
  const src = ctx.createMediaElementSource(audio); src.connect(analyser); analyser.connect(ctx.destination);
}
function play() {
  document.querySelectorAll("#shortGrid video").forEach(v => v.pause());
  try { setupViz(); ctx.resume(); } catch {}
  audio.play().catch(() => toast(T("t.fail")));
}
function toggle() { if (cur < 0) load(0); audio.paused ? play() : audio.pause(); }
function step(d) { if (!tracks.length) return; load((cur + d + tracks.length) % tracks.length); play(); }
const sync = () => { $("toggle").textContent = audio.paused ? "▶" : "❚❚"; $("heroPlay").textContent = T(audio.paused ? "listen" : "pause"); };

audio.addEventListener("play", () => { if (audio.currentTime < 1 && cur >= 0) DZ.log("play", tracks[cur].slug); sync(); });
audio.addEventListener("pause", sync);
audio.addEventListener("ended", () => step(1));
audio.addEventListener("loadedmetadata", () => $("dur").textContent = fmt(audio.duration));
audio.addEventListener("timeupdate", () => { $("cur").textContent = fmt(audio.currentTime); if (audio.duration) $("seek").value = audio.currentTime / audio.duration * 1000; });
$("seek").oninput = e => { if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration; };
$("toggle").onclick = toggle; $("heroPlay").onclick = toggle;
$("prev").onclick = () => step(-1); $("next").onclick = () => step(1);
$("share").onclick = async () => {
  if (cur < 0) return; const t = tracks[cur], url = trackUrl(t); DZ.log("share", t.slug);
  if (navigator.share) { try { await navigator.share({ title: t.title + " — ARUGA", url }); return; } catch {} }
  try { await navigator.clipboard.writeText(url); toast(T("t.copied")); } catch { prompt("URL", url); }
};
if ("mediaSession" in navigator) { navigator.mediaSession.setActionHandler("previoustrack", () => step(-1)); navigator.mediaSession.setActionHandler("nexttrack", () => step(1)); }
document.addEventListener("keydown", e => { if (e.code === "Space" && !/INPUT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); toggle(); } });

// 히어로 비주얼라이저 (재생 전엔 잔잔한 파형)
const cv = $("viz"), g = cv.getContext("2d");
function draw(ts) {
  const w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = cv.clientHeight * devicePixelRatio;
  g.clearRect(0, 0, w, h);
  const playing = analyser && !audio.paused; if (playing) analyser.getByteFrequencyData(buf);
  const n = 48, bw = w / n;
  for (let i = 0; i < n; i++) {
    const v = playing ? buf[Math.floor(i * 0.9)] / 255 : 0.12 + 0.08 * Math.sin(ts / 600 + i * 0.4);
    const bh = Math.max(4, v * h * 0.7);
    const grd = g.createLinearGradient(0, h, 0, h - bh); grd.addColorStop(0, "#ff2bd600"); grd.addColorStop(1, i % 2 ? "#00f0ff88" : "#ff2bd688");
    g.fillStyle = grd; g.fillRect(i * bw + bw * 0.15, h - bh, bw * 0.7, bh);
  }
  requestAnimationFrame(draw);
}
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(draw);
init().catch(() => toast(T("t.load")));
})();
