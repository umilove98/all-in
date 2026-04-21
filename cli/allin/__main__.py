"""ALL-IN CLI entrypoint."""

from __future__ import annotations

import argparse
import sys

from . import __version__

# Windows 한글 콘솔(cp949)에서 유니코드 출력이 깨지는 걸 방지.
for _stream in (sys.stdout, sys.stderr):
    reconfigure = getattr(_stream, "reconfigure", None)
    if callable(reconfigure):
        try:
            reconfigure(encoding="utf-8")
        except Exception:
            pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="allin",
        description="ALL-IN (Bloodbet) — HP 베팅 1:1 카드 도박 게임",
    )
    parser.add_argument("--version", action="version", version=f"allin {__version__}")

    sub = parser.add_subparsers(dest="mode", metavar="MODE")

    sub.add_parser("hotseat", help="한 컴퓨터에서 번갈아 플레이")

    vs_ai = sub.add_parser("vs-ai", help="사람 vs AI")
    vs_ai.add_argument("--class", dest="player_class", choices=["berserker", "gambler", "warden"])
    vs_ai.add_argument("--difficulty", choices=["easy", "normal", "hard"], default="normal")

    host = sub.add_parser("host", help="네트워크 호스트")
    host.add_argument("--port", type=int, default=5555)

    join = sub.add_parser("join", help="네트워크 클라이언트")
    join.add_argument("--host", required=True)
    join.add_argument("--port", type=int, default=5555)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.mode is None:
        parser.print_help()
        return 0

    # 실제 모드 구현은 후속 Task 에서 연결. 지금은 스캐폴딩.
    print(f"[allin] mode={args.mode} (not implemented yet)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
