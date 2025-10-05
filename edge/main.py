import json
import os
import time
import uuid
import re
import threading
from collections import deque
import platform

import cv2
import requests

try: 
    import serial
    from serial.tools import list_ports
except ImportError as exc: 
    raise ImportError(
        "pyserial must be installed to use serial communication"
    ) from exc

# Gemini requirements
from google import genai
from google.genai import types

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or ""

# Roboflow configuration via environment
ROBOFLOW_API_KEY = os.environ.get("ROBOFLOW_API_KEY") or ""
ROBOFLOW_MODEL_URL = (
    os.environ.get("ROBOFLOW_MODEL_URL")
    or "https://serverless.roboflow.com/infer/workflows/ftc16031/detect-and-classify-2"
)
try:
    ROBOFLOW_CONFIDENCE = int(os.environ.get("ROBOFLOW_CONFIDENCE") or "40")
except ValueError:
    ROBOFLOW_CONFIDENCE = 40

SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or (
        os.environ.get("SUPABASE_PROJECT_ID")
        and f"https://{os.environ['SUPABASE_PROJECT_ID']}.supabase.co"
    )
    or ""
)
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or ""
EDGE_DEVICE_LABEL = os.environ.get("EDGE_DEVICE_LABEL") or os.environ.get(
    "NEXT_PUBLIC_KIOSK_EDGE_DEVICE_LABEL",
    "demo_kiosk",
)

# Global category ID mapping used for ESP32 commands and edge → backend slug mapping
# 1: Cans, 2: Bottles, 3: Garbage
CATEGORY_ID_TO_SLUG = {
    1: "can",
    2: "bottle",
    3: "garbage",
}

ESP32_BAUDRATE = 9600
ESP32_COM_PORT_OVERRIDE = None


