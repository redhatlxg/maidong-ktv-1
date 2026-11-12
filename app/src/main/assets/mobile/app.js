const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const uiState = {
  page: 1, query: "", searchMode: "song", selectedSinger: "", voiceSingerFilter: "", busy: false,
  hotPage: 1, hotPageSize: 10, hotBusy: false, hotTab: "library", douyinHotLoaded: false, douyinHotBusy: false,
  visible: true, connected: false, eqEnabled: false, queueBusy: false, queueUpdatedAt: 0,
  equalizer: null, searchAbort: null, searchKey: ""
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));
}

function setConnected(connected) {
  uiState.connected = connected;
  $("#offline").classList.toggle("hidden", connected);
  $("#connection").innerHTML = connected
    ? "<span></span>已连接麦动 KTV"
    : "<span></span>正在连接麦动 KTV…";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "操作失败");
  setConnected(true);
  return data;
}

function toast(text) {
  const element = $("#toast");
  element.textContent = text;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 1600);
}

function songRow(song, queue = false, current = false, index = 0, ranking = false) {
  const number = current ? "♪" : String(index + 1).padStart(2, "0");
  const actions = queue && !current
    ? '<button class="top">置顶</button><button class="delete" aria-label="删除">×</button>'
    : !queue ? '<button class="order">点歌</button>' : "";
  return `<div class="song${ranking && index < 3 ? " podium" : ""}" data-id="${escapeHtml(song.id)}">
    <div class="song-index">${number}</div>
    <div class="info">${current ? '<span class="playing">正在播放</span>' : ""}<b>${escapeHtml(song.title)}</b><p>${escapeHtml(song.singer)}${song.language ? " · " + escapeHtml(song.language) : ""}</p></div>
    <button type="button" class="song-detail">详情/歌词</button>${!queue ? `<button type="button" class="favorite${song.favorite ? " active" : ""}" aria-label="${song.favorite ? "取消收藏" : "收藏"}">${song.favorite ? "♥" : "♡"}</button><button type="button" class="playlist-add" aria-label="加入歌单">＋歌单</button>` : ""}${actions}
  </div>`;
}

function singerCard(singer, count) {
  const name = String(singer || "").trim();
  if (!name) return "";
  const initial = Array.from(name)[0] || "♪";
  return '<button type="button" class="singer-card" data-singer="' + escapeHtml(name) + '"><span class="singer-avatar" aria-hidden="true">' + escapeHtml(initial) + '</span><span class="singer-card-info"><b>' + escapeHtml(name) + '</b><small>' + count + ' 首相关歌曲</small></span><span class="singer-card-arrow" aria-hidden="true">›</span></button>';
}

function singerCardsFromSongs(songs) {
  const counts = new Map();
  (songs || []).forEach((song) => { const name = String(song.singer || "").trim(); if (name) counts.set(name, (counts.get(name) || 0) + 1); });
  return Array.from(counts, ([name, count]) => singerCard(name, count)).join("");
}
function openPage(name) {
  $$("nav button,.page").forEach((element) => element.classList.remove("active"));
  $(`nav button[data-page="${name}"]`)?.classList.add("active");
  $("#" + name)?.classList.add("active");
  if (name === "queue") loadQueue();
  if (name === "favorites") loadFavorites();
  if (name === "playlists") loadPlaylists();
  if (name === "search" && !$("#hotList").children.length) loadHot(1);
}

async function refresh() {
  try {
    const data = await api("/api/v1/state");
    const current = data.current || {};
    const count = data.queueSize || 0;
    $("#nowTitle").textContent = current.title || "暂无歌曲";
    $("#nowSinger").textContent = current.singer || "请先点一首喜欢的歌";
    $("#queueBadge b").textContent = count;
    $("#navCount").textContent = count;
    $("#navCount").classList.toggle("hidden", count === 0);
    $("#playButton span:last-child").textContent = data.playing ? "暂停" : "继续";
    $("#playButton").dataset.action = data.playing ? "pause" : "resume";
    $("#playButton .control-icon").textContent = data.playing ? "Ⅱ" : "▶";
    $("#musicVolume").value = data.musicVolume ?? 85;
    $("#micVolume").value = data.micVolume ?? 70;
    $("#musicValue").textContent = data.musicVolume ?? 85;
    // 麦克风音量由功放/混音器硬件调节(滑杆已禁用), 仅保留显示值。
    const micHw = $("#micValue");
    if (micHw) micHw.textContent = data.micVolume ?? 70;
    $("#original").classList.toggle("active", data.vocalMode === "original");
    $("#accompany").classList.toggle("active", data.vocalMode !== "original");
    $("#nextSong").textContent = data.next?.title || "队列为空";
    // 均衡器卡片默认收起: 收起时跳过 DOM 更新(避免每秒轮询重绘), 展开时再渲染一次。
    uiState.equalizer = data.equalizer;
    if (!$("#eqBody")?.classList.contains("hidden")) renderEqualizer(data.equalizer);
  } catch (_) {
    setConnected(false);
  }
}

