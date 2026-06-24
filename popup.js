const content = document.getElementById("content");
const refreshButton = document.getElementById("refreshButton");
const WEEKLY_WINDOW_STORAGE_KEY = "weeklyFiveHourWindows";
const INCLUDE_TODAY_STORAGE_KEY = "includeTodayInWeekWindow";
const DEFAULT_WEEKLY_FIVE_HOUR_WINDOWS = 9;
const MIN_WEEKLY_FIVE_HOUR_WINDOWS = 1;
const MAX_WEEKLY_FIVE_HOUR_WINDOWS = 500;
const DAY_MS = 86400000;
const WINDOW_DAYS = 7;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let currentUsageData = null;
let lastWeekWindowHtml = "";
let includeTodayInWeekWindow = false;
let weeklyFiveHourWindows = DEFAULT_WEEKLY_FIVE_HOUR_WINDOWS;

document.addEventListener("DOMContentLoaded", initializePopup);

function initializePopup() {
  includeTodayInWeekWindow = false;
  lastWeekWindowHtml = "";
  localizeDocument();
  refreshButton.addEventListener("click", () => refreshUsage());
  content.addEventListener("click", handleWeekWindowToggle);
  content.addEventListener("keydown", handleWeekWindowToggle);
  content.addEventListener("change", handleWeeklyWindowInputChange);
  loadStoredUsage();
  setInterval(updateLiveLabels, 1000);
}

function localizeDocument() {
  const language = chrome.i18n.getUILanguage();
  if (language) document.documentElement.lang = language;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = message(element.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = message(element.dataset.i18nTitle);
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", message(element.dataset.i18nAriaLabel));
  });
}

function loadStoredUsage() {
  // Read the cache directly so the popup paints instantly without waking the
  // (possibly terminated) service worker, then refresh in the background.
  chrome.storage.local.get(["usageData", WEEKLY_WINDOW_STORAGE_KEY, INCLUDE_TODAY_STORAGE_KEY], (stored) => {
    weeklyFiveHourWindows = normalizeWeeklyWindowCapacity(stored?.[WEEKLY_WINDOW_STORAGE_KEY]);
    includeTodayInWeekWindow = Boolean(stored?.[INCLUDE_TODAY_STORAGE_KEY]);
    const usageData = stored?.usageData;
    if (usageData) renderUsage(usageData);
    refreshUsage({ showLoader: !usageData });
  });
}

function refreshUsage({ showLoader = false } = {}) {
  refreshButton.disabled = true;
  refreshButton.classList.add("is-refreshing");
  if (showLoader) showLoading();

  chrome.runtime.sendMessage({ action: "refresh" }, (usageData) => {
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-refreshing");

    if (usageData) renderUsage(usageData);
  });
}

function showLoading() {
  content.innerHTML = `
    <div class="empty">
      <div class="loader" aria-hidden="true"></div>
      <p>${escapeHtml(message("readingUsage"))}</p>
    </div>
  `;
}

function renderUsage(usageData) {
  currentUsageData = usageData;
  lastWeekWindowHtml = "";
  updateUpdatedValue(usageData);

  // Full error screen only when there is no usable data to show.
  if (!usageData.session) {
    content.innerHTML = `
      <div class="error">
        <strong>${escapeHtml(usageData.error || usageData.lastError || message("usageUnavailable"))}</strong>
        <p>${escapeHtml(usageData.hint || usageData.lastErrorHint || "")}</p>
      </div>
    `;
    return;
  }

  const rows = [usageRow(message("sessionUsage"), usageData.session, "session")];
  const weeklyRows = [];

  if (usageData.weekly) {
    weeklyRows.push(usageRow(message("weeklyUsage"), usageData.weekly, "weeklyCapacity"));
  }

  if (usageData.weeklyOpus) {
    weeklyRows.push(usageRow(message("opusWeeklyUsage"), usageData.weeklyOpus, "weeklyLegacy"));
  }

  if (weeklyRows.length) {
    rows.push(`
      <section class="weekly-group">
        ${weeklyRows.join("")}
        ${weeklyFooter(usageData)}
      </section>
    `);
  }

  content.innerHTML = rows.join("");
  updateUpdatedValue(usageData);
  updateWeeklyFooterState(usageData.weekly);
}

function applyStaleState(usageData) {
  // Last refresh failed but we still have usable numbers: flag them as stale.
  const updatedValue = document.getElementById("updatedValue");
  if (!updatedValue) return;

  const stale = Boolean(usageData.lastError && usageData.session);
  updatedValue.classList.toggle("is-stale", stale);
  updatedValue.title = stale ? message("refreshFailed") : "";
}

