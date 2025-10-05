import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "";

interface AnnouncementRequestBody {
  categoryName: string;
  amountCents: number;
  confidence?: number | null;
}

interface AnnouncementResponse {
  text: string;
  audio?: {
    type: "base64" | "url";
    value: string;
  } | null;
  provider: {
    text: "gemini" | "fallback";
    audio: "elevenlabs" | "fallback";
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as AnnouncementRequestBody;
  const text = await generateNarration(body);
  const audio = await synthesizeAudio(text);

  const response: AnnouncementResponse = {
    text,
    audio,
    provider: {
      text: GEMINI_API_KEY ? "gemini" : "fallback",
      audio: ELEVENLABS_API_KEY ? "elevenlabs" : "fallback",
    },
  };

  return NextResponse.json(response, { status: 200 });
}

async function generateNarration({
  categoryName,
  amountCents,
  confidence,
}: AnnouncementRequestBody): Promise<string> {
  const fallback = buildFallbackNarration({ categoryName, amountCents, confidence });

  if (!GEMINI_API_KEY) {
    return fallback;
  }

  try {
    const prompt = buildPrompt({ categoryName, amountCents, confidence });
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent" +
        `?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      console.warn("Gemini request failed", await response.text());
      return fallback;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const generated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return generated?.length ? generated : fallback;
  } catch (error) {
    console.error("Gemini request error", error);
    return fallback;
  }
}

async function synthesizeAudio(text: string) {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.7,
          },
        }),
      },
    );

    if (!response.ok) {
      console.warn("ElevenLabs request failed", await response.text());
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      type: "base64" as const,
      value: `data:audio/mpeg;base64,${base64}`,
    };
  } catch (error) {
    console.error("ElevenLabs request error", error);
    return null;
  }
}

function buildFallbackNarration({
  categoryName,
  amountCents,
  confidence,
}: AnnouncementRequestBody) {
  const amount = (amountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const confidenceText =
    typeof confidence === "number"
      ? ` Confidence ${Math.round(confidence * 100)} percent.`
      : "";

  return `${categoryName} detected. Credit ${amount}.${confidenceText}`.trim();
}

function buildPrompt({
  categoryName,
  amountCents,
  confidence,
}: AnnouncementRequestBody) {
  const amount = (amountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  let prompt = `You are the enthusiastic voice of a recycling kiosk. `;
  prompt += `Announce that a ${categoryName.toLowerCase()} was accepted and the user earned ${amount}.`;
  if (typeof confidence === "number") {
    prompt += ` Confidence of the classification: ${Math.round(confidence * 100)} percent.`;
  }
  prompt +=
    " Keep it cheerful, under 18 words, and avoid words like 'confidence' or 'percent' unless instructed.";

  return prompt;
}
