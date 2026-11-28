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

const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export async function POST(request: Request) {
  try {
    const { session } = await requireIFSession();
    await requireOrganizationAdmin(session);

    if (!process.env.GROQ_API_KEY) {
      return jsonError("Groq is not configured. Add GROQ_API_KEY to the server environment and redeploy.", 503);
    }

    const body = await request.json().catch(() => ({})) as { airline?: unknown };
    const airline = typeof body.airline === "string" ? body.airline.trim().slice(0, 48) : "";
    if (!/^[A-Za-z0-9 .&'-]{2,48}$/.test(airline)) {
      return jsonError("Enter a valid airline name.", 400);
    }

    // Infinite Flight is the authoritative allow-list. The model must select airport
    // identifiers from this directory; it is never allowed to invent or convert codes.
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
        airportMap.set(code, {
          ...airport,
          name: typeof airport.name === "string" ? airport.name : code,
          latitude,
          longitude
        });
      }
    }

    if (!airportMap.size) {
      return jsonError("Infinite Flight airport reference data is unavailable. Refresh the workspace and retry.", 503);
    }

    // Include every usable airport, not a hand-picked or truncated subset. This makes
    // the model's output constrained by the exact dataset used to build flight plans.
    const airportDirectory = [...airportMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, airport]) => code + " — " + String(airport.name || code).replace(/[\\r\\n,;]/g, " ").slice(0, 90))
      .join("\\n");

    const instructions = [
      "You are a commercial airline network researcher and route planner.",
      "Research current scheduled passenger routes operated by " + airline + " using browser search and reliable sources, prioritising the airline's official route map, timetable, or booking pages.",
      "Return exactly three distinct routes that the airline currently operates. Do not use historical, announced-only, unverified seasonal, charter-only, or fictional services.",
      "Find a published flight number for each route where possible. The callsign field is the airline flight number, not a radio callsign. For JetBlue, use the B6 IATA designator followed by the published digits.",
      "CRITICAL AIRPORT RULE: originIcao and destinationIcao MUST each be copied exactly from the Infinite Flight airport directory below. Do not infer, convert, repair, or invent ICAO codes. Do not output an airport that is not in this directory. If a real-world airport cannot be matched to a listed airport, choose another real route whose two airports are both listed.",
      "flightType must always be the number 1.",
      "Return ONLY a JSON object with this schema: {\\"suggestions\\":[{\\"callsign\\":\\"B6421\\",\\"flightType\\":1,\\"originIcao\\":\\"KJFK\\",\\"destinationIcao\\":\\"KLAX\\"},{\\"callsign\\":\\"B6123\\",\\"flightType\\":1,\\"originIcao\\":\\"KBOS\\",\\"destinationIcao\\":\\"KFLL\\"},{\\"callsign\\":\\"B6456\\",\\"flightType\\":1,\\"originIcao\\":\\"KJFK\\",\\"destinationIcao\\":\\"TJSJ\\"}]}. The airport codes in this illustrative schema are examples only; the directory is the sole authority.",
      "INFINITE FLIGHT AIRPORT DIRECTORY (ICAO — airport name):",
      airportDirectory
    ].join("\\n\\n");

    const response = await fetch("https://api.groq.com/openai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.GROQ_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        instructions,
        input: "Research current " + airline + " scheduled passenger services. Return exactly three distinct routes, using only airport identifiers copied from the supplied Infinite Flight airport directory.",
        tools: [{ type: "browser_search" }],
        tool_choice: "required",
        max_output_tokens: 2200
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45000)
    });

    const result = await response.json().catch(() => ({})) as {
      output_text?: string;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
      error?: { message?: string };
      incomplete_details?: { reason?: string };
      status?: string;
    };

    if (!response.ok) {
      return jsonError(result.error?.message || "Groq returned HTTP " + response.status + ".", response.status === 429 ? 429 : 502);
    }

    const responseText = result.output_text || result.output
      ?.filter(item => item.type === "message")
      .flatMap(item => item.content || [])
      .find(item => item.type === "output_text")?.text;

    if (!responseText) {
      const reason = result.incomplete_details?.reason;
      return jsonError(
        reason
          ? "Groq could not complete route research (" + reason + "). Please try again."
          : "Groq returned an empty response. Please try again."
      );
    }

    const modelSuggestions = parseSuggestions(responseText);
    if (!modelSuggestions || modelSuggestions.length !== 3) {
      return jsonError("Groq did not return exactly three valid route suggestions. Please regenerate.");
    }

    const seenCallsigns = new Set<string>();
    const seenRoutes = new Set<string>();
    const suggestions = modelSuggestions.map(item => {
      const callsign = typeof item.callsign === "string"
        ? item.callsign.trim().toUpperCase().replace(/\\s+/g, "")
        : "";
      const origin = typeof item.originIcao === "string" ? item.originIcao.trim().toUpperCase() : "";
      const destination = typeof item.destinationIcao === "string" ? item.destinationIcao.trim().toUpperCase() : "";

      if (!/^[A-Z0-9]{2,10}$/.test(callsign) || seenCallsigns.has(callsign)) {
        throw Object.assign(new Error("Groq returned a missing or duplicate flight number. Please regenerate."), { status: 502 });
      }
      if (airline.toLowerCase() === "jetblue" && !/^B6\\d{1,4}$/.test(callsign)) {
        throw Object.assign(new Error("JetBlue flight numbers must use the B6 airline designator followed by digits. Please regenerate."), { status: 502 });
      }
      if (!/^[A-Z]{4}$/.test(origin) || !/^[A-Z]{4}$/.test(destination) || origin === destination) {
        throw Object.assign(new Error("Groq returned an invalid airport pair. Please regenerate."), { status: 502 });
      }

      const route = origin + "-" + destination;
      if (seenRoutes.has(route)) {
        throw Object.assign(new Error("Groq returned a duplicate route. Please regenerate."), { status: 502 });
      }

      const from = airportMap.get(origin);
      const to = airportMap.get(destination);
      if (!from || !to) {
        const invalid = [!from ? origin : "", !to ? destination : ""].filter(Boolean).join(", ");
        throw Object.assign(
          new Error("The AI selected airport code(s) not supported by Infinite Flight: " + invalid + ". Please regenerate; only airports in the supplied Infinite Flight directory can be used."),
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
