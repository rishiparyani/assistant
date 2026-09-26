import { mount } from "svelte";
import App from "./core/App.svelte";
import "./core/ui/theme.css";

mount(App, { target: document.getElementById("app")! });
