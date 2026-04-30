import "./styles.css";
// 디자인 핸드오프 번들의 원본 CSS — 6개 씬 전용. 각 파일은 프로토타입의 해당
// .css 파일을 그대로 복사한 것 (url 경로만 절대경로로 조정).
import "./ui/scenes/sceneShared.css";
import "./ui/scenes/mainStyle.css";
import "./ui/scenes/waitingRoomStyle.css";
import "./ui/scenes/classPickStyle.css";
import "./ui/scenes/draftStyle.css";
import "./ui/scenes/duelStyle.css";
import "./ui/scenes/endingStyle.css";
import "./ui/scenes/tournamentStyle.css";
// Minor overrides on top of the bundled CSS (hover z-index, tooltips, etc)
import "./ui/scenes/overrides.css";
import { App } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");
const fxRoot = document.querySelector<HTMLDivElement>("#fx-root");
if (!root || !fxRoot) throw new Error("#app / #fx-root element not found");

new App(root, fxRoot);
