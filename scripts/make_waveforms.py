"""곡 미리듣기 파일에서 파형(막대 높이)을 뽑아 data/waveforms.json 에 저장한다. 곡을 추가·교체한 뒤 실행하고 결과를 커밋.

사용: python scripts/make_waveforms.py
각 곡: {"d": 길이(초), "p": [0~100 정수 막대 높이 × 96]} — 웹에서 곡 목록의 '큐 파형'(드롭 위치 표시)을 그리는 데 쓴다.
"""
import json, subprocess
from pathlib import Path
import numpy as np

SITE = Path(__file__).resolve().parent.parent
BARS = 96
data = json.loads((SITE / "data" / "tracks.json").read_text(encoding="utf-8"))
out = {}
for t in data["tracks"]:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(SITE / t["audio"]), "-ac", "1", "-ar", "8000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.abs(np.frombuffer(raw, dtype=np.float32))
    seg = np.array_split(x, BARS)
    rms = np.array([np.sqrt(np.mean(s ** 2)) if len(s) else 0 for s in seg])
    rms = rms / (rms.max() or 1)
    rms = rms ** 0.8  # 조용한 구간도 보이게 살짝 끌어올림
    out[t["slug"]] = {"d": round(len(x) / 8000, 1), "p": [int(round(v * 100)) for v in rms]}
    print(t["slug"], out[t["slug"]]["d"], "초")
(SITE / "data" / "waveforms.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