function updateLiveLabels() {
  updateCountdowns();
  if (currentUsageData) {
    updateUpdatedValue(currentUsageData);
    updateWeeklyFooterState(currentUsageData.weekly);
  }
}

function usageRow(label, windowData, toneMode) {
  const used = clampPercentage(windowData?.percentage || 0);
  const remaining = 100 - used;
  const reset = windowData?.resetsAt || "";
  const tone = barTone(remaining, reset, toneMode);
  const hasReset = Number.isFinite(new Date(reset).getTime());
  const resetLabel = hasReset ? formatReset(reset) : message("noResetTime");
  const resetMeta = hasReset
    ? `<span class="reset-time" data-reset="${escapeHtml(reset)}" data-reset-tooltip="${escapeHtml(formatResetDateTime(reset))}" tabindex="0">${escapeHtml(resetLabel)}</span>`
    : `<span>${escapeHtml(resetLabel)}</span>`;

  // "Remaining" is the primary number everywhere; the bar depletes as you consume.
  return `
    <article class="usage-row">
      <div class="usage-head">
        <span class="usage-title">${escapeHtml(label)}</span>
        <span class="usage-percent">${escapeHtml(message("remainingPercent", [remaining]))}</span>
      </div>
      <div class="track" role="progressbar" aria-valuenow="${remaining}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(label)}">
        <div class="fill ${tone}" style="width: ${remaining}%"></div>
      </div>
      <div class="usage-meta">
        <span>${escapeHtml(message("usagePercent", [used]))}</span>
        ${resetMeta}
      </div>
    </article>
  `;
}

function updateCountdowns() {
  document.querySelectorAll("[data-reset]").forEach((element) => {
    const reset = element.dataset.reset;
    if (!reset) return;
    element.textContent = formatReset(reset);
    element.dataset.resetTooltip = formatResetDateTime(reset);
  });
}

function barTone(remaining, reset, toneMode = "session") {
  const value = clampPercentage(remaining);

  if (toneMode === "weeklyCapacity" && hasWeeklyCapacityBuffer(value, reset)) {
    return "";
  }

  return quotaTone(value);
}

function weeklyFooter(usageData) {
  return `
    <div class="weekly-footer" aria-live="polite">
      <div class="weekly-window-setting">
        <label for="weeklyWindowInput">${escapeHtml(message("weeklyWindowSettingLabel"))}</label>
        <input id="weeklyWindowInput" class="weekly-window-input" type="number" min="${MIN_WEEKLY_FIVE_HOUR_WINDOWS}" max="${MAX_WEEKLY_FIVE_HOUR_WINDOWS}" step="1" value="${weeklyFiveHourWindows}" aria-label="${escapeHtml(message("weeklyWindowSettingInputAria"))}">
        <span class="weekly-window-help" tabindex="0" role="img" aria-label="${escapeHtml(message("weeklyWindowSettingHelp"))}" data-weekly-window-tooltip="${escapeHtml(message("weeklyWindowSettingHelp"))}">?</span>
      </div>
      <div class="weekly-actions" id="weeklyWindow">
        ${weekWindow(usageData.weekly, { includeToday: includeTodayInWeekWindow, weeklyWindows: weeklyFiveHourWindows })}
      </div>
    </div>
  `;
}

function handleWeekWindowToggle(event) {
  const target = event.target?.closest?.("[data-week-window-toggle]");
  if (!target) return;

  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();

  includeTodayInWeekWindow = !includeTodayInWeekWindow;
  lastWeekWindowHtml = "";
  chrome.storage.local.set({ [INCLUDE_TODAY_STORAGE_KEY]: includeTodayInWeekWindow });
  updateWeeklyFooterState(currentUsageData?.weekly);
}

function handleWeeklyWindowInputChange(event) {
  const target = event.target?.closest?.("#weeklyWindowInput");
  if (!target) return;

  const nextValue = normalizeWeeklyWindowCapacity(target.value);
  weeklyFiveHourWindows = nextValue;
  target.value = String(nextValue);
  lastWeekWindowHtml = "";
  chrome.storage.local.set({ [WEEKLY_WINDOW_STORAGE_KEY]: nextValue });

  if (currentUsageData) renderUsage(currentUsageData);
}

function updateUpdatedValue(usageData) {
  const updatedValue = document.getElementById("updatedValue");
  if (!updatedValue) return;

  updatedValue.textContent = formatUpdatedRelative(usageData.lastUpdated);
  applyStaleState(usageData);
}

