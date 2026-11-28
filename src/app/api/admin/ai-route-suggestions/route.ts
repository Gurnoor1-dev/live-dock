import { NextResponse } from "next/server";
import { ifFetch, requireIFSession, requireOrganizationAdmin } from "@/lib/infinite-flight/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Airport = {
  icao?: string;
  icaoCode?: string;
  code?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  location?: { latitude?: number; longitude?: number };
};
type ModelSuggestion = {
  callsign?: unknown;
  flightType?: unknown;
  originIcao?: unknown;
  destinationIcao?: unknown;
};
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string; code?: number };
};

function airportsFrom(value: unknown): Airport[] {
  if (Array.isArray(value)) return value as Airport[];
  if (value && typeof value === "object") {
    const result = value as { items?: unknown[]; airports?: unknown[] };
    if (Array.isArray(result.items)) return result.items as Airport[];
    if (Array.isArray(result.airports)) return result.airports as Airport[];
  }
  return [];
}

function jsonError(message: string, status = 502) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function parseSuggestions(raw: string): ModelSuggestion[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { suggestions?: ModelSuggestion[] };
    return Array.isArray(parsed.suggestions) ? parsed.suggestions : null;
  } catch {
    return null;
  }
}

// Flash-Lite is sufficient for compact route selection and supports Google Search
// grounding on the free tier. Override only when a different Gemini model is enabled
// for the project's API tier.
const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

