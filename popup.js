const content = document.getElementById("content");
const refreshButton = document.getElementById("refreshButton");
const WEEKLY_FIVE_HOUR_WINDOWS = 9;
const DAILY_FIVE_HOUR_WINDOW_PACE = WEEKLY_FIVE_HOUR_WINDOWS / 7;
const DAY_MS = 86400000;
const WINDOW_DAYS = 7;
let currentUsageData = null;
let lastWeekWindowHtml = "";

document.addEventListener("DOMContentLoaded", initializePopup);

function initializePopup() {
  localizeDocument();
  refreshButton.addEventListener("click", () => refreshUsage());
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
  chrome.storage.local.get("usageData", ({ usageData }) => {
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
      <div class="weekly-updated">
        <span class="summary-label">${escapeHtml(message("summaryUpdatedLabel"))}</span>
        <span class="summary-separator" aria-hidden="true">·</span>
        <strong id="updatedValue">${escapeHtml(formatUpdatedRelative(usageData.lastUpdated))}</strong>
      </div>
      <div class="weekly-actions" id="weeklyWindow">
        ${weekWindow(usageData.weekly)}
      </div>
    </div>
  `;
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
  const next = weekWindow(weeklyData);
  if (next === lastWeekWindowHtml && host.innerHTML) return;
  lastWeekWindowHtml = next;
  host.innerHTML = next;
}

function hasWeeklyCapacityBuffer(remaining, reset) {
  const capacity = weeklyCapacity(remaining, reset);
  return Boolean(capacity && capacity.windowsPerDay >= DAILY_FIVE_HOUR_WINDOW_PACE);
}

function weeklyCapacity(remaining, reset) {
  const resetIn = millisecondsUntil(reset);
  if (!Number.isFinite(resetIn) || resetIn <= 0) return null;

  const remainingWindows = clampPercentage(remaining) / 100 * WEEKLY_FIVE_HOUR_WINDOWS;
  const daysUntilReset = resetIn / DAY_MS;
  if (daysUntilReset <= 0) return null;

  return {
    remainingWindows,
    daysUntilReset,
    windowsPerDay: remainingWindows / daysUntilReset,
    neededPerDay: DAILY_FIVE_HOUR_WINDOW_PACE,
  };
}

function weekWindowDays(weeklyData, now = new Date()) {
  const resetDate = weeklyData?.resetsAt ? new Date(weeklyData.resetsAt) : null;
  const hasReset = resetDate && Number.isFinite(resetDate.getTime());

  if (!hasReset) {
    // No reset timestamp: render a neutral, tooltip-less strip.
    return Array.from({ length: WINDOW_DAYS }, () => ({
      state: "past",
      weekend: false,
      windows: null,
      tooltip: null,
    }));
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

  // Today is only a "you are here" marker: its spend so far and what's left of
  // it are unknowable, so we never put a number on it. The remaining budget is
  // spread evenly across every full day ahead until the reset — weekdays from
  // tomorrow through the reset day (weekends spend nothing). This counts the
  // true horizon, not the visible cells, so a clamped strip still divides by
  // the real number of days until the quota refreshes.
  const remaining = 100 - clampPercentage(weeklyData.percentage || 0);
  const remainingWindows = (remaining / 100) * WEEKLY_FIVE_HOUR_WINDOWS;
  const resetDayTime = startOfDay(resetDate).getTime();
  let usableDays = 0;
  for (let cursor = addDays(today, 1); cursor.getTime() <= resetDayTime; cursor = addDays(cursor, 1)) {
    if (!isWeekend(cursor)) usableDays += 1;
  }
  const perDay = usableDays > 0 ? remainingWindows / usableDays : 0;

  return dates.map((_date, index) => {
    const state = states[index];
    const weekend = weekends[index];
    let windows = null;
    let tooltip = null;
    if (state === "today") {
      tooltip = message("dayToday");
    } else if (state === "future") {
      windows = weekend ? 0 : perDay;
      tooltip = weekend
        ? message("dayWeekend")
        : message("dayWindows", [formatDecimal(perDay, 1)]);
    }
    return { state, weekend, windows, tooltip };
  });
}

function weekWindow(weeklyData) {
  const cells = weekWindowDays(weeklyData)
    .map((cell) => {
      // The weekend "excluded / 0" look only applies to upcoming days; past and
      // current weekends just use their state styling.
      const weekendClass = cell.weekend && cell.state === "future" ? " day-cell--weekend" : "";
      const className = `day-cell day-cell--${cell.state}${weekendClass}`;
      const tooltip = cell.tooltip
        ? ` data-day-tooltip="${escapeHtml(cell.tooltip)}" tabindex="0"`
        : "";
      return `<span class="${className}"${tooltip}></span>`;
    })
    .join("");

  return `<div class="week-window" role="img" aria-label="${escapeHtml(message("weekWindowLabel"))}">${cells}</div>`;
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

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value);
  return element.innerHTML;
}

function message(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
}