class SerialESP32Client:
    """Handle direct serial communication with the ESP32 controller."""

    _PREFERRED_KEYWORDS = (
        # Common Arduino/ESP32/USB-serial identifiers
        "arduino",
        "esp",
        "cp210",
        "ch340",
        "ftdi",
        "ft232",
        "wch",
        "silicon labs",
        # Generic USB serial hints
        "usbserial",
        "usb modem",
        "usbmodem",
        "serial",
        # Some OS-specific tokens
        "ttyacm",
        "ttyusb",
    )

    def __init__(self, *, com_override=None, baudrate=ESP32_BAUDRATE, timeout=0.1):
        self._com_override = (com_override or "").strip() or None
        self._baudrate = baudrate
        self._timeout = timeout
        self._serial = None
        self._last_port = None
        # Background reader + caches
        self._reader_thread = None
        self._stop_event = threading.Event()
        self._state_lock = threading.Lock()
        self._io_lock = threading.Lock()
        self._last_state_line = None
        self._last_state_tuple = (False, False)
        self._lines_buffer = deque(maxlen=200)

    @classmethod
    def from_env(cls):
        return cls(com_override=ESP32_COM_PORT_OVERRIDE)

    def _auto_detect_port(self):
        ports = list(list_ports.comports())
        if not ports:
            raise RuntimeError("No serial ports detected while auto-discovering ESP32.")

        def _matches(port):
            desc = (port.description or "").lower()
            manu = (port.manufacturer or "").lower()
            dev = (getattr(port, "device", "") or "").lower()
            return (
                any(keyword in desc for keyword in self._PREFERRED_KEYWORDS)
                or any(keyword in manu for keyword in self._PREFERRED_KEYWORDS)
                or any(keyword in dev for keyword in ("usbmodem", "usbserial", "ttyacm", "ttyusb", "cu.usb", "tty.usb"))
            )

        prioritized = [port for port in ports if _matches(port)]

        selected = prioritized[0] if prioritized else ports[0]
        print(f"[ESP32] Auto-detected serial port: {selected.device} ({selected.description})")
        return selected.device

    def _resolve_port(self):
        if self._com_override:
            return self._com_override
        return self._auto_detect_port()

    def _ensure_connection(self):
        if self._serial and self._serial.is_open:
            return self._serial

        port = self._resolve_port()
        try:
            self._serial = serial.Serial(
                port=port,
                baudrate=self._baudrate,
                timeout=self._timeout,
                write_timeout=self._timeout,
            )
            self._last_port = port
            print(f"[ESP32] Opened serial connection on {port} at {self._baudrate} baud.")
            time.sleep(2.0)  # allow ESP32 time to reset after connection
            # Clear any boot noise or stale bytes from device reset
            try:
                if hasattr(self._serial, "reset_input_buffer"):
                    self._serial.reset_input_buffer()
                else:
                    self._serial.flushInput()
            except Exception:
                pass
            # Start reader thread if not running
            self._start_reader()
        except serial.SerialException as exc:
            raise RuntimeError(f"Failed to open serial port '{port}': {exc}") from exc

        return self._serial

    def send_command(self, command_value):
        connection = self._ensure_connection()
        payload = f"{command_value}\n".encode("utf-8")
        try:
            with self._io_lock:
                connection.reset_output_buffer()
                connection.write(payload)
                connection.flush()
            port_source = "override" if self._com_override else "auto"
            print(
                f"[ESP32] Command '{command_value}' sent over serial"
                f" ({port_source} port {self._last_port})"
            )
        except serial.SerialException as exc:
            if connection:
                try:
                    connection.close()
                except Exception:
                    pass
                self._serial = None
            raise RuntimeError(f"Failed to write to ESP32 over serial: {exc}") from exc
        return True

    def read_line(self):
        """Read a single newline-terminated line from serial, decoded as UTF-8."""
        connection = self._ensure_connection()
        try:
            raw = connection.readline()
            return raw.decode("utf-8", errors="replace").strip()
        except serial.SerialException as exc:
            raise RuntimeError(f"Failed to read from ESP32 over serial: {exc}") from exc

    def _reader_loop(self):
        while not self._stop_event.is_set():
            try:
                # Ensure we have a live connection each iteration
                if not self._serial or not self._serial.is_open:
                    self._ensure_connection()
                conn = self._serial
                if conn is None:
                    time.sleep(0.05)
                    continue
                raw = conn.readline()
                if not raw:
                    # Timeout reached; loop
                    continue
                text = raw.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                with self._state_lock:
                    self._lines_buffer.append(text)
                    m = _STATE_RE.search(text)
                    if m:
                        a, b = m.group(1), m.group(2)
                        self._last_state_line = text
                        self._last_state_tuple = (a == "1", b == "1")
            except Exception:
                # Soft-fail; brief sleep to avoid tight loop on error
                time.sleep(0.02)

    def _start_reader(self):
        if self._reader_thread and self._reader_thread.is_alive():
            return
        self._stop_event.clear()
        self._reader_thread = threading.Thread(target=self._reader_loop, name="SerialReader", daemon=True)
        self._reader_thread.start()

    def get_latest_state(self):
        """Return the latest parsed (isMoving, isTriggered) after draining input."""
        # Ensure connection and reader are active
        try:
            self._ensure_connection()
        except Exception:
            pass
        with self._state_lock:
            return self._last_state_tuple

    def get_recent_lines(self, n=10):
        with self._state_lock:
            if n <= 0:
                return []
            return list(deque(self._lines_buffer, maxlen=n))

    def reset_input_buffer(self):
        """Clear any pending bytes from the serial input buffer."""
        connection = self._ensure_connection()
        try:
            # Prefer modern API; fall back if unavailable
            if hasattr(connection, "reset_input_buffer"):
                connection.reset_input_buffer()
            else:  # pragma: no cover - legacy pyserial
                connection.flushInput()
        except serial.SerialException as exc:
            raise RuntimeError(f"Failed to reset ESP32 input buffer: {exc}") from exc


_serial_client = None
_edge_device_id = None


def get_serial_client():
    global _serial_client
    if _serial_client is None:
        _serial_client = SerialESP32Client.from_env()
    return _serial_client

def esp32Command(command):
    """Send a command value to ESP32 via direct serial communication."""

    print(f"[ESP32] Sending command to ESP32: {command}")
    try:
        client = get_serial_client()
        client.send_command(command)
        return 1
    except Exception as exc: 
        print(f"[ESP32] Failed to send command: {exc}")
        return 0