export async function POST(request: Request) {
  try {
    const { session } = await requireIFSession();
    await requireOrganizationAdmin(session);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonError("Gemini is not configured. Add GEMINI_API_KEY to the server environment and redeploy.", 503);
    }

    const body = await request.json().catch(() => ({})) as { airline?: unknown };
    const airline = typeof body.airline === "string" ? body.airline.trim().slice(0, 48) : "";
    if (!/^[A-Za-z0-9 .&'-]{2,48}$/.test(airline)) {
      return jsonError("Enter a valid airline name.", 400);
    }

    // Infinite Flight remains the authoritative airport allow-list and source of
    // coordinates. The compact ICAO-only list keeps each model request inexpensive.
    const rawAirports = airportsFrom(await ifFetch<unknown>("/airports", session));
    const airportMap = new Map<string, Airport>();
    for (const airport of rawAirports) {
      const code = String(airport.icao || airport.icaoCode || airport.code || "").trim().toUpperCase();
      const latitude = Number(airport.latitude ?? airport.location?.latitude);
      const longitude = Number(airport.longitude ?? airport.location?.longitude);
      if (
        /^[A-Z]{4}$/.test(code) &&
        Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
        Number.isFinite(longitude) && Math.abs(longitude) <= 180
      ) {
        airportMap.set(code, { ...airport, latitude, longitude });
      }
    }

    if (!airportMap.size) {
      return jsonError("Infinite Flight airport reference data is unavailable. Refresh the workspace and retry.", 503);
    }

    const airportDirectory = [...airportMap.keys()].sort().join(",");
    const prompt = [
      "Find 3 distinct CURRENT scheduled passenger routes operated by " + airline + ".",
      "Use Google Search grounding to verify current operation; prefer the airline's official route map, timetable, or booking pages. Exclude announced-only, historical, charter, and unverified seasonal routes.",
      "Return a published flight number for each route where possible. callsign is the airline flight number. For JetBlue use B6 followed by the published digits.",
      "Every originIcao and destinationIcao MUST be copied exactly from this allowed Infinite Flight ICAO list. Never invent or convert codes. If a real route cannot be represented by two listed airports, choose a different route.",
      "flightType must be 1. Return exactly 3 unique routes and compact JSON matching this schema: { \"suggestions\": [{ \"callsign\": \"B6421\", \"flightType\": 1, \"originIcao\": \"XXXX\", \"destinationIcao\": \"YYYY\" }] }.",
      "Allowed ICAO codes: " + airportDirectory
    ].join("\n");

    // One grounded Gemini request per generation. Keep output short and structured;
    // no second model call is needed for parsing or validation.
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 500,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                suggestions: {
                  type: "ARRAY",
                  minItems: 3,
                  maxItems: 3,
                  items: {
                    type: "OBJECT",
                    properties: {
                      callsign: { type: "STRING" },
                      flightType: { type: "INTEGER" },
                      originIcao: { type: "STRING" },
                      destinationIcao: { type: "STRING" }
                    },
                    required: ["callsign", "flightType", "originIcao", "destinationIcao"],
                    propertyOrdering: ["callsign", "flightType", "originIcao", "destinationIcao"]
                  }
                }
              },
              required: ["suggestions"],
              propertyOrdering: ["suggestions"]
            }
          }
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(45000)
      }
    );

    const result = await response.json().catch(() => ({})) as GeminiResponse;
    if (!response.ok) {
      const message = result.error?.message || "Gemini returned HTTP " + response.status + ".";
      if (response.status === 429) {
        return jsonError(
          "Gemini's rate or daily quota has been reached. The generator uses one compact Gemini request per generation; check the Gemini API quota for " + model + ". " + message,
          429
        );
      }
      if (response.status === 401 || response.status === 403) {
        return jsonError("Gemini rejected the API key or the key does not have access to this model. Check GEMINI_API_KEY and the Gemini API project. " + message, 503);
      }
      return jsonError(message, 502);
    }

    const candidate = result.candidates?.[0];
    const responseText = candidate?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!responseText) {
      const reason = candidate?.finishReason || result.promptFeedback?.blockReason;
      return jsonError(
        reason
          ? "Gemini could not complete route research (" + reason + "). Please try again."
          : "Gemini returned an empty response. Please try again."
      );
    }

    const modelSuggestions = parseSuggestions(responseText);
    if (!modelSuggestions || modelSuggestions.length !== 3) {
      return jsonError("Gemini did not return exactly three valid route suggestions. Please regenerate.");
    }

    const seenCallsigns = new Set<string>();
    const seenRoutes = new Set<string>();
    const suggestions = modelSuggestions.map(item => {
      const callsign = typeof item.callsign === "string"
        ? item.callsign.trim().toUpperCase().replace(/\s+/g, "")
        : "";
      const origin = typeof item.originIcao === "string" ? item.originIcao.trim().toUpperCase() : "";
      const destination = typeof item.destinationIcao === "string" ? item.destinationIcao.trim().toUpperCase() : "";

      if (!/^[A-Z0-9]{2,10}$/.test(callsign) || seenCallsigns.has(callsign)) {
        throw Object.assign(new Error("Gemini returned a missing or duplicate flight number. Please regenerate."), { status: 502 });
      }
      if (airline.toLowerCase() === "jetblue" && !/^B6\d{1,4}$/.test(callsign)) {
        throw Object.assign(new Error("JetBlue flight numbers must use the B6 airline designator followed by digits. Please regenerate."), { status: 502 });
      }
      if (!/^[A-Z]{4}$/.test(origin) || !/^[A-Z]{4}$/.test(destination) || origin === destination) {
        throw Object.assign(new Error("Gemini returned an invalid airport pair. Please regenerate."), { status: 502 });
      }

      const route = origin + "-" + destination;
      if (seenRoutes.has(route)) {
        throw Object.assign(new Error("Gemini returned a duplicate route. Please regenerate."), { status: 502 });
      }

      const from = airportMap.get(origin);
      const to = airportMap.get(destination);
      if (!from || !to) {
        const invalid = [!from ? origin : "", !to ? destination : ""].filter(Boolean).join(", ");
        throw Object.assign(
          new Error("Gemini selected airport code(s) not supported by Infinite Flight: " + invalid + ". Please regenerate; only airports in the supplied Infinite Flight directory can be used."),
          { status: 502 }
        );
      }

      seenCallsigns.add(callsign);
      seenRoutes.add(route);
      const point = (code: string, airport: Airport) => ({
        name: code,
        identifier: code,
        location: {
          latitude: Number(airport.latitude),
          longitude: Number(airport.longitude)
        }
      });

      return {
        callsign,
        flightType: 1,
        originIcao: origin,
        destinationIcao: destination,
        flightPlan: { flightPlanItems: [point(origin, from), point(destination, to)] }
      };
    });

    return NextResponse.json({ suggestions }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to generate AI route suggestions."
    }, {
      status,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
