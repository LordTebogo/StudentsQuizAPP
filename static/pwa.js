let installPrompt = null;

function isInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function syncInstallButton() {
  const button = document.getElementById("installAppBtn");
  if (button && isInstalledApp()) button.remove();
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const encoded = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(encoded);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

async function notificationConfig() {
  const response = await fetch("/notifications/config");
  if (!response.ok) return { enabled: false };
  return response.json();
}

async function setupStudentPushNotifications() {
  const studentToken = sessionStorage.getItem("studentToken");
  if (!studentToken || !("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) return;

  const config = await notificationConfig().catch(() => ({ enabled: false }));
  if (!config.enabled || !config.public_key) return;

  const navigation = document.querySelector("#appWrap header.top nav") || document.querySelector("header.top nav");
  if (!navigation || document.getElementById("notificationToggle")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "notificationToggle";
  button.className = "notification-toggle";
  button.title = "Manage QuizMark notifications on this device";
  navigation.appendChild(button);

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  const paint = () => {
    if (Notification.permission === "denied") {
      button.textContent = "Alerts blocked";
      button.disabled = true;
    } else if (subscription) {
      button.textContent = "Alerts on";
      button.classList.add("is-on");
    } else {
      button.textContent = "Enable alerts";
      button.classList.remove("is-on");
    }
  };
  paint();

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (subscription) {
        if (!window.confirm("Turn off QuizMark notifications on this device?")) return;
        await fetch("/student/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "X-Student-Token": studentToken },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
        subscription = null;
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
        const newSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.public_key),
        });
        const response = await fetch("/student/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Student-Token": studentToken },
          body: JSON.stringify(newSubscription.toJSON()),
        });
        if (!response.ok) {
          await newSubscription.unsubscribe();
          throw new Error("Could not save notification settings");
        }
        subscription = newSubscription;
      }
    } catch (_) {
      button.textContent = "Alerts unavailable";
    } finally {
      button.disabled = false;
      paint();
    }
  });
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
  if (button) {
    button.addEventListener("click", async () => {
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        button.classList.add("hidden");
      } else if (hint) {
        hint.textContent = "Use your browser menu and choose Install app or Add to Home Screen.";
      }
    });
  }
  setupStudentPushNotifications();
});

window.matchMedia("(display-mode: standalone)").addEventListener("change", syncInstallButton);
