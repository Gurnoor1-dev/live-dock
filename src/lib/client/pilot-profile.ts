"use client";

export type PilotProfile = {
  ifcUserId: string;
  username: string | null;
  role: number | null;
  onboardingRequired: boolean;
  discordUserId: string | null;
  discordUsername: string | null;
};

let cachedProfile: { value: PilotProfile; expiresAt: number } | null = null;
let profileRequest: Promise<PilotProfile> | null = null;
const PROFILE_CACHE_MS = 2 * 60_000;

export async function loadPilotProfile(force = false): Promise<PilotProfile> {
  if (!force && cachedProfile && cachedProfile.expiresAt > Date.now()) return cachedProfile.value;
  if (profileRequest) return profileRequest;

  profileRequest = (async () => {
    let lastError: Error = new Error("Could not load your pilot profile.");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch("/api/profile", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load your pilot profile.");
        const profile = data as PilotProfile;
        if (!profile.ifcUserId || typeof profile.onboardingRequired !== "boolean") {
          throw new Error("The pilot profile response was incomplete.");
        }
        cachedProfile = { value: profile, expiresAt: Date.now() + PROFILE_CACHE_MS };
        return profile;
      } catch (error) {
        lastError = error instanceof Error ? error : lastError;
        if (attempt === 0) await new Promise(resolve => window.setTimeout(resolve, 400));
      }
    }
    throw lastError;
  })();

  try {
    return await profileRequest;
  } finally {
    profileRequest = null;
  }
}

export function updateCachedPilotProfile(patch: Partial<PilotProfile>) {
  if (cachedProfile) cachedProfile = {
    value: { ...cachedProfile.value, ...patch },
    expiresAt: Date.now() + PROFILE_CACHE_MS
  };
}

export function clearPilotProfileCache() {
  cachedProfile = null;
  profileRequest = null;
}
