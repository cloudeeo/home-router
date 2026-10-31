"""Always-listening voice satellite for home-router.

Listens to the microphone for the wake word ("Hey Jarvis") on this machine only. After the wake word it records
until you stop talking, sends that one recording to home-router's /api/voice on the home server, and plays the
spoken reply. Nothing leaves this machine before the wake word.

    pip install -r requirements.txt
    python jarvis_satellite.py --server https://<server>.<tailnet>.ts.net:8443

Options: --threshold (wake word score, default 0.5), --device (microphone index, see --list-devices).
"""

import argparse
import base64
import io
import json
import sys
import time
import urllib.request
import wave

import numpy as np
import sounddevice as sd
import webrtcvad
from openwakeword.model import Model
from openwakeword.utils import download_models

RATE = 16000
CHUNK = 1280  # 80 ms, the frame size openWakeWord expects
VAD_FRAME = 480  # 30 ms, a frame size webrtcvad accepts


def beep(freq=880, ms=120, volume=0.2):
    t = np.arange(int(RATE * ms / 1000)) / RATE
    sd.play((volume * np.sin(2 * np.pi * freq * t)).astype(np.float32), RATE)
    sd.wait()


def to_wav(samples: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.astype(np.int16).tobytes())
    return buf.getvalue()


def play_wav(data: bytes):
    with wave.open(io.BytesIO(data), "rb") as w:
        rate = w.getframerate()
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    sd.play(audio, rate)
    sd.wait()


def record_utterance(stream, vad, max_s=12.0, silence_ms=900, start_timeout_s=5.0) -> np.ndarray:
    """Record until the speaker has been silent for silence_ms after speaking."""
    frames, voiced_seen, silent_ms, waited_ms = [], False, 0, 0
    while True:
        block, _ = stream.read(VAD_FRAME)
        pcm = block[:, 0]
        frames.append(pcm.copy())
        speech = vad.is_speech(pcm.tobytes(), RATE)
        if speech:
            voiced_seen, silent_ms = True, 0
        else:
            silent_ms += 30
            if not voiced_seen:
                waited_ms += 30
        if voiced_seen and silent_ms >= silence_ms:
            break
        if not voiced_seen and waited_ms >= start_timeout_s * 1000:
            return np.array([], dtype=np.int16)
        if len(frames) * 30 >= max_s * 1000:
            break
    return np.concatenate(frames)


def ask_server(server: str, wav: bytes) -> dict:
    req = urllib.request.Request(f"{server.rstrip('/')}/api/voice", data=wav, headers={"Content-Type": "audio/wav"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read())


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--server", required=False, help="home-router base URL, e.g. https://server.tailnet.ts.net:8443")
    p.add_argument("--wakeword", default="hey_jarvis")
    p.add_argument("--threshold", type=float, default=0.5)
    p.add_argument("--device", type=int, default=None, help="microphone index")
    p.add_argument("--list-devices", action="store_true")
    args = p.parse_args()

    if args.list_devices:
        print(sd.query_devices())
        return
    if not args.server:
        p.error("--server is required")

    download_models([args.wakeword])  # first run only; cached afterwards
    oww = Model(wakeword_models=[args.wakeword], inference_framework="onnx")
    vad = webrtcvad.Vad(2)

    print(f'Listening for "{args.wakeword.replace("_", " ")}" (Ctrl+C to stop). Nothing is sent before the wake word.')
    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=CHUNK, device=args.device) as stream:
        follow_up = False  # after "shall I search the web?" the next phrase needs no wake word
        while True:
            if not follow_up:
                block, _ = stream.read(CHUNK)
                scores = oww.predict(block[:, 0])
                if max(scores.values()) < args.threshold:
                    continue
                print("\n[wake word]")
            beep()
            audio = record_utterance(stream, vad)
            if audio.size == 0:
                print("  (nothing heard)")
                follow_up = False
                oww.reset()
                continue
            t = time.time()
            beep(660, 80)
            try:
                out = ask_server(args.server, to_wav(audio))
            except Exception as err:  # keep listening even if the server is down
                print(f"  server error: {err}")
                follow_up = False
                oww.reset()
                continue
            ms = out.get("timings", {})
            print(f'  you   [{out.get("lang")}]: {out.get("transcript")}')
            print(f'  jarvis ({out.get("route")}): {out.get("reply")}')
            print(f'  {time.time() - t:.1f} s round trip | stt {ms.get("sttMs")} ms, router {ms.get("routerMs")} ms, tts {ms.get("ttsMs")} ms')
            play_wav(base64.b64decode(out["audio"]))
            # Drop what the microphone heard while the reply was playing, so Jarvis does not wake itself up
            while stream.read_available >= CHUNK:
                stream.read(CHUNK)
            oww.reset()
            follow_up = bool(out.get("waitingForYesNo"))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