def _supabase_headers():
    if not SUPABASE_SERVICE_KEY:
        raise EnvironmentError(
            "SUPABASE_SERVICE_KEY must be set for edge to publish classifications."
        )

    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def _get_edge_device_id():
    global _edge_device_id
    if _edge_device_id or not SUPABASE_URL:
        return _edge_device_id

    if not EDGE_DEVICE_LABEL:
        raise EnvironmentError("EDGE_DEVICE_LABEL must be provided")

    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/edge_devices",
        params={"label": f"eq.{EDGE_DEVICE_LABEL}", "select": "id"},
        headers=_supabase_headers(),
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()
    if not data:
        raise RuntimeError(
            f"Edge device with label '{EDGE_DEVICE_LABEL}' not found in Supabase."
        )

    _edge_device_id = data[0]["id"]
    print(f"[Supabase] Edge device id resolved: {_edge_device_id}")
    return _edge_device_id


def _get_active_session_id():
    if not SUPABASE_URL:
        print("[Supabase] SUPABASE_URL not configured; cannot fetch active session")
        return None

    try:
        edge_device_id = _get_edge_device_id()
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[Supabase] Failed to resolve edge device id: {exc}")
        edge_device_id = None

    params = {
        "status": "eq.active",
        "select": "id,edge_device_id,started_at",
        "limit": 1,
        "order": "started_at.desc",
    }

    if edge_device_id:
        params["edge_device_id"] = f"eq.{edge_device_id}"

    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/sessions",
            params=params,
            headers=_supabase_headers(),
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        if not data:
            print("[Supabase] No active session found for this edge device.")
            return None
        return data[0]["id"]
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[Supabase] Failed to fetch active session: {exc}")
        return None


def publish_classification(category_slug, confidence=None, raw_payload=None):
    if not SUPABASE_URL:
        print("[Supabase] SUPABASE_URL missing; classification not published")
        return False

    session_id = _get_active_session_id()
    if not session_id:
        print("[Supabase] Skipping publish because there is no active session.")
        return False

    payload = {
        "sessionId": session_id,
        "categorySlug": category_slug,
        "confidence": confidence,
        "rawPayload": raw_payload or {},
        "clientRef": str(uuid.uuid4()),
    }

    try:
        response = requests.post(
            f"{SUPABASE_URL}/functions/v1/record-item",
            headers=_supabase_headers(),
            json=payload,
            timeout=15,
        )
        if response.status_code >= 400:
            print(
                f"[Supabase] record-item failed: {response.status_code} {response.text.strip()}"
            )
            return False
        print("[Supabase] Classification published for session", session_id)
        return True
    except Exception as exc:
        print(f"[Supabase] Failed to publish classification: {exc}")
        return False
_STATE_RE = re.compile(r"\(?\s*([01])\s*[,\s]\s*([01])\s*\)?")

def currentState():
    """Return latest device state (isMoving, isTriggered) using captured lines.

    Drains serial input to the most recent complete line and returns the last
    valid parsed tuple. If nothing has been parsed yet, returns (False, False).
    """
    try:
        state = get_serial_client().get_latest_state()
        print(f"[ESP32] Current state: {state}")
        if isinstance(state, tuple) and len(state) == 2:
            return bool(state[0]), bool(state[1])
        return False, False
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[ESP32] Read error: {exc}")
        return False, False
    

