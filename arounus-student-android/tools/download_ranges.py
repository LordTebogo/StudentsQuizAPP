"""Resume a large official tool archive with concurrent byte-range requests."""
import concurrent.futures
import os
import pathlib
import sys
import time
import urllib.request


def main() -> None:
    source, target_name, total_text = sys.argv[1:4]
    target = pathlib.Path(target_name)
    total = int(total_text)
    existing = target.stat().st_size if target.exists() else 0
    partial = target.with_suffix(target.suffix + ".parallel")
    if not partial.exists():
        with partial.open("wb") as out:
            if existing:
                with target.open("rb") as old:
                    while block := old.read(1024 * 1024):
                        out.write(block)
            out.truncate(total)
    chunk = 2 * 1024 * 1024
    ranges = [(start, min(start + chunk - 1, total - 1)) for start in range(existing, total, chunk)]

    def fetch(span: tuple[int, int]) -> int:
        start, end = span
        for attempt in range(6):
            try:
                request = urllib.request.Request(source, headers={"Range": f"bytes={start}-{end}", "User-Agent": "ArounusAndroidBuild/1.0"})
                with urllib.request.urlopen(request, timeout=45) as response:
                    if response.status != 206:
                        raise RuntimeError(f"Expected partial content, got HTTP {response.status}")
                    data = response.read()
                if len(data) != end - start + 1:
                    raise RuntimeError(f"Incomplete range {start}-{end}: {len(data)} bytes")
                with partial.open("r+b") as out:
                    out.seek(start)
                    out.write(data)
                return len(data)
            except Exception:
                if attempt == 5:
                    raise
                time.sleep(2)
        return 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        done = 0
        for size in pool.map(fetch, ranges):
            done += size
            print(f"{existing + done}/{total}", flush=True)
    os.replace(partial, target)


if __name__ == "__main__":
    main()
