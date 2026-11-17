export class Camera {
  public x = 0;
  public y = 0;
  public shakeTimer = 0;
  public shakeMag = 0;
  private lookTimer = 0;
  private lookDir = 0;
  public tiltDelay = 0.6; // truelle.CameraTiltDelay

  shake(magnitude: number, duration = 0.14): void {
    this.shakeMag = Math.max(this.shakeMag, magnitude);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
  }

  update(
    dt: number,
    targetX: number,
    targetY: number,
    facing: 1 | -1,
    upHeld: boolean,
    downHeld: boolean,
    viewW: number,
    viewH: number,
    worldW: number,
    worldH: number
  ): void {
    if (upHeld) {
      this.lookTimer = this.lookDir === -1 ? this.lookTimer + dt : dt;
      this.lookDir = -1;
    } else if (downHeld) {
      this.lookTimer = this.lookDir === 1 ? this.lookTimer + dt : dt;
      this.lookDir = 1;
    } else {
      this.lookTimer = 0;
      this.lookDir = 0;
    }

    const lookAheadX = facing * 38;
    const lookAheadY = this.lookTimer >= this.tiltDelay ? this.lookDir * 72 : -24;
    const desiredX = targetX + lookAheadX - viewW / 2;
    const desiredY = targetY + lookAheadY - viewH / 2;

    const lerp = 1 - Math.pow(0.001, dt);
    this.x += (desiredX - this.x) * lerp;
    this.y += (desiredY - this.y) * lerp;

    this.x = Math.max(0, Math.min(Math.max(0, worldW - viewW), this.x));
    this.y = Math.max(0, Math.min(Math.max(0, worldH - viewH), this.y));

    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      if (this.shakeTimer === 0) this.shakeMag = 0;
    }
  }

  getOffset(): { ox: number; oy: number } {
    if (this.shakeTimer <= 0) return { ox: Math.round(this.x), oy: Math.round(this.y) };
    const sx = (Math.random() * 2 - 1) * this.shakeMag;
    const sy = (Math.random() * 2 - 1) * this.shakeMag;
    return { ox: Math.round(this.x + sx), oy: Math.round(this.y + sy) };
  }
}
