// QR 配对令牌已由本地服务写入 HttpOnly Cookie；从地址栏移除一次性入口参数。
if (location.search.includes("pair=")) history.replaceState(null, "", "/mobile");

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const uiState = {
  page: 1, query: "", searchMode: "song", busy: false, resultMode: "songs", singerGroup: "all",
  hotPage: 1, hotPageSize: 10, hotBusy: false, favoritesBusy: false,
  visible: true, connected: false, eqEnabled: false, category: "", queueBusy: false, queuePollAt: 0,
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
    ? "<span></span>已连接晓晓呀"
    : "<span></span>正在连接晓晓呀…";
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
    : !queue ? `<button class="favorite${song.favorite ? " active" : ""}" data-favorite aria-label="${song.favorite ? "取消收藏" : "加入收藏"}">${song.favorite ? "★" : "☆"}</button><button class="order">点歌</button>` : "";
  return `<div class="song${ranking && index < 3 ? " podium" : ""}" data-id="${escapeHtml(song.id)}">
    <div class="song-index">${number}</div>
    <div class="info">${current ? '<span class="playing">正在播放</span>' : ""}<b>${escapeHtml(song.title)}</b><p>${escapeHtml(song.singer)}${song.language ? " · " + escapeHtml(song.language) : ""}</p></div>
    ${actions}
  </div>`;
}

function singerRow(singer, index) {
  const avatarText = escapeHtml((singer.name || "歌").slice(0, 1));
  const avatar = singer.image
    ? `<span class="singer-avatar-fallback">${avatarText}</span><img class="singer-avatar-image" src="${escapeHtml(singer.image)}" alt="" loading="lazy">`
    : `<span class="singer-avatar-fallback">${avatarText}</span>`;
  return `<div class="song singer-row">
    <div class="song-index">${String(index + 1).padStart(2, "0")}</div>
    <div class="singer-avatar">${avatar}</div>
    <div class="info"><b>${escapeHtml(singer.name)}</b><p>${escapeHtml([singer.area, singer.type].filter(Boolean).join(" · ") || "歌手")}</p></div>
    <button class="singer-select" type="button" data-singer="${escapeHtml(singer.name)}">查看歌曲</button>
  </div>`;
}

async function loadSingers(reset = true) {
  if (reset) {
    uiState.page = 1;
    uiState.resultMode = "singers";
    $("#results").innerHTML = "";
    $("#searchResultBlock").classList.remove("hidden");
    $("#resultTitle").textContent = "歌手分类";
    $("#resultSummary").textContent = "正在加载歌手…";
    $("#more").classList.add("hidden");
  }
  const requestedPage = uiState.page;
  try {
    const data = await api(`/api/v1/singers?group=${encodeURIComponent(uiState.singerGroup)}&q=${encodeURIComponent($("#query").value.trim())}&page=${requestedPage}&pageSize=30`);
    const singers = data.singers || [];
    const rows = singers.map((singer, index) => singerRow(singer, (requestedPage - 1) * 30 + index)).join("");
    if (rows) {
      $("#results").insertAdjacentHTML("beforeend", rows);
      $$("#results .singer-avatar-image").forEach((image) => {
        image.addEventListener("error", () => image.remove(), { once: true });
        image.addEventListener("load", () => image.previousElementSibling?.classList.add("hidden"), { once: true });
      });
    } else if (reset) $("#results").innerHTML = '<div class="empty">这个分类暂时没有歌手</div>';
    $("#resultSummary").textContent = singers.length ? `共显示 ${(requestedPage - 1) * 30 + singers.length} 位` : "暂无歌手";
    $("#more").classList.toggle("hidden", !data.hasMore);
    uiState.page = requestedPage + 1;
  } catch (error) {
    if (reset) $("#results").innerHTML = '<div class="empty">歌手列表加载失败</div>';
    $("#resultSummary").textContent = "请检查连接后重试";
    toast(error.message);
  }
}

