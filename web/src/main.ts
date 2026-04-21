import "./styles.css";
import { App } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");
const fxRoot = document.querySelector<HTMLDivElement>("#fx-root");
if (!root || !fxRoot) throw new Error("#app / #fx-root element not found");

new App(root, fxRoot);
