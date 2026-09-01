// Grounding techniques, and how an unknown intervention is handled.
export const GROUNDING_TECHNIQUES = [
  {
    id: "sensory_54321",
    name: "5-4-3-2-1 senses",
    icon: "eye",
    duration: "2 min",
    category: "Sensory",
    blurb: "Name what is around you, one sense at a time.",
    caution: null,
    steps: [
      { title: "5 things you can see", sub: "Look around and name five things out loud or in your head." },
      { title: "4 things you can hear", sub: "Listen and name four separate sounds." },
      { title: "3 things you can feel", sub: "Notice three physical sensations — your feet, a fabric, the air." },
      { title: "2 things you can smell", sub: "Take a breath in and notice two smells." },
      { title: "1 thing you can taste", sub: "Notice one taste in your mouth." },
    ],
  },
  {
    id: "temperature",
    name: "Cold water or ice",
    icon: "snow",
    duration: "1 min",
    category: "Physical",
    blurb: "A strong, safe physical signal that interrupts a spiral fast.",
    caution: null,
    steps: [
      { title: "Find something cold", sub: "Cold water on your hands or wrists, or an ice cube." },
      { title: "Hold it and breathe", sub: "Let your attention go to the cold instead of the thought." },
      { title: "Notice the change", sub: "Cold gives the body something immediate and real to respond to." },
    ],
  },
  {
    id: "orient_room",
    name: "Orient to the room",
    icon: "compass",
    duration: "1 min",
    category: "Orientation",
    blurb: "Re-establish where and when you actually are.",
    caution: null,
    steps: [
      { title: "Say where you are", sub: "Out loud if you can: the room, the street, the city." },
      { title: "Say today's date", sub: "The year matters most — it separates now from then." },
      { title: "Name three things that only exist now", sub: "Your phone, a car, something that was not there before." },
    ],
  },
  {
    id: "feet_floor",
    name: "Feet on the floor",
    icon: "footsteps",
    duration: "1 min",
    category: "Physical",
    blurb: "Put your attention in your feet, the furthest point from your head.",
    caution: null,
    steps: [
      { title: "Press both feet down", sub: "Feel the floor pushing back." },
      { title: "Notice the contact", sub: "Where exactly do your shoes or the ground touch you?" },
      { title: "Shift your weight slowly", sub: "Side to side, and notice it change." },
    ],
  },
  {
    id: "five_things_colour",
    name: "Find one colour",
    icon: "color-palette",
    duration: "1 min",
    category: "Sensory",
    blurb: "Pick a colour and hunt for it. Simple enough to do at any level of distress.",
    caution: null,
    steps: [
      { title: "Choose a colour", sub: "Whatever you see first." },
      { title: "Find five of it", sub: "Look slowly around and count them." },
      { title: "Find five more", sub: "Keep going until the search itself is what you're doing." },
    ],
  },
  {
    id: "categories",
    name: "Name a category",
    icon: "list",
    duration: "2 min",
    category: "Mental",
    blurb: "Occupies the thinking part of the mind without demanding much of it.",
    caution: null,
    steps: [
      { title: "Pick a category", sub: "Football teams, cities, songs, types of tree." },
      { title: "Name them one by one", sub: "Slowly. There is no target number." },
      { title: "Switch if it gets easy", sub: "Pick a harder category and keep going." },
    ],
  },
  {
    id: "counting_backwards",
    name: "Count backwards by 7",
    icon: "calculator",
    duration: "2 min",
    category: "Mental",
    blurb: "Hard enough to need attention, not hard enough to frustrate.",
    caution: null,
    steps: [
      { title: "Start at 100", sub: "93, 86, 79…" },
      { title: "Go slowly", sub: "Getting it wrong does not matter at all." },
      { title: "Start again if you lose it", sub: "The counting is the point, not the answer." },
    ],
  },
  {
    id: "hold_object",
    name: "Hold something",
    icon: "cube",
    duration: "1 min",
    category: "Physical",
    blurb: "One object, examined closely.",
    caution: null,
    steps: [
      { title: "Pick up anything nearby", sub: "Keys, a cup, a stone." },
      { title: "Describe it in detail", sub: "Weight, temperature, texture, edges, colour." },
      { title: "Keep describing", sub: "Find something about it you had not noticed." },
    ],
  },
  {
    id: "slow_exhale",
    name: "Longer out-breath",
    icon: "leaf",
    duration: "2 min",
    category: "Breathing",
    caution: "Breath-focused exercises unsettle some people. Stop if it makes things worse — that is useful information for your therapist, not a failure.",
    steps: [
      { title: "Breathe in for 4", sub: "Through your nose, without forcing it." },
      { title: "Breathe out for 6", sub: "Longer out than in is the whole technique." },
      { title: "Repeat a few times", sub: "Stop whenever you want to." },
    ],
  },
  {
    id: "safe_place",
    name: "Somewhere safe",
    icon: "home",
    duration: "3 min",
    category: "Imagery",
    caution: "If picturing a place brings up something difficult, stop and try a sensory technique instead.",
    blurb: "Build a detailed picture of a place where you felt settled.",
    steps: [
      { title: "Pick a place", sub: "Real or imagined. Somewhere nothing bad happened." },
      { title: "Add detail", sub: "What can you see there? What is the light like?" },
      { title: "Add sound and texture", sub: "The more specific it gets, the more it holds." },
    ],
  },
];