function openPage(name) {
  const pageName = name === "singers" || name === "ranking" ? "search" : name;
  $("nav button,.page").forEach((element) => element.classList.remove("active"));
  $("nav button").forEach((element) => {
    if (element.dataset.page === name) element.setAttribute("aria-current", "page");
    else element.removeAttribute("aria-current");
  });
  $(`nav button[data-page="${name}"]`)?.classList.add("active");
  $("#" + pageName)?.classList.add("active");
  if (name === "queue") loadQueue();
  if (name === "favorites") loadFavorites();
  if (name === "search" && !$("#hotList").children.length) loadHot(1);
  if (name === "singers") {
    uiState.searchMode = "singer";
    uiState.category = "";
    $("#singerGroups").classList.remove("hidden");
    $("#query").placeholder = "输入歌手名或拼音";
    $$("[data-search-mode]").forEach((item) => item.classList.toggle("active", item.dataset.searchMode === "singer"));
    uiState.singerGroup = "all";
    $$("[data-singer-group]").forEach((item) => item.classList.toggle("active", item.dataset.singerGroup === "all"));
    $("#searchResultBlock").classList.remove("hidden");
    loadSingers(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (name === "ranking") {
    if (!$("#hotList").children.length) loadHot(1);
    window.setTimeout(() => $("#hot")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }
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
    $("#playButton .control-icon").innerHTML = data.playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>';
    $("#musicVolume").value = data.musicVolume ?? 85;
    $("#micVolume").value = data.micVolume ?? 70;
    $("#musicValue").textContent = data.musicVolume ?? 85;
    // 麦克风音量由功放/混音器硬件调节(滑杆已禁用), 仅保留显示值。
    const micHw = $("#micValue");
    if (micHw) micHw.textContent = data.micVolume ?? 70;
    $("#original").classList.toggle("active", data.vocalMode === "original");
    $("#accompany").classList.toggle("active", data.vocalMode !== "original");
    $("#nextSong").textContent = data.next?.title || "队列为空";
    // 已点页面保持多手机同步：在用户查看队列时每约 3 秒拉取一次最新顺序。
    if ($("#queue").classList.contains("active") && Date.now() - uiState.queuePollAt >= 2800) loadQueue();
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

async function search(reset = true) {
  if (reset) {
    uiState.resultMode = "songs";
    const nextQuery = $("#query").value.trim();
    if (!nextQuery && !uiState.category) {
      toast(`请输入${uiState.searchMode === "singer" ? "歌手" : "歌曲"}名称`);
      $("#query").focus();
      return;
    }
    // 同一关键词+同一搜索方式且结果已渲染 → 不重复请求设备(设备端也要查 1GB 曲库)。
    const key = `${uiState.searchMode}|${nextQuery}|${uiState.category}`;
    if (key === uiState.searchKey && $("#results").childElementCount) {
      $("#searchResultBlock").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    uiState.page = 1;
    uiState.query = nextQuery;
    uiState.searchKey = key;
    $("#results").innerHTML = "";
    $("#searchResultBlock").classList.remove("hidden");
    $("#resultTitle").textContent = uiState.category ? `${uiState.category} · 歌曲` : (uiState.searchMode === "singer" ? "歌手搜索结果" : "歌曲搜索结果");
    $("#resultSummary").textContent = `正在搜索“${uiState.query}”`;
    $("#more").classList.add("hidden");
    if (uiState.searchAbort) uiState.searchAbort.abort();
    uiState.searchAbort = new AbortController();
  }
  const signal = uiState.searchAbort ? uiState.searchAbort.signal : undefined;
  const requestedPage = uiState.page;
  uiState.busy = true;
  try {
    const data = await api(`/api/v1/songs?q=${encodeURIComponent(uiState.query)}&type=${uiState.searchMode}&category=${encodeURIComponent(uiState.category)}&page=${requestedPage}&pageSize=20`, { signal });
    const rows = (data.songs || []).map((song, index) => songRow(song, false, false, (requestedPage - 1) * 20 + index)).join("");
    if (rows) $("#results").insertAdjacentHTML("beforeend", rows);
    else if (reset) $("#results").innerHTML = '<div class="empty">没有找到相关歌曲<br><small>请更换关键词后重试</small></div>';
    $("#resultSummary").textContent = `“${uiState.query}”${data.hasMore ? "，还有更多" : ""}`;
    $("#more").classList.toggle("hidden", !data.hasMore);
    uiState.page = requestedPage + 1;
    // 预热下一页: 设备端会把它缓存下来, 用户点「更多」时基本瞬时。
    if (requestedPage === 1 && data.hasMore) {
      window.setTimeout(() => {
        api(`/api/v1/songs?q=${encodeURIComponent(uiState.query)}&type=${uiState.searchMode}&category=${encodeURIComponent(uiState.category)}&page=2&pageSize=20`)
          .catch(() => {});
      }, 500);
    }
  } catch (error) {
    // 被下一次搜索取消属于正常情况, 不弹提示。
    if (error && error.name !== "AbortError") toast(error.message);
  } finally { uiState.busy = false; }
}

async function loadCategories() {
  try {
    const data = await api("/api/v1/categories");
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const host = $("#categoryChips");
    if (!host) return;
    host.innerHTML = '<button type="button" data-category="" class="active">全部歌曲</button>' +
      categories.map((name) => `<button type="button" data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("");
  } catch (error) {
    // 分类接口不可用时保留「全部歌曲」，不影响常规搜索和热歌排行。
    toast("歌曲分类暂时不可用");
  }
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

async function loadQueue() {
  if (uiState.queueBusy) return;
  uiState.queueBusy = true;
  try {
    const data = await api("/api/v1/queue");
    const queue = data.queue || [];
    $("#queueCount").textContent = `${queue.length} 首`;
    $("#queueList").innerHTML = queue.map((song, index) => songRow(song, true, index === 0, index)).join("") || '<div class="empty">还没有点歌<br><small>去曲库选一首喜欢的歌吧</small></div>';
  } catch (error) { toast(error.message); }
  finally { uiState.queueBusy = false; uiState.queuePollAt = Date.now(); }
}

async function loadFavorites() {
  if (uiState.favoritesBusy) return;
  uiState.favoritesBusy = true;
  try {
    const data = await api("/api/v1/favorites");
    const songs = data.songs || [];
    $("#favoritesCount").textContent = `${songs.length} 首`;
    $("#favoritesList").innerHTML = songs.map((song, index) => songRow(song, false, false, index)).join("")
      || '<div class="empty">还没有收藏歌曲<br><small>在点歌大厅点击星标，就能加入常唱歌单</small></div>';
  } catch (error) {
    $("#favoritesList").innerHTML = '<div class="empty">收藏列表加载失败，请检查连接后重试</div>';
    toast(error.message);
  } finally { uiState.favoritesBusy = false; }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.letter || button.dataset.letterAction) {
    const input = $("#query");
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (button.dataset.letter) {
      input.setRangeText(button.dataset.letter.toLowerCase(), start, end, "preserve");
    } else if (button.dataset.letterAction === "backspace") {
      if (start !== end) input.setRangeText("", start, end, "preserve");
      else if (start > 0) {
        const previous = Array.from(input.value.slice(0, start)).pop() || "";
        input.setRangeText("", start - previous.length, start, "preserve");
      }
    } else if (button.dataset.letterAction === "clear") {
      input.value = "";
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (button.hasAttribute("data-category")) {
    uiState.category = button.dataset.category || "";
    uiState.searchMode = "song";
    uiState.query = "";
    uiState.searchKey = "";
    $("#query").value = "";
    $$("[data-search-mode]").forEach((item) => item.classList.toggle("active", item.dataset.searchMode === "song"));
    $("#singerGroups").classList.add("hidden");
    $$("#categoryChips [data-category]").forEach((item) => item.classList.toggle("active", item === button));
    if (uiState.category) search(true);
    else $("#searchResultBlock").classList.add("hidden");
  }
  if (button.id === "quickRank") $("#hot").scrollIntoView({ behavior: "smooth", block: "start" });
  if (button.dataset.page) openPage(button.dataset.page);
  if (button.dataset.action) playerAction(button.dataset.action);
  if (button.dataset.vocal) updateAudio({ vocalMode: button.dataset.vocal });
  if (button.dataset.singerGroup) {
    uiState.singerGroup = button.dataset.singerGroup;
    $$("[data-singer-group]").forEach((item) => item.classList.toggle("active", item === button));
    loadSingers(true);
  }
  if (button.classList.contains("singer-select")) {
    $("#query").value = button.dataset.singer || "";
    uiState.searchMode = "singer";
    uiState.resultMode = "songs";
    $("#searchResultBlock").classList.add("hidden");
    search(true);
  }
  if (button.dataset.searchMode) {
    uiState.searchMode = button.dataset.searchMode;
    uiState.category = "";
    $$("#categoryChips [data-category]").forEach((item) => item.classList.toggle("active", !item.dataset.category));
    $$('[data-search-mode]').forEach((item) => item.classList.toggle("active", item === button));
    $("#query").placeholder = uiState.searchMode === "singer" ? "输入歌手名或拼音" : "输入歌曲名或拼音";
    $("#singerGroups").classList.toggle("hidden", uiState.searchMode !== "singer");
    $("#query").value = "";
    $("#results").innerHTML = "";
    $("#searchResultBlock").classList.add("hidden");
    $("#more").classList.add("hidden");
    uiState.resultMode = "songs";
    if (uiState.searchMode === "singer") {
      uiState.singerGroup = "all";
      $$("[data-singer-group]").forEach((item) => item.classList.toggle("active", item.dataset.singerGroup === "all"));
      loadSingers(true);
    }
    $("#query").focus();
  }
  const row = button.closest(".song");
  if (row && button.hasAttribute("data-favorite")) {
    try {
      const data = await api("/api/v1/favorites", {
        method: "POST", body: JSON.stringify({ songId: row.dataset.id })
      });
      button.classList.toggle("active", !!data.favorite);
      button.textContent = data.favorite ? "★" : "☆";
      button.setAttribute("aria-label", data.favorite ? "取消收藏" : "加入收藏");
      toast(data.message || (data.favorite ? "已加入收藏" : "已取消收藏"));
      if ($("#favorites").classList.contains("active")) loadFavorites();
    } catch (error) { toast(error.message); }
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

$("#alphabetToggle")?.addEventListener("click", () => {
  const panel = $(".alphabet-panel");
  if (!panel) return;
  const expanded = !panel.classList.contains("hidden");
  panel.classList.toggle("hidden", expanded);
  $("#alphabetToggle").setAttribute("aria-expanded", String(!expanded));
  $("#alphabetToggle span").textContent = expanded ? "展开" : "收起";
});
$("#query")?.addEventListener("compositionend", () => {
  // 中文输入法候选词提交后保留文本，由用户主动点击搜索。
});
$("#searchForm").addEventListener("submit", (event) => { event.preventDefault(); uiState.searchMode === "singer" ? loadSingers(true) : search(); });
$("#more").addEventListener("click", () => uiState.resultMode === "singers" ? loadSingers(false) : search(false));
$("#hotPrev").addEventListener("click", () => loadHot(uiState.hotPage - 1));
$("#hotNext").addEventListener("click", () => loadHot(uiState.hotPage + 1));
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
window.setInterval(() => { if (uiState.visible && !uiState.busy) refresh(); }, 1000);
refresh();
loadCategories();
loadHot(1);
