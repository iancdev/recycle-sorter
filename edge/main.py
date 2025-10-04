import json
import os
import time

import cv2
import requests

# Gemini requirements
from google import genai
from google.genai import types

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or "AIzaSyDU_Xgbf2GK7WG3FnmkG_faW_gWTdX0asU"


class ArduinoCloudClient:
    """Thin wrapper around Arduino Cloud REST API for ESP32 control."""

    TOKEN_URL = "https://api2.arduino.cc/iot/v1/clients/token"
    PROPERTY_URL_TEMPLATE = (
        "https://api2.arduino.cc/iot/v2/things/{thing_id}/properties/{property_id}/publish"
    )

    def __init__(self, client_id, client_secret, thing_id, property_id, *, timeout=10):
        missing = [
            name
            for name, value in (
                ("ARDUINO_CLIENT_ID", client_id),
                ("ARDUINO_CLIENT_SECRET", client_secret),
                ("ARDUINO_THING_ID", thing_id),
                ("ARDUINO_PROPERTY_ID", property_id),
            )
            if not value
        ]
        if missing:
            raise EnvironmentError(
                "Missing Arduino Cloud configuration: " + ", ".join(missing)
            )

        self._client_id = client_id
        self._client_secret = client_secret
        self._thing_id = thing_id
        self._property_id = property_id
        self._timeout = timeout

        self._token = None
        self._token_expiry = 0.0

    @classmethod
    def from_env(cls):
        return cls(
            client_id=os.environ.get("ARDUINO_CLIENT_ID"),
            client_secret=os.environ.get("ARDUINO_CLIENT_SECRET"),
            thing_id=os.environ.get("ARDUINO_THING_ID"),
            property_id=os.environ.get("ARDUINO_PROPERTY_ID"),
        )

    def _obtain_token(self):
        response = requests.post(
            self.TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "audience": "https://api2.arduino.cc/iot"
            },
            timeout=self._timeout,
        )
        response.raise_for_status()
        payload = response.json()
        self._token = payload["access_token"]
        expires_in = payload.get("expires_in", 0)
        self._token_expiry = time.time() + max(int(expires_in) - 30, 0)

    def _ensure_token(self):
        if not self._token or time.time() >= self._token_expiry:
            self._obtain_token()

    def send_command(self, command_value):
        self._ensure_token()

        url = self.PROPERTY_URL_TEMPLATE.format(
            thing_id=self._thing_id,
            property_id=self._property_id,
        )
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }
        response = requests.put(
            url,
            headers=headers,
            json={"value": command_value},
            timeout=self._timeout,
        )
        response.raise_for_status()
        return True


_arduino_client = None


def get_arduino_client():
    global _arduino_client
    if _arduino_client is None:
        _arduino_client = ArduinoCloudClient.from_env()
    return _arduino_client

def esp32Command(command):
    """Send a command value to ESP32 via Arduino Cloud property."""

    print(f"[ESP32] Sending command to ESP32: {command}")
    try:
        client = get_arduino_client()
        client.send_command(command)
        return 1
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[ESP32] Failed to send command: {exc}")
        return 0

def webcamFeed(*, max_frames=None, delay_seconds=0, show_window=False):
    """Continuously read frames from webcam, classify, and command ESP32."""

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Unable to open webcam (device index 0).")

    if show_window:
        cv2.namedWindow("Recycle Sorter", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("Recycle Sorter", 960, 540)

    processed = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("Failed to read frame from webcam.")

            if show_window:
                cv2.imshow("Recycle Sorter", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    print("[Webcam] Quit signal received.")
                    break

            category_id = recognizeImage(frame)
            esp32Command(category_id)
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

def recognizeImage(image):
    """
    Recognize image provided, and returns category ID.
    """ 
    print(f"[Gemini] Recognizing image...")
    if not GEMINI_API_KEY:
        raise EnvironmentError("GEMINI_API_KEY is not set in the environment.")

    client = genai.Client(
       api_key=GEMINI_API_KEY,
    )
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
        thinking_config = types.ThinkingConfig(
            thinking_budget=0,
        ),
        response_mime_type="application/json",
        response_schema=genai.types.Schema(
            type = genai.types.Type.OBJECT,
            required = ["recognized_category", "recognized_category_id"],
            properties = {
                "recognized_category": genai.types.Schema(
                    type = genai.types.Type.STRING,
                ),
                "recognized_category_id": genai.types.Schema(
                    type = genai.types.Type.INTEGER,
                ),
            },
        ),
        system_instruction=[
            types.Part.from_text(text="""You are an image recognition software, designed to recognize the objects presented to be placed in the following categories. Of the below 3 category, return a category ID and category name of the recognized object.
Categories:
- Cans
- Bottles
- Garbage
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

    category_id = parsed["recognized_category_id"]
    print(f"[Gemini] Recognized image as category ID: {category_id}")
    return int(category_id)

def main():
    """
    Main control function. No return.
    """
    webcamFeed()

if __name__ == "__main__":
    print(f"[Status] Starting webcam feed...")
    main()