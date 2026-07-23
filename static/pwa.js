let installPrompt = null;

function isInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function syncInstallButton() {
  const button = document.getElementById("installAppBtn");
  if (button && isInstalledApp()) button.remove();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/static/service-worker.js"));
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  const button = document.getElementById("installAppBtn");
  if (button) button.classList.remove("hidden");
});

window.addEventListener("appinstalled", () => {
  const button = document.getElementById("installAppBtn");
  const hint = document.getElementById("installHint");
  if (button) button.remove();
  if (hint) hint.textContent = "QuizMark is installed on this device.";
});

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("installAppBtn");
  const hint = document.getElementById("installHint");
  syncInstallButton();
  if (!button) return;
  button.addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      button.classList.add("hidden");
    } else if (hint) {
      hint.textContent = "Use your browser menu and choose “Install app” or “Add to Home Screen”.";
    }
  });
});

window.matchMedia("(display-mode: standalone)").addEventListener("change", syncInstallButton);