// ─── 均衡器（与设备端 KtvEqualizer 同步，频段由设备真实能力决定）───
function renderEqualizer(eq) {
  if (!eq) return;
  uiState.eqEnabled = !!eq.enabled;
  const state = $("#eqState");
  if (state) state.textContent = eq.enabled ? (eq.preset || "自定义") : "已关闭";
  const toggle = $("#eqToggle");
  if (toggle) {
    toggle.textContent = eq.enabled ? "关闭均衡器" : "开启均衡器";
    toggle.classList.toggle("active", !!eq.enabled);
  }
  const hint = $("#eqHint");
  if (hint) {
    hint.textContent = eq.globalMix
      ? "当前作用于全局混音（会影响本机所有声音）"
      : "均衡器作用于本机播放输出，不改动系统音量";
  }
  const bands = Array.isArray(eq.bands) ? eq.bands : [];
  const container = $("#eqBands");
  if (container && container.childElementCount !== bands.length) {
    container.innerHTML = bands.map((band, index) => `<div class="eq-band"><span>${escapeHtml(band.label)}Hz</span><b><em id="eqValue${index}">${Number(band.level).toFixed(1)}</em>dB</b><input id="eqBand${index}" type="range" min="${eq.minDb}" max="${eq.maxDb}" step="1" value="${band.level}"></div>`).join("");
    bands.forEach((band, index) => {
      const input = $("#eqBand" + index);
      if (!input) return;
      attachThumbOnlyDrag(input);
      input.addEventListener("input", () => {
        const value = $("#eqValue" + index);
        if (value) value.textContent = Number(input.value).toFixed(1);
      });
      input.addEventListener("change", () => updateEqualizer({ levels: currentEqLevels() }));
    });
  } else if (container) {
    bands.forEach((band, index) => {
      const input = $("#eqBand" + index);
      // 正在拖动的那根滑杆不要被轮询覆盖。
      if (input && document.activeElement !== input) input.value = band.level;
      const value = $("#eqValue" + index);
      if (value) value.textContent = Number(band.level).toFixed(1);
    });
  }
  const presets = Array.isArray(eq.presets) ? eq.presets : [];
  const presetBox = $("#eqPresets");
  if (presetBox && presetBox.childElementCount !== presets.length) {
    presetBox.innerHTML = presets.map((name) => `<button type="button" class="eq-preset" data-preset="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("");
    presetBox.querySelectorAll(".eq-preset").forEach((button) => {
      button.addEventListener("click", () => updateEqualizer({ preset: button.dataset.preset }));
    });
  }
  presetBox?.querySelectorAll(".eq-preset").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === eq.preset);
  });
}

function currentEqLevels() {
  return Array.from($$("#eqBands input[type=range]")).map((input) => Number(input.value));
}

/**
 * 触控优化：滑块必须按住「控件点（滑块）」才能拖动，点轨道空白处不跳变数值。
 *
 * `<input type="range">` 默认点轨道任意位置都会跳值并开始拖动；这里在指针按下时先做
 * 命中判断 —— 命中滑块才放行浏览器原生拖动，否则 preventDefault 拦掉这次手势。
 * 只有粘性标记滑块处于按下状态时才放行，手指移出轨道仍可继续拖动（由原生处理）。
 */
function attachThumbOnlyDrag(input) {
  if (!input || input.dataset.thumbOnly === "1") return;
  input.dataset.thumbOnly = "1";
  const blocked = (event) => {
    const rect = input.getBoundingClientRect();
    const point = event.touches && event.touches.length ? event.touches[0] : event;
    const x = point.clientX;
    const y = point.clientY;
    // 粗略还原轨道几何：控件左右各留半个滑块宽度。
    const thumb = 32;
    const trackLeft = rect.left + thumb / 2;
    const trackRight = rect.right - thumb / 2;
    const span = trackRight - trackLeft;
    if (span <= 0 || y < rect.top - thumb || y > rect.bottom + thumb) return true;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const ratio = (Number(input.value) - min) / (max - min || 1);
    const thumbX = trackLeft + ratio * span;
    // 命中滑块（含手指触控容差）→ 放行拖动；否则拦掉，避免点轨道跳值。
    return Math.abs(x - thumbX) > Math.max(thumb, 26);
  };
  const guard = (event) => { if (blocked(event)) event.preventDefault(); };
  input.addEventListener("pointerdown", guard, { passive: false });
  input.addEventListener("touchstart", guard, { passive: false });
  input.addEventListener("mousedown", guard);
}

async function updateEqualizer(values) {
  try {
    await api("/api/v1/player/equalizer", { method: "PATCH", body: JSON.stringify(values) });
    await refresh();
  } catch (error) { toast(error.message); }
}

async function playerAction(action) {
  try {
    await api("/api/v1/player/actions", { method: "POST", body: JSON.stringify({ action }) });
    await refresh();
  } catch (error) { toast(error.message); }
}

async function updateAudio(values) {
  try {
    await api("/api/v1/player/audio", { method: "PATCH", body: JSON.stringify(values) });
    await refresh();
  } catch (error) { toast(error.message); }
}

async function search(reset = true, preserveVoiceSingerFilter = false) {
  if (reset && !preserveVoiceSingerFilter) uiState.voiceSingerFilter = "";
  if (reset) {
    const nextQuery = $("#query").value.trim();
    if (!nextQuery) {
      toast(`请输入${uiState.searchMode === "singer" ? "歌手" : "歌曲"}名称`);
      $("#query").focus();
      return;
    }
    // 同一关键词+同一搜索方式且结果已渲染 → 不重复请求设备(设备端也要查 1GB 曲库)。
    const key = `${uiState.searchMode}|${nextQuery}`;
    if (key === uiState.searchKey && $("#results").childElementCount) {
      $("#searchResultBlock").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    uiState.page = 1;
    uiState.selectedSinger = "";
    uiState.query = nextQuery;
    uiState.searchKey = key;
    $("#results").innerHTML = "";
    $("#searchResultBlock").classList.remove("hidden");
    $("#resultTitle").textContent = uiState.searchMode === "singer" ? "歌手搜索结果" : "歌曲搜索结果";
    $("#resultSummary").textContent = `正在搜索“${uiState.query}”`;
    $("#more").classList.add("hidden");
    if (uiState.searchAbort) uiState.searchAbort.abort();
    uiState.searchAbort = new AbortController();
  }
  const signal = uiState.searchAbort ? uiState.searchAbort.signal : undefined;
  const requestedPage = uiState.page;
  uiState.busy = true;
  try {
    const data = await api(`/api/v1/songs?q=${encodeURIComponent(uiState.query)}&type=${uiState.searchMode}&page=${requestedPage}&pageSize=20`, { signal });
    let resultSongs = data.songs || [];
    if (uiState.voiceSingerFilter) {
      const wantedSinger = uiState.voiceSingerFilter.toLocaleLowerCase();
      resultSongs = resultSongs.filter((song) => String(song.singer || "").toLocaleLowerCase().includes(wantedSinger));
    }
    const rows = uiState.searchMode === "singer" && !uiState.selectedSinger ? singerCardsFromSongs(resultSongs) : resultSongs.map((song, index) => songRow(song, false, false, (requestedPage - 1) * 20 + index)).join("");
    if (rows) {
      if (uiState.searchMode === "singer" && !uiState.selectedSinger && requestedPage > 1) {
        const existing = new Set(Array.from($("#results").querySelectorAll("[data-singer]")).map((item) => item.dataset.singer));
        const wrapper = document.createElement("div"); wrapper.innerHTML = rows;
        Array.from(wrapper.children).forEach((card) => { if (!existing.has(card.dataset.singer)) $("#results").appendChild(card); });
      } else $("#results").insertAdjacentHTML("beforeend", rows);
    } else if (reset) $("#results").innerHTML = '<div class="empty">没有找到相关内容<br><small>请更换关键词后重试</small></div>';
    $("#resultSummary").textContent = uiState.selectedSinger ? uiState.selectedSinger + " 的歌曲" + (data.hasMore ? "，还有更多" : "") : `“${uiState.query}”${data.hasMore ? "，还有更多" : ""}`;
    $("#more").textContent = uiState.searchMode === "singer" && !uiState.selectedSinger ? "加载更多歌手" : "加载更多歌曲";
    $("#more").classList.toggle("hidden", !data.hasMore);
    uiState.page = requestedPage + 1;
    // 预热下一页: 设备端会把它缓存下来, 用户点「更多」时基本瞬时。
    if (requestedPage === 1 && data.hasMore) {
      window.setTimeout(() => {
        api(`/api/v1/songs?q=${encodeURIComponent(uiState.query)}&type=${uiState.searchMode}&page=2&pageSize=20`)
          .catch(() => {});
      }, 500);
    }
  } catch (error) {
    // 被下一次搜索取消属于正常情况, 不弹提示。
    if (error && error.name !== "AbortError") toast(error.message);
  } finally { uiState.busy = false; }
}


const DOUYIN_MUSIC_README = "https://raw.githubusercontent.com/SnailDev/douyin-hot-hub/main/README.md";

function parseDouyinMusicBoard(markdown) {
  const update = (markdown.match(/`更新时间：([^\`]+)`/) || [])[1] || "更新时间未知";
  const heading = markdown.indexOf("## 音乐榜");
  if (heading < 0) throw new Error("公开数据中没有找到音乐榜");
  const afterHeading = markdown.slice(heading + "## 音乐榜".length);
  const nextHeading = afterHeading.search(/^## /m);
  const section = nextHeading < 0 ? afterHeading : afterHeading.slice(0, nextHeading);
  const items = [];
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\.\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s+-\s+(.+)\s*$/);
    if (match) items.push({ title: match[1].trim(), artist: match[3].trim(), url: match[2] });
  }
  if (!items.length) throw new Error("音乐榜暂时没有可展示的歌曲");
  return { update, items };
}

function renderDouyinMusicBoard(items) {
  $("#douyinHotList").innerHTML = items.map((item, index) => `
    <div class="douyin-song">
      <span class="douyin-rank ${index < 3 ? "top" : ""}">${String(index + 1).padStart(2, "0")}</span>
      <div class="douyin-song-info"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.artist)}</small></div>
      <button type="button" class="douyin-find" data-douyin-search="${escapeHtml(item.title)}">曲库查找</button>
    </div>`).join("");
}

async function loadDouyinMusicBoard(force = false) {
  if (uiState.douyinHotBusy || (uiState.douyinHotLoaded && !force)) return;
  uiState.douyinHotBusy = true;
  $("#douyinUpdated").textContent = "正在获取…";
  $("#douyinHotList").innerHTML = '<div class="empty compact">正在获取免费公开榜单…</div>';
  try {
    const response = await fetch(DOUYIN_MUSIC_README, { cache: force ? "no-store" : "default" });
    if (!response.ok) throw new Error("免费数据源暂时无法访问（HTTP " + response.status + "）");
    const board = parseDouyinMusicBoard(await response.text());
    renderDouyinMusicBoard(board.items);
    $("#douyinUpdated").textContent = board.update + " · " + board.items.length + " 首";
    uiState.douyinHotLoaded = true;
  } catch (error) {
    $("#douyinUpdated").textContent = "获取失败";
    $("#douyinHotList").innerHTML = '<div class="empty compact">暂时无法获取抖音音乐榜<br><small>' + escapeHtml(error.message) + '<br>可稍后点击刷新重试</small></div>';
    toast("抖音音乐榜加载失败");
  } finally {
    uiState.douyinHotBusy = false;
  }
}

function switchHotTab(tab) {
  uiState.hotTab = tab;
  $$("[data-hot-tab]").forEach((button) => button.classList.toggle("active", button.dataset.hotTab === tab));
  $("#hot").classList.toggle("hidden", tab !== "library");
  $("#douyinHot").classList.toggle("hidden", tab !== "douyin");
  if (tab === "douyin") loadDouyinMusicBoard();
}

async function loadHot(page) {
  if (uiState.hotBusy || page < 1) return;
  uiState.hotBusy = true;
  $("#hotPrev").disabled = true;
  $("#hotNext").disabled = true;
  $("#hotSummary").textContent = "正在加载…";
  try {
    const data = await api(`/api/v1/hot?page=${page}&pageSize=${uiState.hotPageSize}`);
    uiState.hotPage = data.page || page;
    const songs = data.songs || [];
    $("#hotList").innerHTML = songs.map((song, index) =>
      songRow(song, false, false, (uiState.hotPage - 1) * uiState.hotPageSize + index, true)
    ).join("") || '<div class="empty compact">暂无热歌排行</div>';
    $("#hotPage").textContent = `第 ${uiState.hotPage} 页`;
    $("#hotSummary").textContent = songs.length ? `第 ${(uiState.hotPage - 1) * uiState.hotPageSize + 1}-${(uiState.hotPage - 1) * uiState.hotPageSize + songs.length} 名` : "暂无数据";
    $("#hotPrev").disabled = !data.hasPrevious;
    $("#hotNext").disabled = !data.hasMore;
    if (page > 1) $("#hot").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#hotList").innerHTML = '<div class="empty compact">热歌排行加载失败</div>';
    $("#hotSummary").textContent = "请点击翻页重试";
    $("#hotPrev").disabled = uiState.hotPage <= 1;
    $("#hotNext").disabled = false;
    toast(error.message);
  } finally { uiState.hotBusy = false; }
}

async function loadPlaylists() {
  try {
    const data = await api("/api/v1/playlists");
    const rows = data.playlists || [];
    $("#playlistList").innerHTML = rows.map(item => `<button type="button" class="playlist-card" data-playlist="${escapeHtml(item.name)}"><b>${escapeHtml(item.name)}</b><small>${item.count} 首歌曲</small><span>›</span></button>`).join("")
      || '<div class="empty">还没有歌单</div>';
    $("#playlistSongsBlock").classList.add("hidden");
    $("#playlistList").classList.remove("hidden");
  } catch (error) { toast(error.message); }
}

async function openPlaylist(name) {
  try {
    const data = await api("/api/v1/playlists/" + encodeURIComponent(name));
    $("#playlistDetailName").textContent = name;
    $("#playlistSongs").innerHTML = (data.songs || []).map((song, index) => songRow(song, false, false, index)).join("")
      || '<div class="empty">这个歌单还是空的</div>';
    $("#playlistList").classList.add("hidden");
    $("#playlistSongsBlock").classList.remove("hidden");
    $("#deletePlaylist").dataset.playlist = name;
  } catch (error) { toast(error.message); }
}

async function loadFavorites() {
  try {
    const data = await api("/api/v1/favorites");
    const songs = data.songs || [];
    $("#favoriteCount").textContent = `${songs.length} 首`;
    $("#favoriteList").innerHTML = songs.map((song, index) => songRow(song, false, false, index)).join("")
      || '<div class="empty">还没有收藏歌曲<br><small>在搜歌页面点击 ♡ 即可收藏</small></div>';
  } catch (error) { toast(error.message); }
}

async function loadQueue(silent = false) {
  // 所有扫码手机读取设备端同一份队列；防止轮询重叠导致旧响应覆盖新状态。
  if (uiState.queueBusy || !uiState.visible) return;
  uiState.queueBusy = true;
  try {
    const data = await api("/api/v1/queue");
    const queue = data.queue || [];
    $("#queueCount").textContent = `${queue.length} 首`;
    $("#queueList").innerHTML = queue.map((song, index) => songRow(song, true, index === 0, index)).join("") || '<div class="empty">还没有点歌<br><small>去曲库选一首喜欢的歌吧</small></div>';
    uiState.queueUpdatedAt = Date.now();
  } catch (error) { if (!silent) toast(error.message); }
  finally { uiState.queueBusy = false; }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.page) openPage(button.dataset.page);
  if (button.dataset.hotTab) { switchHotTab(button.dataset.hotTab); return; }
  if (button.id === "douyinRefresh") { loadDouyinMusicBoard(true); return; }
  if (button.dataset.douyinSearch) {
    switchHotTab("library");
    openPage("search");
    uiState.searchMode = "song";
    $("[data-search-mode]").forEach((item) => item.classList.toggle("active", item.dataset.searchMode === "song"));
    $("#query").value = button.dataset.douyinSearch;
    search();
    toast("正在本地曲库查找：" + button.dataset.douyinSearch);
    return;
  }
  if (button.dataset.action) playerAction(button.dataset.action);
  if (button.dataset.vocal) { updateAudio({ vocalMode: button.dataset.vocal }); return; }

async function showSongDetail(songId) { try { const row = Array.from(document.querySelectorAll(".song")).find((item) => item.dataset.id === songId); const data = await api("/api/v1/lyrics/" + encodeURIComponent(songId)); $("#detailTitle").textContent = row?.querySelector(".info b")?.textContent || "歌曲详情"; $("#detailMeta").textContent = row?.querySelector(".info p")?.textContent || ""; $("#detailLyrics").textContent = data.available ? data.lyrics : (data.message || "暂无歌词"); $("#detailModal").classList.remove("hidden"); } catch (error) { toast(error.message); } }
async function showSingerDetail(name) { try { const data = await api("/api/v1/singer?q=" + encodeURIComponent(name)); const singer = (data.singers || []).find((item) => item.name === name) || (data.singers || [])[0] || {}; $("#detailTitle").textContent = data.name || name; $("#detailMeta").textContent = [singer.area, singer.type].filter(Boolean).join(" · ") || "歌手资料"; $("#detailLyrics").textContent = "曲库收录歌曲：" + (data.songCount ?? 0) + " 首\n歌手：" + (singer.name || name) + "\n地区：" + (singer.area || "曲库未标注") + "\n类型：" + (singer.type || "曲库未标注") + "\n\n这里只展示曲库已有资料，不会编造个人简介。"; $("#detailModal").classList.remove("hidden"); } catch (error) { toast(error.message); } }
  if (button.dataset.singer) {
    uiState.selectedSinger = button.dataset.singer; uiState.query = button.dataset.singer; uiState.page = 1;
    uiState.searchKey = "singer|" + uiState.query; $("#query").value = button.dataset.singer; showSingerDetail(button.dataset.singer);
    $("#results").innerHTML = ""; $("#resultTitle").textContent = button.dataset.singer + " 的歌曲";
    $("#resultSummary").textContent = "正在加载歌曲…"; $("#more").classList.add("hidden"); search(false); return;
  }
  if (button.dataset.searchMode) {
    uiState.selectedSinger = ""; uiState.voiceSingerFilter = ""; uiState.searchMode = button.dataset.searchMode;
    $$('[data-search-mode]').forEach((item) => item.classList.toggle("active", item === button));
    $("#query").placeholder = uiState.searchMode === "singer" ? "输入歌手名或拼音" : "输入歌曲名或拼音";
    $("#query").value = "";
    $("#results").innerHTML = "";
    $("#searchResultBlock").classList.add("hidden");
    $("#more").classList.add("hidden");
    $("#query").focus();
  }
  const row = button.closest(".song");
  if (row && button.classList.contains("song-detail")) { showSongDetail(row.dataset.id); return; }
  if (button.dataset.playlist) { openPlaylist(button.dataset.playlist); return; }
  if (button.id === "createPlaylist") {
    const name = window.prompt("请输入新歌单名称（最多 24 个字符）");
    if (name && name.trim()) {
      try { await api("/api/v1/playlists", { method: "POST", body: JSON.stringify({ name: name.trim() }) }); toast("歌单已创建"); loadPlaylists(); }
      catch (error) { toast(error.message); }
    }
    return;
  }
  if (button.id === "playlistBack") { loadPlaylists(); return; }
  if (button.id === "deletePlaylist") {
    const name = button.dataset.playlist;
    if (name && window.confirm("确定删除歌单“" + name + "”？")) {
      try { await api("/api/v1/playlists/" + encodeURIComponent(name), { method: "DELETE" }); toast("歌单已删除"); loadPlaylists(); }
      catch (error) { toast(error.message); }
    }
    return;
  }
  if (row && button.classList.contains("playlist-add")) {
    const name = window.prompt("输入要加入的歌单名称（可在“我的歌单”中新建）");
    if (name && name.trim()) {
      try {
        const data = await api("/api/v1/playlists/" + encodeURIComponent(name.trim()) + "/songs", { method: "POST", body: JSON.stringify({ songId: row.dataset.id }) });
        toast(data.message || "歌单已更新");
      } catch (error) { toast(error.message); }
    }
    return;
  }
  if (row && button.classList.contains("favorite")) {
    try {
      const data = await api("/api/v1/favorites", { method: "POST", body: JSON.stringify({ songId: row.dataset.id }) });
      button.classList.toggle("active", !!data.favorite);
      button.textContent = data.favorite ? "♥" : "♡";
      button.setAttribute("aria-label", data.favorite ? "取消收藏" : "收藏");
      toast(data.message || (data.favorite ? "已加入收藏" : "已取消收藏"));
    } catch (error) { toast(error.message); }
    return;
  }
  if (row && button.classList.contains("order")) {
    try {
      await api("/api/v1/queue", { method: "POST", body: JSON.stringify({ songId: row.dataset.id }) });
      button.textContent = "已点"; button.disabled = true; toast("已加入歌单"); refresh();
    } catch (error) { toast(error.message); }
  }
  if (row && button.classList.contains("top")) {
    try {
      await api("/api/v1/queue/" + encodeURIComponent(row.dataset.id), { method: "PATCH", body: "{}" });
      toast("已置顶为下一首"); loadQueue();
    } catch (error) { toast(error.message); }
  }
  if (row && button.classList.contains("delete")) {
    try {
      await api("/api/v1/queue/" + encodeURIComponent(row.dataset.id), { method: "DELETE" });
      toast("已从歌单移除"); loadQueue(); refresh();
    } catch (error) { toast(error.message); }
  }
});

