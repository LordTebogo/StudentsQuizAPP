let installPrompt = null;

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
  if (button) button.classList.add("hidden");
  if (hint) hint.textContent = "QuizMark is installed on this device.";
});

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("installAppBtn");
  const hint = document.getElementById("installHint");
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