function updateWeeklyFooterState(weeklyData) {
  const host = document.getElementById("weeklyWindow");
  if (!host) return;

  // Only repaint when the strip actually changes (a day or reset boundary
  // crossed). Repainting every tick would wipe the cell under the cursor and
  // make the hover tooltip flicker.
  const next = weekWindow(weeklyData, { includeToday: includeTodayInWeekWindow, weeklyWindows: weeklyFiveHourWindows });
  if (next === lastWeekWindowHtml && host.innerHTML) return;
  lastWeekWindowHtml = next;
  host.innerHTML = next;
}

function hasWeeklyCapacityBuffer(remaining, reset, weeklyWindows = weeklyFiveHourWindows) {
  const capacity = weeklyCapacity(remaining, reset, weeklyWindows);
  return Boolean(capacity && capacity.windowsPerDay >= capacity.neededPerDay);
}

function weeklyCapacity(remaining, reset, weeklyWindows = weeklyFiveHourWindows) {
  const resetIn = millisecondsUntil(reset);
  if (!Number.isFinite(resetIn) || resetIn <= 0) return null;

  const normalizedWeeklyWindows = normalizeWeeklyWindowCapacity(weeklyWindows);
  const remainingWindows = clampPercentage(remaining) / 100 * normalizedWeeklyWindows;
  const daysUntilReset = resetIn / DAY_MS;
  if (daysUntilReset <= 0) return null;

  return {
    remainingWindows,
    daysUntilReset,
    windowsPerDay: remainingWindows / daysUntilReset,
    neededPerDay: normalizedWeeklyWindows / WINDOW_DAYS,
  };
}

function weekWindowDays(weeklyData, now = new Date(), options = {}) {
  const includeToday = Boolean(options.includeToday);
  const weeklyWindows = normalizeWeeklyWindowCapacity(options.weeklyWindows ?? weeklyFiveHourWindows);
  const rawResetDate = weeklyData?.resetsAt ? new Date(weeklyData.resetsAt) : null;
  const hasReset = rawResetDate && Number.isFinite(rawResetDate.getTime());
  const resetDate = hasReset ? normalizeWeekWindowResetDate(rawResetDate) : null;

  if (!hasReset) {
    // No reset timestamp: render a neutral strip anchored on the current week.
    const neutralLastDay = startOfDay(now);
    return Array.from({ length: WINDOW_DAYS }, (_unused, index) => {
      const date = addDays(neutralLastDay, index - (WINDOW_DAYS - 1));
      return {
        state: "past",
        weekend: isWeekend(date),
        windows: null,
        tooltip: weekdayLabel(date),
      };
    });
  }

  const today = startOfDay(now);
  const todayTime = today.getTime();
  // Anchor the strip on the reset day (last cell), but guarantee "today" is
  // always visible. A fresh ~7-day window can put the reset day up to 7 days
  // out, which would push today off the left edge — clamp the last cell to at
  // most today+6 (and never before today) so "you are here" always shows.
  const latestLast = addDays(today, WINDOW_DAYS - 1);
  let lastDay = startOfDay(resetDate);
  if (lastDay.getTime() > latestLast.getTime()) lastDay = latestLast;
  if (lastDay.getTime() < todayTime) lastDay = today;
  const dates = Array.from({ length: WINDOW_DAYS }, (_unused, index) =>
    addDays(lastDay, index - (WINDOW_DAYS - 1))
  );

  const states = dates.map((date) => {
    const time = startOfDay(date).getTime();
    if (time < todayTime) return "past";
    if (time === todayTime) return "today";
    return "future";
  });
  const weekends = dates.map((date) => isWeekend(date));

  // By default today is only a "you are here" marker: its spend so far and
  // what's left of it are unknowable, so the remaining budget is spread across
  // full weekdays ahead. The toggle includes today in that even split.
  const remaining = 100 - clampPercentage(weeklyData.percentage || 0);
  const remainingWindows = (remaining / 100) * weeklyWindows;
  const resetDayTime = startOfDay(resetDate).getTime();
  let usableDays = 0;
  const firstAllocationDay = includeToday ? today : addDays(today, 1);
  for (let cursor = firstAllocationDay; cursor.getTime() <= resetDayTime; cursor = addDays(cursor, 1)) {
    if (!isWeekend(cursor)) usableDays += 1;
  }
  const perDay = usableDays > 0 ? remainingWindows / usableDays : 0;

  return dates.map((date, index) => {
    const state = states[index];
    const weekend = weekends[index];
    const tooltipParts = [weekdayLabel(date)];
    let windows = null;

    if (state === "today") {
      if (weekend) {
        windows = 0;
        tooltipParts.push(zeroWindowsLabel());
      } else if (includeToday) {
        windows = perDay;
        tooltipParts.push(message("dayWindows", [formatDecimal(perDay, 1)]));
      }
    } else if (state === "future") {
      windows = weekend ? 0 : perDay;
      tooltipParts.push(weekend ? zeroWindowsLabel() : message("dayWindows", [formatDecimal(perDay, 1)]));
    }

    return { state, weekend, windows, tooltip: tooltipParts.join(" · ") };
  });
}