// ─── 手机语音点歌：使用浏览器原生语音识别，不占用电视端演唱麦克风 ───
let voiceRecognition = null;
let voiceListening = false;

function parseVoiceSongCommand(transcript) {
  let phrase = String(transcript || "").trim().replace(/[，。！？、,.!?；;：:]+$/g, "");
  phrase = phrase.replace(/^(请|麻烦)?(帮我)?(点歌|播放|我要听|我想听|我想点|来一首|唱一首|搜索|找一下)\s*/i, "").trim();
  phrase = phrase.replace(/^(请|帮我)\s*/, "").trim();
  if (!phrase) return null;
  const singerOnly = phrase.match(/^(.+?)(?:的)?(?:所有)?(?:歌|歌曲)$/);
  if (singerOnly && singerOnly[1].trim()) return { mode: "singer", query: singerOnly[1].trim(), spoken: transcript };
  const split = phrase.match(/^(.{1,20}?)的(.{1,30})$/);
  if (split && split[1].trim() && split[2].trim()) {
    const title = split[2].replace(/^(那首|歌曲)?/, "").trim();
    if (title) return { mode: "song", query: title, singer: split[1].trim(), spoken: transcript };
  }
  phrase = phrase.replace(/^(那首|歌曲|歌名是)/, "").trim();
  return phrase ? { mode: "song", query: phrase, spoken: transcript } : null;
}

