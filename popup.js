const content = document.getElementById("content");
const refreshButton = document.getElementById("refreshButton");
const WEEKLY_FIVE_HOUR_WINDOWS = 9;
const DAILY_FIVE_HOUR_WINDOW_PACE = WEEKLY_FIVE_HOUR_WINDOWS / 7;
const DAY_MS = 86400000;
const ANTHROPIC_PEAK_OFFSET_HOURS = 4;
const ANTHROPIC_PEAK_START_HOUR = 17;
const ANTHROPIC_PEAK_END_HOUR = 23;
const WEEKLY_CRITICAL_REMAINING = 10;
let currentUsageData = null;

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
  bindWeeklyPopovers();
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
        <span data-reset="${escapeHtml(reset)}">${reset ? formatReset(reset) : message("noResetTime")}</span>
      </div>
    </article>
  `;
}

function updateCountdowns() {
  document.querySelectorAll("[data-reset]").forEach((element) => {
    const reset = element.dataset.reset;
    if (reset) element.textContent = formatReset(reset);
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
  const peak = policyWindowStatus();

  return `
    <div class="weekly-footer" aria-live="polite">
      <div class="weekly-updated">
        <span class="summary-label">${escapeHtml(message("summaryUpdatedLabel"))}</span>
        <span class="summary-separator" aria-hidden="true">·</span>
        <strong id="updatedValue">${escapeHtml(formatUpdatedRelative(usageData.lastUpdated))}</strong>
      </div>
      <div class="weekly-actions">
        ${popoverControl({
          buttonId: "weeklyPaceButton",
          panelId: "weeklyPacePopover",
          className: "weekly-popover-label",
          label: "Pace",
          icon: infoIcon(),
          content: weeklyPacePopover(usageData.weekly),
        })}
        ${popoverControl({
          buttonId: "weeklyPeakButton",
          panelId: "weeklyPeakPopover",
          className: `weekly-popover-label weekly-peak-label${peak.active ? " is-active" : ""}`,
          label: "Peak",
          icon: peakIcon(),
          content: peakHoursPopover(peak),
        })}
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
  const pacePanel = document.getElementById("weeklyPacePopover");
  if (pacePanel) {
    pacePanel.innerHTML = weeklyPacePopover(weeklyData);
  }

  const peakButton = document.getElementById("weeklyPeakButton");
  const peakPanel = document.getElementById("weeklyPeakPopover");
  if (peakButton || peakPanel) {
    const peak = policyWindowStatus();
    if (peakButton) peakButton.classList.toggle("is-active", peak.active);
    if (peakPanel) peakPanel.innerHTML = peakHoursPopover(peak);
  }
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

function weeklyCapacityStatus(weeklyData) {
  if (!weeklyData) {
    return {
      state: "unknown",
      insight: "unknown",
      windowsLeft: "--",
      availablePerDay: "--",
      safePace: `${formatDecimal(DAILY_FIVE_HOUR_WINDOW_PACE, 2)}/day`,
      resetLabel: message("noResetTime"),
    };
  }

  const remaining = 100 - clampPercentage(weeklyData.percentage || 0);
  const capacity = weeklyCapacity(remaining, weeklyData.resetsAt);
  const resetLabel = weeklyData.resetsAt ? formatReset(weeklyData.resetsAt) : message("noResetTime");
  const remainingWindows = remaining / 100 * WEEKLY_FIVE_HOUR_WINDOWS;

  if (!capacity) {
    const fallbackState = quotaTone(remaining) === "danger" ? "critical" : quotaTone(remaining) ? "tight" : "on-track";
    return {
      state: fallbackState,
      insight: fallbackState === "on-track" ? "on pace" : fallbackState,
      windowsLeft: formatDecimal(remainingWindows, 1),
      availablePerDay: "--",
      safePace: `${formatDecimal(DAILY_FIVE_HOUR_WINDOW_PACE, 2)}/day`,
      resetLabel,
    };
  }

  const onTrack = capacity.windowsPerDay >= capacity.neededPerDay;
  const critical = remaining <= WEEKLY_CRITICAL_REMAINING && !onTrack;
  const state = critical ? "critical" : onTrack ? "on-track" : "tight";

  return {
    state,
    insight: state === "on-track" ? "on pace" : state,
    windowsLeft: formatDecimal(capacity.remainingWindows, 1),
    availablePerDay: `${formatDecimal(capacity.windowsPerDay, 2)}/day`,
    safePace: `${formatDecimal(capacity.neededPerDay, 2)}`,
    resetLabel,
  };
}

function weeklyCapacityTooltip(weeklyData) {
  if (!weeklyData) return "Weekly capacity: no weekly quota data yet.";

  const remaining = 100 - clampPercentage(weeklyData.percentage || 0);
  const capacity = weeklyCapacity(remaining, weeklyData.resetsAt);
  if (!capacity) return "Weekly capacity: reset time is unavailable, so status uses remaining percent.";

  const label = capacity.windowsPerDay >= capacity.neededPerDay ? "Weekly buffer" : "Weekly pressure";
  return `${label}: approx. ${formatDecimal(capacity.remainingWindows, 1)} five-hour windows left, approx. ${formatDecimal(capacity.windowsPerDay, 2)}/day until reset. Approx. safe pace: ${formatDecimal(capacity.neededPerDay, 2)}/day.`;
}

