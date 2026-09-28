import { mount } from "svelte";
import App from "./core/App.svelte";
import "./core/ui/theme.css";
import { watchForUpdates } from "./core/update.ts";

const target = document.getElementById("app")!;
target.replaceChildren(); // remove the loading splash from index.html
mount(App, { target });
watchForUpdates();
