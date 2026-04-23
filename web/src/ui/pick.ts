/**
 * Pick 씬 디스패처 — phase=pick_class → Class Pick, phase=pick_boon → Boon Draft.
 * 씬 전환 시 이전 씬의 모듈 상태 리셋.
 */

import { App } from "../app";
import { renderClassPick, resetClassPickState } from "./scenes/classPick";
import {
  renderBoonDraft,
  resetBoonDraftState,
} from "./scenes/boonDraft";
import { teardownStage } from "./sceneStage";

const CP_ACTIVE = "cp-active";
const BD_ACTIVE = "bd-active";

export function renderPick(root: HTMLElement, app: App): void {
  const s = app.state;
  if (s.phase === "pick_class") {
    teardownStage(root, BD_ACTIVE);
    resetBoonDraftState();
    renderClassPick(root, app);
    return;
  }
  if (s.phase === "pick_boon") {
    teardownStage(root, CP_ACTIVE);
    resetClassPickState();
    renderBoonDraft(root, app);
    return;
  }
}
