import json
import os
import time
import uuid
import re

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

# Optional Roboflow backend configuration (from local 'image detect.py')
ROBOFLOW_API_KEY = os.environ.get("ROBOFLOW_API_KEY") or ""
ROBOFLOW_MODEL_URL = (
    os.environ.get("ROBOFLOW_MODEL_URL")
    or "https://app.roboflow.com/ftc16031/workflows/edit/detect-and-classify"
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
# Allow override via common env names when using Arduino/USB-serial devices
ESP32_COM_PORT_OVERRIDE = (
    os.environ.get("SERIAL_PORT")
    or os.environ.get("ARDUINO_PORT")
    or os.environ.get("ESP32_COM_PORT")
    or os.environ.get("ESP32_COM_PORT_OVERRIDE")
    or None
)


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

    def __init__(self, *, com_override=None, baudrate=ESP32_BAUDRATE, timeout=2.0):
        self._com_override = (com_override or "").strip() or None
        self._baudrate = baudrate
        self._timeout = timeout
        self._serial = None
        self._last_port = None

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
        except serial.SerialException as exc:
            raise RuntimeError(f"Failed to open serial port '{port}': {exc}") from exc

        return self._serial

    def send_command(self, command_value):
        connection = self._ensure_connection()
        payload = f"{command_value}\n".encode("utf-8")
        try:
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
    """Read and parse device state as (isMoving, isTriggered) booleans.

    Expected formats: "0,1", "(0,1)", or with whitespace. Returns (False, True) for "0,1".
    Unparseable or empty lines return (False, False) by default.
    """
    try:
        line = get_serial_client().read_line()
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[ESP32] Read error: {exc}")
        return False, False

    if not line:
        return False, False

    m = _STATE_RE.search(line)
    if not m:
        # Fallback: try to split on comma and coerce
        parts = [p.strip() for p in line.strip("() ").split(",")]
        if len(parts) >= 2 and all(p in ("0", "1") for p in parts[:2]):
            a, b = parts[0], parts[1]
            return (a == "1"), (b == "1")
        print(f"[ESP32] Unrecognized state '{line}', defaulting to (0,0)")
        return False, False

    a, b = m.group(1), m.group(2)
    return (a == "1"), (b == "1")
    

def webcamFeed(*, max_frames=None, delay_seconds=0, show_window=False):
    """Continuously read frames from webcam, classify, and command ESP32."""

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Unable to open webcam (device index 0).")

    if show_window:
        cv2.namedWindow("Recycle Sorter", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("Recycle Sorter", 960, 540)

    processed = 0
    consecutive_failures = 0
    reopen_attempts = 0
    max_consecutive_failures = 5
    max_reopen_attempts = 3
    frame_retry_sleep = 0.5

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                consecutive_failures += 1
                print(f"[Webcam] Failed to read frame (attempt {consecutive_failures}). Retrying.")
                if consecutive_failures < max_consecutive_failures:
                    time.sleep(frame_retry_sleep)
                    continue

                reopen_attempts += 1
                print(
                    f"[Webcam] Reinitializing camera (attempt {reopen_attempts}/{max_reopen_attempts})."
                )
                cap.release()
                time.sleep(max(frame_retry_sleep, 1.0))
                cap = cv2.VideoCapture(0)
                if not cap.isOpened():
                    cap.release()
                    if reopen_attempts >= max_reopen_attempts:
                        raise RuntimeError(
                            "Unable to recover webcam stream after multiple attempts."
                        )
                    print("[Webcam] Reopen attempt failed; will retry.")
                    time.sleep(1.0)
                    continue

                consecutive_failures = 0
                time.sleep(frame_retry_sleep)
                continue

            consecutive_failures = 0
            reopen_attempts = 0

            if show_window:
                cv2.imshow("Recycle Sorter", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    print("[Webcam] Quit signal received.")
                    break

            # Wait for ultrasonic trigger from serial: (isMoving, isTriggered)
            isMoving, isTriggered = currentState()
            while not isTriggered:
                # Keep UI responsive and avoid busy-wait
                if show_window:
                    ok2, frame2 = cap.read()
                    if ok2:
                        cv2.imshow("Recycle Sorter", frame2)
                        if cv2.waitKey(1) & 0xFF == ord("q"):
                            print("[Webcam] Quit signal received.")
                            raise KeyboardInterrupt
                time.sleep(0.05)
                isMoving, isTriggered = currentState()

            print("[Webcam] Trigger received.")
            # Capture a fresh frame at trigger time
            ok3, frame3 = cap.read()
            if ok3:
                frame_to_use = frame3
            else:
                frame_to_use = frame

            category_id = recognizeImage(frame_to_use)
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
                time.sleep(0.05)
                isMoving, isTriggered = currentState()
            print("[ESP32] Movement completed.")
            processed += 1

            if max_frames is not None and processed >= max_frames:
                break

            if delay_seconds:
                time.sleep(delay_seconds)
    finally:
        cap.release()
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
    """Recognize the image via Roboflow workflow and return category ID."""
    if not ROBOFLOW_API_KEY:
        raise EnvironmentError("ROBOFLOW_API_KEY must be set for Roboflow recognition.")

    image_bytes = _encode_jpeg(image)
    url = f"{ROBOFLOW_MODEL_URL}?api_key={ROBOFLOW_API_KEY}&confidence={ROBOFLOW_CONFIDENCE}"
    print(f"[Roboflow] Sending image for detection (confidence>={ROBOFLOW_CONFIDENCE})")
    try:
        files = {"file": ("frame.jpg", image_bytes, "image/jpeg")}
        response = requests.post(url, files=files, timeout=20)
        response.raise_for_status()
        result = response.json()
    except Exception as exc:
        print(f"[Roboflow] Request failed: {exc}")
        return 3

    predictions = result.get("predictions") or result.get("results") or []
    if not isinstance(predictions, list):
        predictions = predictions.get("predictions", []) if isinstance(predictions, dict) else []

    if not predictions:
        print("[Roboflow] No predictions; defaulting to garbage (3)")
        return 3

    best = max(predictions, key=lambda p: p.get("confidence", 0))
    label = best.get("class") or best.get("label") or ""
    category_id = _label_to_category_id(label)
    print(f"[Roboflow] Top label '{label}' ⇒ category ID {category_id}")
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