function setVoiceButtonState(listening) {
  voiceListening = listening;
  const button = $("#voiceSearch");
  if (!button) return;
  button.classList.toggle("listening", listening);
  button.setAttribute("aria-pressed", listening ? "true" : "false");
  button.title = listening ? "正在聆听，点击停止" : "语音点歌";
  const label = button.querySelector("small");
  if (label) label.textContent = listening ? "聆听中" : "语音";
}

function applyVoiceSearch(command) {
  const modeButton = document.querySelector(`[data-search-mode="${command.mode}"]`);
  if (modeButton) modeButton.click();
  $("#query").value = command.query;
  uiState.searchMode = command.mode;
  $("[data-search-mode]").forEach((item) => item.classList.toggle("active", item.dataset.searchMode === command.mode));
  uiState.searchKey = "";
  uiState.selectedSinger = "";
  uiState.voiceSingerFilter = command.singer || "";
  search(true, true);
  if (command.singer) toast("识别到歌手：" + command.singer + "、歌曲：" + command.query + "，正在筛选匹配结果");
  else if (command.mode === "singer") toast("正在搜索歌手：" + command.query);
  else toast("已识别：" + command.query + "，请选择匹配歌曲加入点歌单");
}

function useKeyboardVoiceInput(reason) {
  const input = $("#query");
  if (input) {
    input.focus();
    try { input.click(); } catch (_) {}
  }
  toast(reason || "请点击手机输入法键盘上的麦克风，说出歌名后点击搜索");
}

function startVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const localSecureHost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!window.isSecureContext && !localSecureHost) {
    useKeyboardVoiceInput("当前扫码页面是局域网 HTTP，浏览器可能禁止网页直接录音；请用键盘上的麦克风语音输入");
    return;
  }
  if (!SpeechRecognition) {
    useKeyboardVoiceInput("当前浏览器没有网页语音识别功能，请使用手机输入法键盘上的麦克风");
    return;
  }
  if (voiceListening && voiceRecognition) {
    voiceRecognition.stop();
    setVoiceButtonState(false);
    return;
  }
  try {
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = "zh-CN";
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = false;
    voiceRecognition.maxAlternatives = 3;
    voiceRecognition.onstart = () => { setVoiceButtonState(true); toast("请说出歌名，例如：周杰伦的晴天"); };
    voiceRecognition.onresult = (event) => {
      const result = event.results && event.results[0] && event.results[0][0];
      const transcript = result ? result.transcript : "";
      const command = parseVoiceSongCommand(transcript);
      if (!command) { toast("没有识别出歌曲名称，请再试一次"); return; }
      applyVoiceSearch(command);
    };
    voiceRecognition.onerror = (event) => {
      const messages = { "not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许麦克风", "service-not-allowed": "语音识别服务不可用", "no-speech": "没有听到声音，请靠近手机再说一次", "audio-capture": "没有检测到可用麦克风", "network": "语音识别网络连接失败" };
      const message = messages[event.error] || "语音识别失败";
      if (["not-allowed", "service-not-allowed", "network", "audio-capture"].includes(event.error)) {
        useKeyboardVoiceInput(message + "；可以改用手机键盘麦克风语音输入");
      } else {
        toast(message + "，请再试一次或使用键盘麦克风");
      }
    };
    voiceRecognition.onend = () => setVoiceButtonState(false);
    voiceRecognition.start();
  } catch (error) {
    setVoiceButtonState(false);
    useKeyboardVoiceInput("无法启动网页语音识别，请使用手机键盘麦克风输入");
  }
}

