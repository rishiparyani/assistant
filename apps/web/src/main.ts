import { mount } from "svelte";
import App from "./core/App.svelte";
import "./core/ui/theme.css";
import { watchForUpdates } from "./core/update.ts";
import { registerServiceWorker } from "./core/push.ts";
import { moveToDomain } from "./core/domain.ts";

// On an old address: go to gigspree.in instead of starting here.
if (!moveToDomain()) {
  const target = document.getElementById("app")!;
  target.replaceChildren(); // remove the loading splash from index.html
  mount(App, { target });
  watchForUpdates();
  registerServiceWorker();
}
