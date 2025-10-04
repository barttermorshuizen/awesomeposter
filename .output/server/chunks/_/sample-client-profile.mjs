function generateMinimalClientProfile(language = "US English") {
  return {
    primaryCommunicationLanguage: language,
    objectivesJson: {
      primary: "Increase brand awareness",
      secondary: "Drive engagement"
    },
    audiencesJson: {
      target: "Target audience not specified",
      demographics: "Demographics not specified",
      interests: [],
      painPoints: []
    },
    toneJson: {
      preset: "Professional & Formal"
    },
    specialInstructionsJson: {
      instructions: "No special instructions provided"
    },
    guardrailsJson: {
      banned: [],
      sensitive: [],
      required: []
    },
    platformPrefsJson: {
      primary: "LinkedIn",
      secondary: "X (Twitter)",
      focus: "General social media presence"
    }
  };
}
function validateClientProfileStructure(profile) {
  const requiredFields = [
    "primaryCommunicationLanguage",
    "objectivesJson",
    "audiencesJson",
    "toneJson",
    "specialInstructionsJson",
    "guardrailsJson",
    "platformPrefsJson"
  ];
  const missingFields = [];
  for (const field of requiredFields) {
    if (!profile[field]) {
      missingFields.push(field);
    }
  }
  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}

export { generateMinimalClientProfile as g, validateClientProfileStructure as v };
//# sourceMappingURL=sample-client-profile.mjs.map
