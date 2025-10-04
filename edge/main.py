import requests

# Gemini requirements
import base64
import os
from google import genai
from google.genai import types

GEMINI_API_KEY = 'AIzaSyDU_Xgbf2GK7WG3FnmkG_faW_gWTdX0asU'

def recognizeImage(image):
    """
    Recognize image provided, and returns category ID.
    """ 
    client = genai.Client(
        api_key=os.environ.get("GEMINI_API_KEY"),
    )
    model = "gemini-flash-latest"
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text="""INSERT_INPUT_HERE"""),
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

    for chunk in client.models.generate_content_stream(
        model=model,
        contents=contents,
        config=generate_content_config,
    ):
        print(chunk.text, end="")

