export type ActionKey =
  | "left"
  | "right"
  | "up"
  | "down"
  | "jump"
  | "roll"
  | "primary"
  | "secondary"
  | "skill1"
  | "skill2"
  | "heal"
  | "interact"
  | "map";

const BINDINGS: Record<string, ActionKey> = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  Space: "jump",
  KeyK: "jump",
  ShiftLeft: "roll",
  ShiftRight: "roll",
  KeyL: "roll",
  KeyJ: "primary",
  KeyZ: "primary",
  KeyU: "secondary",
  KeyX: "secondary",
  KeyQ: "skill1",
  Digit1: "skill1",
  KeyE: "skill2",
  Digit2: "skill2",
  KeyR: "heal",
  KeyH: "heal",
  KeyF: "interact",
  Tab: "map",
};

export class InputManager {
  private held = new Set<ActionKey>();
  private justPressed = new Set<ActionKey>();
  private buffered = new Map<ActionKey, number>();

  constructor(canvas: HTMLCanvasElement, onFirstGesture?: () => void) {
    window.addEventListener("keydown", (e) => {
      onFirstGesture?.();
      const act = BINDINGS[e.code];
      if (!act) return;
      if (e.code === "Space" || e.code === "Tab" || e.code.startsWith("Arrow")) {
        e.preventDefault();
      }
      if (!this.held.has(act)) {
        this.justPressed.add(act);
        this.buffered.set(act, 0.14); // 140ms input buffer
      }
      this.held.add(act);
    });

    window.addEventListener("keyup", (e) => {
      const act = BINDINGS[e.code];
      if (act) this.held.delete(act);
    });

    canvas.addEventListener("mousedown", (e) => {
      onFirstGesture?.();
      const act: ActionKey = e.button === 2 ? "secondary" : "primary";
      if (!this.held.has(act)) {
        this.justPressed.add(act);
        this.buffered.set(act, 0.14);
      }
      this.held.add(act);
    });

    window.addEventListener("mouseup", (e) => {
      const act: ActionKey = e.button === 2 ? "secondary" : "primary";
      this.held.delete(act);
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("blur", () => {
      this.held.clear();
      this.justPressed.clear();
      this.buffered.clear();
    });
  }

  isDown(act: ActionKey): boolean {
    return this.held.has(act);
  }

  consume(act: ActionKey): boolean {
    if (this.justPressed.has(act) || (this.buffered.get(act) ?? 0) > 0) {
      this.justPressed.delete(act);
      this.buffered.delete(act);
      return true;
    }
    return false;
  }

  tick(dt: number): void {
    this.justPressed.clear();
    for (const [k, t] of this.buffered.entries()) {
      if (t - dt <= 0) this.buffered.delete(k);
      else this.buffered.set(k, t - dt);
    }
  }
}