function weekWindow(weeklyData, options = {}) {
  const includeToday = Boolean(options.includeToday);
  const weeklyWindows = normalizeWeeklyWindowCapacity(options.weeklyWindows ?? weeklyFiveHourWindows);
  const cells = weekWindowDays(weeklyData, new Date(), { includeToday, weeklyWindows })
    .map((cell) => {
      // The weekend "excluded / 0" look only applies to upcoming days; past and
      // current weekends just use their state styling.
      const weekendClass = cell.weekend && cell.state === "future" ? " day-cell--weekend" : "";
      const activeClass = cell.state === "today" && includeToday ? " day-cell--today-active" : "";
      const className = `day-cell day-cell--${cell.state}${weekendClass}${activeClass}`;
      const tooltip = cell.tooltip
        ? ` data-day-tooltip="${escapeHtml(cell.tooltip)}" tabindex="0"`
        : "";
      const toggle = cell.state === "today"
        ? ` data-week-window-toggle="true" role="button" aria-pressed="${includeToday ? "true" : "false"}" aria-label="${escapeHtml(cell.tooltip)}"`
        : "";
      return `<span class="${className}"${tooltip}${toggle}></span>`;
    })
    .join("");

  return `<div class="week-window" role="group" aria-label="${escapeHtml(message("weekWindowLabel"))}">${cells}</div>`;
}

function weekdayLabel(value) {
  return WEEKDAY_LABELS[new Date(value).getDay()];
}

function zeroWindowsLabel() {
  return "0 windows";
}

function normalizeWeekWindowResetDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return date;

  if (date.getHours() === 0) {
    date.setDate(date.getDate() - 1);
    date.setHours(23, 59, 59, 999);
  }

  return date;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function isWeekend(value) {
  const day = new Date(value).getDay();
  return day === 0 || day === 6;
}

function formatDecimal(value, digits) {
  return Number(value).toFixed(digits);
}

function quotaTone(remaining) {
  if (remaining <= 10) return "danger";
  if (remaining <= 30) return "warning";
  if (remaining <= 50) return "attention";
  return "";
}

function millisecondsUntil(value) {
  if (!value) return NaN;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return NaN;
  return timestamp - Date.now();
}

function formatUpdatedRelative(timestamp) {
  if (!timestamp) return message("never");

  const elapsed = Date.now() - timestamp;
  if (elapsed < 5000) return message("now");
  if (elapsed < 60000) {
    const seconds = Math.max(5, Math.round(elapsed / 5000) * 5);
    return message("secondsAgo", [seconds]);
  }

  const minutes = Math.round(elapsed / 60000);
  if (minutes <= 1) return message("minuteAgo");
  if (minutes < 60) return message("minutesAgo", [minutes]);

  const hours = Math.round(elapsed / 3600000);
  if (hours === 1) return message("hourAgo");
  if (hours < 24) return message("hoursAgo", [hours]);

  return new Date(timestamp).toLocaleDateString(chrome.i18n.getUILanguage(), {
    month: "short",
    day: "numeric",
  });
}

function formatReset(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return message("noResetTime");

  const remaining = timestamp - Date.now();
  if (remaining <= 0) return message("resetting");

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);

  if (days > 0) return message("resetInDaysHours", [days, hours]);
  if (hours > 0) return message("resetInHoursMinutes", [hours, minutes]);
  return message("resetInMinutes", [minutes]);
}

function formatResetDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return message("noResetTime");

  try {
    return new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch (_error) {
    return date.toLocaleString();
  }
}

function clampPercentage(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

function normalizeWeeklyWindowCapacity(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return DEFAULT_WEEKLY_FIVE_HOUR_WINDOWS;
  }
  const numeric = Number(value);
  const rounded = Number.isFinite(numeric) ? Math.round(numeric) : DEFAULT_WEEKLY_FIVE_HOUR_WINDOWS;
  return Math.max(MIN_WEEKLY_FIVE_HOUR_WINDOWS, Math.min(MAX_WEEKLY_FIVE_HOUR_WINDOWS, rounded));
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value);
  return element.innerHTML;
}

function message(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
}
