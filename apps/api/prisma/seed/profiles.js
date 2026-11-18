export const seedProfiles = ["production", "staging"];
export const defaultSeedProfile = "production";

export function resolveSeedProfile(value) {
  if (value === undefined || value === "") {
    return defaultSeedProfile;
  }
  if (!seedProfiles.includes(value)) {
    throw new Error(`SEED_PROFILE must be one of ${seedProfiles.join(", ")}, got "${value}"`);
  }
  return value;
}

export function isStagingProfile(profile) {
  return profile === "staging";
}