def _open_camera(index=0):
    """Open camera consistently using the same backend; prefer DirectShow on Windows.

    Falls back to default backend if DirectShow fails. Attempts to reduce buffer
    latency by setting CAP_PROP_BUFFERSIZE to 1 when supported.
    """
    cap = None
    backend_tried = []
    try:
        if platform.system() == "Windows":
            # Prefer DirectShow first on Windows; then MSMF; finally default
            backends = []
            if hasattr(cv2, "CAP_DSHOW"):
                backends.append(cv2.CAP_DSHOW)
            if hasattr(cv2, "CAP_MSMF"):
                backends.append(cv2.CAP_MSMF)
            backends.append(0)  # default

            for backend in backends:
                backend_tried.append(backend)
                try:
                    try:
                        name = "CAP_DSHOW" if backend == getattr(cv2, "CAP_DSHOW", -1) else (
                            "CAP_MSMF" if backend == getattr(cv2, "CAP_MSMF", -2) else "DEFAULT"
                        )
                        print(f"[Webcam] Opening camera index {index} with {name}...")
                    except Exception:
                        pass
                    c = cv2.VideoCapture(index, backend)
                    if c.isOpened():
                        print("[Webcam] Camera opened.")
                        cap = c
                        break
                    else:
                        c.release()
                except Exception:
                    try:
                        c.release()
                    except Exception:
                        pass
            if cap is None:
                cap = cv2.VideoCapture(index)
        else:
            # Non-Windows: default backend
            cap = cv2.VideoCapture(index)
    except Exception:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
        cap = cv2.VideoCapture(index)

    # Avoid forcing tiny buffers on Windows DirectShow; can starve pipeline
    try:
        if platform.system() != "Windows":
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap
class FrameGrabber:
    """Continuously captures frames on a background thread and stores latest.

    This avoids starving the capture backend during long operations (network/IO),
    which can cause repeated read failures on Windows.
    """

    def __init__(self, index=0):
        self._index = index
        self._cap = None
        self._thread = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._latest = None
        self._latest_ts = 0.0
        self._ok = False
        self._fail_count = 0
        self._last_reopen = 0.0
        # Conservative thresholds to avoid thrashing the driver
        self._max_fail_before_reopen = 60  # ~2 seconds @30fps
        self._reopen_cooldown_sec = 3.0

    def start(self):
        if self._thread and self._thread.is_alive():
            return True
        self._cap = _open_camera(self._index)
        if not self._cap or not self._cap.isOpened():
            raise RuntimeError("Unable to open webcam (device index 0).")
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="FrameGrabber", daemon=True)
        self._thread.start()
        return True

    def _maybe_reopen(self):
        now = time.time()
        if now - self._last_reopen < self._reopen_cooldown_sec:
            return
        self._last_reopen = now
        try:
            if self._cap:
                self._cap.release()
        except Exception:
            pass
        time.sleep(0.5)
        self._cap = _open_camera(self._index)
        self._fail_count = 0

    def _loop(self):
        while not self._stop.is_set():
            cap = self._cap
            if cap is None or not cap.isOpened():
                self._maybe_reopen()
                time.sleep(0.05)
                continue
            ok, frame = cap.read()
            if ok:
                with self._lock:
                    self._latest = frame
                    self._latest_ts = time.time()
                    self._ok = True
                self._fail_count = 0
            else:
                self._fail_count += 1
                if self._fail_count >= self._max_fail_before_reopen:
                    self._maybe_reopen()
                # Small sleep avoids tight loop on failure
                time.sleep(0.005)

    def get_latest_frame(self, *, copy=True):
        with self._lock:
            frame = self._latest
            if frame is None:
                return None
            return frame.copy() if copy else frame

    def stop(self):
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.5)
        try:
            if self._cap:
                self._cap.release()
        except Exception:
            pass
        self._cap = None

