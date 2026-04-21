export class MirrorMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MirrorMatchError";
  }
}

export class InvalidPlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPlayError";
  }
}
