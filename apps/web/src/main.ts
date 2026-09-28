import { mount } from "svelte";
import App from "./core/App.svelte";
import "./core/ui/theme.css";

const target = document.getElementById("app")!;
target.replaceChildren(); // remove the loading splash from index.html
mount(App, { target });