def recognizeAndValidate(get_frame, image, *, retry_count=1, retry_sleep=0.05):
    """Run Roboflow and Gemini; if mismatch, retry with a new frame once.

    Returns a single category_id per policy:
    - If results match on any attempt, return that category_id (Roboflow/Gemini agree).
    - If mismatch persists after retry, return Gemini's result.
    """
    try:
        rf1 = recognizeImage(image)
    except Exception as exc:
        print(f"[Validate] Roboflow failed on first attempt: {exc}")
        rf1 = None
    try:
        gm1 = recognizeImage_gemini(image)
    except Exception as exc:
        print(f"[Validate] Gemini failed on first attempt: {exc}")
        gm1 = None

    if rf1 is not None and gm1 is not None:
        if rf1 == gm1:
            print(f"[Validate] Agreement on first attempt: {rf1}")
            return rf1
    elif rf1 is not None and gm1 is None:
        # If Gemini failed entirely, return Roboflow
        return rf1
    elif gm1 is not None and rf1 is None:
        return gm1

    # Mismatch or both failed; retry once if allowed
    if retry_count > 0:
        time.sleep(max(0.0, retry_sleep))
        frame2 = get_frame(copy=True)
        if frame2 is None:
            frame2 = image
        try:
            rf2 = recognizeImage(frame2)
        except Exception as exc:
            print(f"[Validate] Roboflow failed on retry: {exc}")
            rf2 = None
        try:
            gm2 = recognizeImage_gemini(frame2)
        except Exception as exc:
            print(f"[Validate] Gemini failed on retry: {exc}")
            gm2 = None

        if rf2 is not None and gm2 is not None:
            if rf2 == gm2:
                print(f"[Validate] Agreement on retry: {rf2}")
                return rf2
            # Still mismatch → prefer Gemini
            print(f"[Validate] Mismatch persists; choosing Gemini: {gm2}")
            return gm2
        # If only one succeeded, return that one; else default to garbage (3)
        return rf2 if rf2 is not None else (gm2 if gm2 is not None else 3)

    # No retries configured and mismatch: prefer Gemini if present
    return gm1 if gm1 is not None else (rf1 if rf1 is not None else 3)