export const GROUNDING_CATEGORIES = [
  ...new Set(GROUNDING_TECHNIQUES.map((t) => t.category)),
];

export function techniqueById(id) {
  return GROUNDING_TECHNIQUES.find((t) => t.id === id) || null;
}

export function matchTechnique(action) {
  if (!action) return null;
  const a = String(action).toLowerCase();
  const direct = GROUNDING_TECHNIQUES.find((t) => a.includes(t.id));
  if (direct) return direct;
  if (a.includes("5-4-3-2-1") || a.includes("54321") || a.includes("senses")) return techniqueById("sensory_54321");
  if (a.includes("cold") || a.includes("ice")) return techniqueById("temperature");
  if (a.includes("orient") || a.includes("present")) return techniqueById("orient_room");
  if (a.includes("feet") || a.includes("floor")) return techniqueById("feet_floor");
  if (a.includes("breath") || a.includes("exhale") || a.includes("breathing")) return techniqueById("slow_exhale");
  if (a.includes("count")) return techniqueById("counting_backwards");
  if (a.includes("safe place") || a.includes("imagery")) return techniqueById("safe_place");
  if (a.includes("categor")) return techniqueById("categories");
  if (a.includes("colour") || a.includes("color")) return techniqueById("five_things_colour");
  if (a.includes("hold") || a.includes("object")) return techniqueById("hold_object");
  return null;
}

export const ACTION_KIND = {
  GUIDED: "guided",
  ACTIONABLE: "actionable",
  INSTRUCTION: "instruction",
};

const ACTIONABLE = [
  {
    match: ["music", "playlist", "song", "spotify", "listen to"],
    id: "open_music",
    label: "Open Music",
    icon: "musical-notes",
    hint: "Companio can open your music app — choose what you want to hear.",
  },
  {
    match: ["call your therapist", "call therapist", "contact your therapist",
            "contact therapist", "message your therapist", "reach your therapist"],
    id: "call_therapist",
    label: "Contact your therapist",
    icon: "medkit",
    hint: "Companio will let your therapist know you need them.",
  },
  {
    match: ["caregiver", "carer", "support person", "emergency contact",
            "call your sister", "call your brother", "call your mum", "call your mom",
            "call your partner", "call a friend", "call someone"],
    id: "call_caregiver",
    label: "Call your support person",
    icon: "people",
    hint: "Companio can start the call to the person on your care plan.",
  },
  {
    match: ["call", "phone", "ring"],
    id: "make_call",
    label: "Make the call",
    icon: "call",
    hint: "Companio can start the call for you.",
  },
  {
    match: ["walk", "step outside", "go outside", "fresh air"],
    id: "timer",
    label: "Start a 5-minute timer",
    icon: "timer",
    hint: "Companio can time it so you don't have to watch the clock.",
  },
];

export function classifyAction(action) {
  const text = String(action || "").trim();
  if (!text) return { kind: ACTION_KIND.INSTRUCTION, technique: null, action: "", control: null };

  const technique = matchTechnique(text);
  if (technique) return { kind: ACTION_KIND.GUIDED, technique, action: text, control: null };

  const lower = text.toLowerCase();
  const control = ACTIONABLE.find((a) => a.match.some((m) => lower.includes(m))) || null;
  if (control) return { kind: ACTION_KIND.ACTIONABLE, technique: null, action: text, control };

  return { kind: ACTION_KIND.INSTRUCTION, technique: null, action: text, control: null };
}
