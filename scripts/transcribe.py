import sys, json
from faster_whisper import WhisperModel

def main():
  if len(sys.argv) < 2:
    print(json.dumps({"error": "usage: transcribe.py <audio_path> [model_size]"}))
    sys.exit(2)

  audio_path = sys.argv[1]
  model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

  model = WhisperModel(model_size, device="cpu", compute_type="int8")
  segments, info = model.transcribe(audio_path, vad_filter=True, beam_size=5)

  text_parts = []
  for s in segments:
    t = (s.text or "").strip()
    if t:
      text_parts.append(t)

  print(json.dumps({
    "language": getattr(info, "language", None),
    "text": " ".join(text_parts)
  }, ensure_ascii=False))

if __name__ == "__main__":
  main()
