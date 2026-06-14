const content = document.getElementById("content");
const summary = document.getElementById("summary");
const planSummaryItem = document.getElementById("planSummaryItem");
const planValue = document.getElementById("planValue");
const updatedValue = document.getElementById("updatedValue");
const refreshButton = document.getElementById("refreshButton");
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
  applyPlanState(usageData);
  updatedValue.textContent = formatUpdatedRelative(usageData.lastUpdated);
  applyStaleState(usageData);

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

  const rows = [usageRow(message("sessionUsage"), usageData.session)];

  if (usageData.weekly) {
    rows.push(usageRow(message("weeklyUsage"), usageData.weekly));
  }

  if (usageData.weeklyOpus) {
    rows.push(usageRow(message("opusWeeklyUsage"), usageData.weeklyOpus));
  }

  content.innerHTML = rows.join("");
}

function applyStaleState(usageData) {
  // Last refresh failed but we still have usable numbers: flag them as stale.
  const stale = Boolean(usageData.lastError && usageData.session);
  updatedValue.classList.toggle("is-stale", stale);
  updatedValue.title = stale ? message("refreshFailed") : "";
}

function updateLiveLabels() {
  updateCountdowns();
  if (currentUsageData) {
    updatedValue.textContent = formatUpdatedRelative(currentUsageData.lastUpdated);
  }
}

function usageRow(label, windowData) {
  const used = clampPercentage(windowData?.percentage || 0);
  const remaining = 100 - used;
  const reset = windowData?.resetsAt || "";

  // "Remaining" is the primary number everywhere; the bar depletes as you consume.
  return `
    <article class="usage-row">
      <div class="usage-head">
        <span class="usage-title">${escapeHtml(label)}</span>
        <span class="usage-percent">${escapeHtml(message("remainingPercent", [remaining]))}</span>
      </div>
      <div class="track" role="progressbar" aria-valuenow="${remaining}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(label)}">
        <div class="fill ${barTone(remaining)}" style="width: ${remaining}%"></div>
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

function barTone(remaining) {
  if (remaining <= 10) return "danger";
  if (remaining <= 30) return "warning";
  return "";
}

function applyPlanState(usageData) {
  const showPlan = shouldShowPlan(usageData);
  summary.classList.toggle("is-plan-hidden", !showPlan);
  planSummaryItem.hidden = !showPlan;
  planValue.textContent = showPlan ? usageData.plan : "";
}

function shouldShowPlan(usageData) {
  return Boolean(usageData?.planDetected === true && usageData.plan);
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