$("#playlistBack")?.addEventListener("click", () => loadPlaylists());
$("#detailClose")?.addEventListener("click", () => $("#detailModal").classList.add("hidden"));
$("#detailModal")?.addEventListener("click", (event) => { if (event.target.id === "detailModal") $("#detailModal").classList.add("hidden"); });
$("#voiceSearch")?.addEventListener("click", startVoiceSearch);
$("#searchForm").addEventListener("submit", (event) => { event.preventDefault(); search(); });
$("#more").addEventListener("click", () => search(false));
$("#hotPrev").addEventListener("click", () => loadHot(uiState.hotPage - 1));
$("#hotNext").addEventListener("click", () => loadHot(uiState.hotPage + 1));
$("#douyinRefresh")?.addEventListener("click", () => loadDouyinMusicBoard(true));
// 音乐音量可调; 麦克风音量由功放硬件控制, 不再向设备发送无效果请求。
attachThumbOnlyDrag($("#musicVolume"));
$("#musicVolume").addEventListener("input", (event) => { $("#musicValue").textContent = event.target.value; });
$("#musicVolume").addEventListener("change", (event) => updateAudio({ musicVolume: Number(event.target.value) }));
// 均衡器入口(与设备端弹窗等价): 开关 / 恢复标准
$("#eqToggle")?.addEventListener("click", () => updateEqualizer({ enabled: !uiState.eqEnabled }));
$("#eqReset")?.addEventListener("click", () => updateEqualizer({ preset: "标准" }));
// 均衡器文字栏作为折叠按钮: 默认收起; 展开后在同一次页面会话内保持, 重新加载页面回到收起态。
$("#eqCollapse")?.addEventListener("click", () => {
  const body = $("#eqBody");
  if (!body) return;
  const collapsed = body.classList.toggle("hidden");
  $("#eqCollapse").setAttribute("aria-expanded", collapsed ? "false" : "true");
  // 展开时补一次渲染(收起期间轮询跳过了 EQ 的 DOM 更新)。
  if (!collapsed) renderEqualizer(uiState.equalizer);
});
document.addEventListener("visibilitychange", () => { uiState.visible = !document.hidden; if (uiState.visible) refresh(); });
// 搜索进行中暂停状态轮询: 避免与设备端 1GB 曲库查询抢 I/O。
window.setInterval(() => {
  if (!uiState.visible || uiState.busy) return;
  refresh();
  // 队列页保持实时同步：多部手机点歌、置顶或删除后，其他手机约 2 秒内看到变化。
  if ($("#queue")?.classList.contains("active") && Date.now() - uiState.queueUpdatedAt >= 1800) {
    loadQueue(true);
  }
}, 1000);
refresh();
loadHot(1);
