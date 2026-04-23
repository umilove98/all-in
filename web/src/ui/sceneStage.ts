/**
 * 공통 씬 스테이지 헬퍼. 핸드오프 디자인의 1600x1000 가상 스테이지를
 * 뷰포트에 맞춰 스케일링한다. Main·WaitingRoom 씬이 공유한다.
 */

const STAGE_W = 1600;
const STAGE_H = 1000;

interface Cleanup {
  __cleanup?: () => void;
}

/**
 * root 안에 `.scene-stage-wrap > .scene-stage` 구조를 만들고 반환.
 * 이미 존재하면 재사용 (씬 내부 innerHTML 업데이트 시 깜빡임 방지).
 * activeBodyClass 는 body 에 토글 — 기존 화면 배경 이미지를 숨기는 용도.
 */
export function ensureStage(
  root: HTMLElement,
  activeBodyClass: string,
): HTMLElement {
  // 다른 씬의 잔재 *-active 는 제거
  document.body.classList.forEach((c) => {
    if (c.endsWith("-active") && c !== activeBodyClass) {
      document.body.classList.remove(c);
    }
  });

  let wrap = root.querySelector<HTMLElement>(".scene-stage-wrap");
  if (!wrap) {
    root.innerHTML = "";
    wrap = document.createElement("div");
    wrap.className = "scene-stage-wrap";
    const stage = document.createElement("div");
    stage.className = "scene-stage";
    wrap.appendChild(stage);
    root.appendChild(wrap);
  }

  const stage = wrap.querySelector<HTMLElement>(".scene-stage")!;

  // 기존 리스너가 이미 붙어있으면 재사용, 아니면 새로 부착
  const host = wrap as HTMLElement & Cleanup;
  if (!host.__cleanup) {
    const fit = () => {
      const s = Math.min(
        window.innerWidth / STAGE_W,
        window.innerHeight / STAGE_H,
      );
      const ox = (window.innerWidth - STAGE_W * s) / 2;
      const oy = (window.innerHeight - STAGE_H * s) / 2;
      stage.style.left = `${ox}px`;
      stage.style.top = `${oy}px`;
      stage.style.transform = `scale(${s})`;
    };
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    host.__cleanup = () => {
      window.removeEventListener("resize", onResize);
      host.__cleanup = undefined;
    };
  }

  document.body.classList.add(activeBodyClass);
  return stage;
}

/**
 * 씬 전환 시 리스너 해제 + body 활성 클래스 제거. DOM 은 그대로 둬서
 * 다음 씬이 같은 스테이지를 재사용할 수 있도록 한다. 재사용 시 ensureStage
 * 가 리스너를 다시 부착한다. 스테이지 자체가 사라질 경우(root.innerHTML
 * 덮어쓰기)에는 호출한 쪽이 먼저 teardownStage 를 부르도록 한다.
 */
export function teardownStage(root: HTMLElement, activeBodyClass: string) {
  const wrap = root.querySelector<HTMLElement>(".scene-stage-wrap");
  if (wrap) {
    const host = wrap as HTMLElement & Cleanup;
    host.__cleanup?.();
  }
  document.body.classList.remove(activeBodyClass);
}

/** 공통 씬 크롬: bg / overlay / vignette / embers. 각 씬의 CSS 가 스타일 담당. */
export function sceneChromeHtml(): string {
  const embers: string[] = [];
  for (let i = 0; i < 18; i++) {
    const left = (i * 53) % 100;
    const delay = (i * 0.4) % 6;
    const duration = 7 + (i % 5);
    embers.push(
      `<span class="sceneEmber" style="left:${left}%;animation-delay:${delay}s;animation-duration:${duration}s"></span>`,
    );
  }
  return `
    <div class="sceneBg"></div>
    <div class="sceneOverlay"></div>
    <div class="sceneVignette"></div>
    <div class="sceneEmbers">${embers.join("")}</div>
  `;
}