function policyWindowStatus(now = new Date()) {
  const peakNow = isAnthropicPeakWindow(now);
  const localWindow = formatPeakWindowForUser(now);

  return {
    active: peakNow,
    localWindow,
    message: peakNow
      ? `Active now. Claude quota may be draining faster until ${localWindow.localEnd}.`
      : "Claude quota may drain faster during this window.",
  };
}

function isAnthropicPeakWindow(now = new Date()) {
  const shifted = new Date(now.getTime() + ANTHROPIC_PEAK_OFFSET_HOURS * 3600000);
  const day = shifted.getUTCDay();
  const hour = shifted.getUTCHours();

  return day >= 1 && day <= 5 && hour >= ANTHROPIC_PEAK_START_HOUR && hour < ANTHROPIC_PEAK_END_HOUR;
}

function formatPeakWindowForUser(now = new Date()) {
  const gmt4Now = new Date(now.getTime() + ANTHROPIC_PEAK_OFFSET_HOURS * 3600000);
  const startUtc = Date.UTC(
    gmt4Now.getUTCFullYear(),
    gmt4Now.getUTCMonth(),
    gmt4Now.getUTCDate(),
    ANTHROPIC_PEAK_START_HOUR - ANTHROPIC_PEAK_OFFSET_HOURS,
    0,
    0
  );
  const endUtc = Date.UTC(
    gmt4Now.getUTCFullYear(),
    gmt4Now.getUTCMonth(),
    gmt4Now.getUTCDate(),
    ANTHROPIC_PEAK_END_HOUR - ANTHROPIC_PEAK_OFFSET_HOURS,
    0,
    0
  );
  const start = new Date(startUtc);
  const end = new Date(endUtc);

  return {
    localStart: formatLocalTime(start),
    localEnd: formatLocalTime(end),
    localRange: `${formatLocalTime(start)}-${formatLocalTime(end)}`,
  };
}

function formatLocalTime(value) {
  try {
    return new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value);
  } catch (_error) {
    return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
}

function weeklyPacePopover(weeklyData) {
  const status = weeklyCapacityStatus(weeklyData);
  return `
    <div class="popover-metrics">
      ${popoverMetric("Approx. windows left", status.windowsLeft)}
      ${popoverMetric("Approx. available/day", status.availablePerDay)}
      ${popoverMetric("Approx. safe pace", status.safePace)}
      ${popoverMetric("Insight", status.insight)}
    </div>
  `;
}

function peakHoursPopover(peak) {
  const activePrefix = peak.active ? "Active now. " : "";
  return `
    <p><strong>Peak window:</strong> weekdays ${escapeHtml(peak.localWindow.localRange)} your time.</p>
    <p>${escapeHtml(activePrefix)}Claude quota may drain faster during this window.</p>
  `;
}

function popoverMetric(label, value) {
  return `
    <p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>
  `;
}

function formatDecimal(value, digits) {
  return Number(value).toFixed(digits);
}

function popoverControl({ buttonId, panelId, className, label, icon, content }) {
  return `
    <div class="weekly-control">
      <button class="${escapeHtml(className)}" id="${escapeHtml(buttonId)}" type="button" aria-expanded="false" aria-controls="${escapeHtml(panelId)}">
        ${icon}
        <span>${escapeHtml(label)}</span>
      </button>
      <div class="weekly-popover" id="${escapeHtml(panelId)}" role="dialog" hidden>
        ${content}
      </div>
    </div>
  `;
}

function bindWeeklyPopovers() {
  document.querySelectorAll(".weekly-control").forEach((control) => {
    const button = control.querySelector("button");
    const panel = control.querySelector(".weekly-popover");
    if (!button || !panel) return;

    button.addEventListener("pointerdown", () => {
      control.dataset.pointerOpening = "true";
    });

    button.addEventListener("click", () => {
      const shouldOpen = button.getAttribute("aria-expanded") !== "true";
      delete control.dataset.pointerOpening;
      closeWeeklyPopovers(control);
      setPopoverOpen(button, panel, shouldOpen);
    });

    button.addEventListener("focus", () => {
      if (control.dataset.pointerOpening === "true") return;
      closeWeeklyPopovers(control);
      setPopoverOpen(button, panel, true);
    });

    control.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!control.contains(document.activeElement)) setPopoverOpen(button, panel, false);
      }, 0);
    });

    control.addEventListener("mouseenter", () => {
      closeWeeklyPopovers(control);
      setPopoverOpen(button, panel, true);
    });

    control.addEventListener("mouseleave", () => {
      if (!control.contains(document.activeElement)) setPopoverOpen(button, panel, false);
    });
  });
}

function closeWeeklyPopovers(except = null) {
  document.querySelectorAll(".weekly-control").forEach((control) => {
    if (control === except) return;
    const button = control.querySelector("button");
    const panel = control.querySelector(".weekly-popover");
    if (button && panel) setPopoverOpen(button, panel, false);
  });
}

function setPopoverOpen(button, panel, open) {
  button.setAttribute("aria-expanded", open ? "true" : "false");
  panel.hidden = !open;
}

function infoIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M12 11v5"></path>
      <path d="M12 8h.01"></path>
    </svg>
  `;
}

function peakIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v3"></path>
      <path d="M12 18v3"></path>
      <path d="m5.6 5.6 2.1 2.1"></path>
      <path d="m16.3 16.3 2.1 2.1"></path>
      <path d="M3 12h3"></path>
      <path d="M18 12h3"></path>
      <path d="m5.6 18.4 2.1-2.1"></path>
      <path d="m16.3 7.7 2.1-2.1"></path>
      <circle cx="12" cy="12" r="3.5"></circle>
    </svg>
  `;
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