def webcamFeed(*, max_frames=None, delay_seconds=0, show_window=True):
    """Continuously read frames from webcam, classify, and command ESP32."""

    cam_index = 0
    try:
        cam_index = int(os.environ.get("CAMERA_INDEX", "0"))
    except Exception:
        cam_index = 0
    grabber = FrameGrabber(index=cam_index)
    grabber.start()
    print("[Webcam] Frame grabber started.")

    if show_window:
        cv2.namedWindow("Recycle Sorter", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("Recycle Sorter", 960, 540)
        print("[Webcam] Preview window created.")

    processed = 0

    try:
        while True:
            frame = grabber.get_latest_frame(copy=True)
            if frame is None:
                print("[Webcam] Waiting for first frame...")
                time.sleep(0.05)
                continue

            if show_window:
                cv2.imshow("Recycle Sorter", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    print("[Webcam] Quit signal received.")
                    break

            # Wait for ultrasonic trigger from serial: (isMoving, isTriggered)
            isMoving, isTriggered = currentState()
            while not isTriggered:
                print("[Webcam] Waiting for trigger...")
                # Keep UI responsive and avoid busy-wait
                if show_window:
                    frame2 = grabber.get_latest_frame(copy=True)
                    if frame2 is not None:
                        cv2.imshow("Recycle Sorter", frame2)
                        if cv2.waitKey(1) & 0xFF == ord("q"):
                            print("[Webcam] Quit signal received.")
                            raise KeyboardInterrupt
                time.sleep(0.05)
                isMoving, isTriggered = currentState()

            print("[Webcam] Trigger received.")
            # Capture a fresh frame at trigger time
            frame3 = grabber.get_latest_frame(copy=True)
            frame_to_use = frame3 if frame3 is not None else frame
            # Validate by cross-checking Roboflow and Gemini with one retry on mismatch
            category_id = recognizeAndValidate(grabber.get_latest_frame, frame_to_use, retry_count=1)
            category_slug = CATEGORY_ID_TO_SLUG.get(category_id, "garbage")

            raw_payload = {
                "recognized_category_id": category_id,
                "source": "edge-computer",
            }

            publish_classification(
                category_slug=category_slug,
                confidence=None,
                raw_payload=raw_payload,
            )

            esp32Command(category_id)
            print(f"[ESP32] Command sent to ESP32: {category_id}")

            # Wait for movement to stop (isMoving becomes 0)
            isMoving, isTriggered = currentState()
            while isMoving:
                print("[Webcam] Waiting for movement to stop...")
                time.sleep(0.05)
                isMoving, isTriggered = currentState()
            print("[ESP32] Movement completed.")
            processed += 1

            if max_frames is not None and processed >= max_frames:
                break

            if delay_seconds:
                time.sleep(delay_seconds)
    finally:
        grabber.stop()
        if show_window:
            cv2.destroyWindow("Recycle Sorter")

def _image_to_part(image, mime_type="image/jpeg"):
    """Convert a webcam frame or raw bytes into a Gemini content part."""

    if isinstance(image, (bytes, bytearray, memoryview)):
        image_bytes = bytes(image)
    else:
        success, buffer = cv2.imencode(".jpg", image)
        if not success:
            raise ValueError("Failed to encode image frame to JPEG for Gemini request.")
        image_bytes = buffer.tobytes()
        mime_type = "image/jpeg"

    return types.Part.from_bytes(data=image_bytes, mime_type=mime_type)

def _encode_jpeg(image):
    """Encode an image/frame to JPEG bytes."""
    if isinstance(image, (bytes, bytearray, memoryview)):
        return bytes(image)
    success, buffer = cv2.imencode(".jpg", image)
    if not success:
        raise ValueError("Failed to encode image frame to JPEG for request.")
    return buffer.tobytes()

def _parse_workflow_from_url(url):
    """Return (workspace, workflow_id) parsed from a Roboflow Workflows URL or None.

    Accepts editor URLs (app.roboflow.com/<workspace>/workflows/edit/<workflow>)
    and API-like paths (/workflows/<workspace>/<workflow> or /<workspace>/workflows/<workflow>).
    """
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        parts = [x for x in p.path.split("/") if x]
        # app.roboflow.com/<workspace>/workflows/edit/<workflow>
        if p.netloc.lower().startswith("app.roboflow.com") and len(parts) >= 4 and parts[1] == "workflows" and parts[2] == "edit":
            return parts[0], parts[3]
        # serverless: /infer/workflows/<workspace>/<workflow>
        if len(parts) >= 4 and parts[0] == "infer" and parts[1] == "workflows":
            return parts[2], parts[3]
        # api/workflows/<workspace>/<workflow>
        if len(parts) >= 3 and parts[0] == "workflows":
            return parts[1], parts[2]
        # api/<workspace>/workflows/<workflow>
        if len(parts) >= 3 and parts[1] == "workflows" and parts[0] not in ("infer",):
            return parts[0], parts[2]
    except Exception:
        pass
    return None, None

def _is_serverless_workflows_url(url):
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        return (
            p.netloc.lower().startswith("serverless.roboflow.com")
            and "/infer/workflows/" in p.path
        )
    except Exception:
        return False

def _normalize_roboflow_url(url, api_key, confidence=None):
    """Return a proper Roboflow inference URL.

    - If a UI/editor URL is provided (app.roboflow.com/.../workflows/edit/<name>), convert it to
      the API form (api.roboflow.com/workflows/<workspace>/<workflow>).
    - Otherwise, pass through the given URL.
    Appends api_key and confidence as query parameters if not present.
    """
    try:
        from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

        parsed = urlparse(url)
        netloc = parsed.netloc.lower()
        path = parsed.path

        # Convert editor URL → API endpoint
        if "app.roboflow.com" in netloc and "/workflows/" in path:
            # Expect: /<workspace>/workflows/edit/<workflow>
            parts = [p for p in path.split("/") if p]
            # parts: [workspace, 'workflows', 'edit', workflow]
            if len(parts) >= 4 and parts[1] == "workflows" and parts[2] == "edit":
                workspace = parts[0]
                workflow = parts[3]
                # Do not assume /workflows/<workspace>/<workflow> order; keep as editor but mark for parsing
                path = f"/workflows/{workspace}/{workflow}"
                netloc = "api.roboflow.com"

        # Rebuild query with api_key + confidence (+ format=json for detect/classify hosts)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        if api_key and "api_key" not in query:
            query["api_key"] = api_key
        if confidence is not None and "confidence" not in query:
            query["confidence"] = str(confidence)
        # Ensure JSON responses from detect/classify endpoints
        if any(h in netloc for h in ("detect.roboflow.com", "classify.roboflow.com", "segment.roboflow.com")) and "format" not in query:
            query["format"] = "json"

        new = parsed._replace(netloc=netloc, path=path, query=urlencode(query))
        return urlunparse(new)
    except Exception:
        # Simple fallback
        sep = "&" if "?" in url else "?"
        tail = f"api_key={api_key}" + (f"&confidence={confidence}" if confidence is not None else "")
        return f"{url}{sep}{tail}"

def _find_best_prediction(obj):
    """Heuristically find the best prediction in arbitrary Roboflow responses.

    Returns (label, confidence) where label may be None if not found.
    """
    best_label = None
    best_conf = -1.0

    def consider(p):
        nonlocal best_label, best_conf
        if not isinstance(p, dict):
            return
        label = p.get("class") or p.get("label") or p.get("name")
        conf = p.get("confidence") or p.get("score") or p.get("probability")
        try:
            conf = float(conf) if conf is not None else None
        except Exception:
            conf = None
        if label and conf is not None and conf > best_conf:
            best_label, best_conf = label, conf

    def walk(o):
        if isinstance(o, list):
            for item in o:
                walk(item)
        elif isinstance(o, dict):
            # Common containers
            if isinstance(o.get("predictions"), list):
                for p in o["predictions"]:
                    consider(p)
            if isinstance(o.get("results"), list):
                for p in o["results"]:
                    # results may be a list of dicts that include predictions
                    walk(p)
            # Also examine nested dicts
            for v in o.values():
                walk(v)

    walk(obj)
    return best_label, best_conf

def _label_to_category_id(label: str) -> int:
    """Map a free-form label to our category IDs (1: can, 2: bottle, 3: garbage)."""
    if not label:
        return 3
    norm = label.strip().lower()
    # Common heuristics
    if "can" in norm or "cans" in norm:
        return 1
    if "bottle" in norm or "bottles" in norm:
        return 2
    return 3

def recognizeImage(image):
    """Recognize image using Roboflow Workflows via inference_sdk HTTP client.

    Default API: serverless.roboflow.com. Workspace and workflow id are sourced from
    ROBOFLOW_WORKSPACE/ROBOFLOW_WORKFLOW_ID or parsed from ROBOFLOW_MODEL_URL.
    Falls back to direct HTTP if SDK is unavailable.
    """
    if not ROBOFLOW_API_KEY:
        raise EnvironmentError("ROBOFLOW_API_KEY must be set for Roboflow recognition.")

    image_bytes = _encode_jpeg(image)
    # Primary: Serverless Workflows via inference_sdk HTTP client
    try:
        from inference_sdk import InferenceHTTPClient  # type: ignore
        # serverless base unless overridden (also allow local inference override)
        api_url = (
            os.environ.get("ROBOFLOW_INFERENCE_API_URL")
            or os.environ.get("INFERENCE_API_URL")
            or os.environ.get("ROBOFLOW_SERVERLESS_API_URL")
            or "https://serverless.roboflow.com"
        )
        ws_env = os.environ.get("ROBOFLOW_WORKSPACE")
        wf_env = os.environ.get("ROBOFLOW_WORKFLOW_ID")
        ws, wf = _parse_workflow_from_url(ROBOFLOW_MODEL_URL)
        ws = ws_env or ws or ""
        wf = wf_env or wf or ""
        if not ws or not wf:
            raise ValueError(
                "Missing workflow identifiers; set ROBOFLOW_WORKSPACE and ROBOFLOW_WORKFLOW_ID or a parseable ROBOFLOW_MODEL_URL."
            )
        client = InferenceHTTPClient(api_url=api_url, api_key=ROBOFLOW_API_KEY)
        result = client.run_workflow(
            workspace_name=ws,
            workflow_id=wf,
            images={"image": image_bytes},
            use_cache=True,
        )
        label, conf = _find_best_prediction(result)
        if not label and isinstance(result, list) and result:
            label, conf = _find_best_prediction(result[0])
        if not label:
            print("[Roboflow] SDK: no predictions; defaulting to garbage (3)")
            return 3
        category_id = _label_to_category_id(label)
        print(f"[Roboflow] SDK top label '{label}' (conf={conf}) ⇒ category ID {category_id}")
        return category_id
    except Exception as exc:
        print(f"[Roboflow] SDK call failed, falling back to HTTP: {exc}")

    # Fallback: Serverless JSON request
    if _is_serverless_workflows_url(ROBOFLOW_MODEL_URL):
        try:
            import base64, json as _json
            b64 = base64.b64encode(image_bytes).decode("ascii")
            payload = {"api_key": ROBOFLOW_API_KEY, "inputs": {"image": {"type": "base64", "value": b64}}}
            headers = {"Content-Type": "application/json", "Accept": "application/json"}
            response = requests.post(ROBOFLOW_MODEL_URL, headers=headers, data=_json.dumps(payload), timeout=25)
            response.raise_for_status()
            result = response.json()
            label, conf = _find_best_prediction(result)
            if not label:
                print("[Roboflow] Serverless: no predictions found; defaulting to garbage (3)")
                return 3
            category_id = _label_to_category_id(label)
            print(f"[Roboflow] Serverless top label '{label}' (conf={conf}) ⇒ category ID {category_id}")
            return category_id
        except Exception as exc2:
            print(f"[Roboflow] Serverless HTTP failed: {exc2}")
            return 3

    # Last resort: detect/classify direct endpoints (legacy)
    url = _normalize_roboflow_url(ROBOFLOW_MODEL_URL, ROBOFLOW_API_KEY, ROBOFLOW_CONFIDENCE)
    print(f"[Roboflow] POST {url}")
    result = None
    try:
        files = {"file": ("frame.jpg", image_bytes, "image/jpeg")}
        headers = {"Accept": "application/json"}
        response = requests.post(url, files=files, headers=headers, timeout=20)
        response.raise_for_status()
        text = response.text.strip()
        try:
            result = response.json()
        except Exception:
            result = json.loads(text)
    except Exception as exc:
        print(f"[Roboflow] Multipart upload failed; defaulting to garbage: {exc}")
        return 3

    label, conf = _find_best_prediction(result)
    if not label:
        print("[Roboflow] No predictions found in response; defaulting to garbage (3)")
        return 3
    category_id = _label_to_category_id(label)
    print(f"[Roboflow] Top label '{label}' (conf={conf}) ⇒ category ID {category_id}")
    return category_id

def recognizeImage_gemini(image):
    """Recognize image and return category ID using Gemini."""

    print("[Gemini] Recognizing image...")
    if not GEMINI_API_KEY:
        raise EnvironmentError("GEMINI_API_KEY must be set for edge recognition.")

    client = genai.Client(api_key=GEMINI_API_KEY)
    model = "gemini-flash-latest"
    image_part = _image_to_part(image)
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text="Please identify the primary object in this image and classify it."),
                image_part,
            ],
        ),
    ]
    generate_content_config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            thinking_budget=0,
        ),
        response_mime_type="application/json",
        response_schema=genai.types.Schema(
            type=genai.types.Type.OBJECT,
            required=["recognized_category", "recognized_category_id"],
            properties={
                "recognized_category": genai.types.Schema(
                    type=genai.types.Type.STRING,
                ),
                "recognized_category_id": genai.types.Schema(
                    type=genai.types.Type.INTEGER,
                ),
            },
        ),
        system_instruction=[
            types.Part.from_text(text="""You are an image recognition software, designed to recognize the objects presented to be placed in the following categories. Of the below 3 category, return a category ID and category name of the recognized object.
Categories:
1. Cans
2. Bottles
3. Garbage
Only recognize and categorize the primary object presented. If the primary object is not cans or bottles, it is garbage."""),
        ],
    )
    result_chunks = []
    for chunk in client.models.generate_content_stream(
        model=model,
        contents=contents,
        config=generate_content_config,
    ):
        if chunk.text:
            print(chunk.text, end="")
            result_chunks.append(chunk.text)

    raw_result = "".join(result_chunks).strip()
    if not raw_result:
        raise ValueError("Gemini response was empty.")

    try:
        parsed = json.loads(raw_result)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to decode Gemini JSON response: {raw_result}") from exc

    category_id = int(parsed["recognized_category_id"])
    print(f"[Gemini] Recognized image as category ID: {category_id}")
    return category_id

def main():
    """
    Main control function. No return.
    """
    webcamFeed()

if __name__ == "__main__":
    print(f"[Status] Starting webcam feed...")
    main()
