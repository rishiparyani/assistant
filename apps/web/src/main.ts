import { mount } from "svelte";
import App from "./core/App.svelte";
import "./core/app.css";

mount(App, { target: document.getElementById("app")! });
