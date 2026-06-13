const content = document.getElementById("content");
const planValue = document.getElementById("planValue");
const updatedValue = document.getElementById("updatedValue");
const refreshButton = document.getElementById("refreshButton");
let currentUsageData = null;

document.addEventListener("DOMContentLoaded", initializePopup);

function initializePopup() {
  refreshButton.addEventListener("click", refreshUsage);
  loadStoredUsage();
  setInterval(updateLiveLabels, 1000);
}

function loadStoredUsage() {
  chrome.runtime.sendMessage({ action: "getData" }, (usageData) => {
    if (usageData) {
      renderUsage(usageData);
      return;
    }

    refreshUsage();
  });
}

function refreshUsage() {
  refreshButton.disabled = true;
  refreshButton.classList.add("is-refreshing");

  chrome.runtime.sendMessage({ action: "refresh" }, (usageData) => {
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-refreshing");

    if (usageData) renderUsage(usageData);
  });
}

function renderUsage(usageData) {
  currentUsageData = usageData;
  planValue.textContent = displayPlan(usageData);
  updatedValue.textContent = formatUpdatedRelative(usageData.lastUpdated);

  if (usageData.error) {
    content.innerHTML = `
      <div class="error">
        <strong>${escapeHtml(usageData.error)}</strong>
        <p>${escapeHtml(usageData.hint || "")}</p>
      </div>
    `;
    return;
  }

  const rows = [
    usageRow("Session", usageData.session),
    usageRow("Weekly", usageData.weekly),
  ];

  if (usageData.weeklyOpus) {
    rows.push(usageRow("Opus weekly", usageData.weeklyOpus));
  }

  content.innerHTML = rows.join("");
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

  return `
    <article class="usage-row">
      <div class="usage-head">
        <span class="usage-title">${escapeHtml(label)}</span>
        <span class="usage-percent">${used}% used</span>
      </div>
      <div class="track" aria-hidden="true">
        <div class="fill ${barTone(used)}" style="width: ${used}%"></div>
      </div>
      <div class="usage-meta">
        <span>${remaining}% remaining</span>
        <span data-reset="${escapeHtml(reset)}">${reset ? formatReset(reset) : "No reset time"}</span>
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

function barTone(used) {
  if (used >= 90) return "danger";
  if (used >= 70) return "warning";
  return "";
}

function displayPlan(usageData) {
  if (usageData.error) return "Unknown";
  if (!usageData.plan || usageData.plan === "Unknown") return "Pro";
  return usageData.plan;
}

function formatUpdatedRelative(timestamp) {
  if (!timestamp) return "Never";

  const elapsed = Date.now() - timestamp;
  if (elapsed < 5000) return "now";
  if (elapsed < 60000) {
    const seconds = Math.max(5, Math.round(elapsed / 5000) * 5);
    return `${seconds}s ago`;
  }

  const minutes = Math.round(elapsed / 60000);
  if (minutes <= 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(elapsed / 3600000);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;

  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function formatReset(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "No reset time";

  const remaining = timestamp - Date.now();
  if (remaining <= 0) return "Resetting";

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);

  if (days > 0) return `Resets in ${days}d ${hours}h`;
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}

function clampPercentage(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value);
  return element.innerHTML;
}
