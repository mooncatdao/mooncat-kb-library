export type LibraryLink = {
  label: string;
  description: string;
  path: string;
};

export const HUMAN_GUIDE_PATH = "docs/mooncat-kb-guide.md";

export const LIBRARY_TOPICS: LibraryLink[] = [
  {
    label: "Population and profiles",
    description: "Start with the static population index and profile-oriented context.",
    path: "docs/mooncat-population-index.md",
  },
  {
    label: "Identifiers",
    description: "Keep Cat IDs, rescue order, token IDs, and local indexes distinct.",
    path: "docs/identifier-conventions.md",
  },
  {
    label: "Naming",
    description: "Follow original naming behavior and finalized name evidence.",
    path: "docs/mooncat-naming.md",
  },
  {
    label: "Contracts and events",
    description: "Inspect reviewed ABI shapes, events, and bounded semantics.",
    path: "docs/contract-abi-event-registry.md",
  },
  {
    label: "Genesis",
    description: "Explore the released Genesis membership and its evidence boundaries.",
    path: "docs/genesis-cats.md",
  },
  {
    label: "Accessories",
    description: "Trace accessory lifecycle, images, and materialization notes.",
    path: "docs/mooncat-accessory-system.md",
  },
  {
    label: "Colors and rendering",
    description: "Find reviewed color, parser, SVG, and rendering explanations.",
    path: "docs/source-map.md",
  },
  {
    label: "Rescue and mining",
    description: "Read the bounded rescue-mining explanation and safety limits.",
    path: "docs/rescue-mining.md",
  },
  {
    label: "Sources and provenance",
    description: "Understand evidence status, source identity, and uncertainty.",
    path: "docs/reference-policy.md",
  },
  {
    label: "Build with the KB",
    description: "Use the concise agent and contributor workflow entrypoints.",
    path: "docs/agent-usage.md",
  },
];

export const LIBRARY_EXAMPLES: LibraryLink[] = [
  {
    label: "Rescue mining widget",
    description: "A wallet-free, bounded rescue-mining example.",
    path: "examples/rescue-mining-widget/README.md",
  },
  {
    label: "Static MoonCat profile resolver",
    description: "Resolve an explicitly tagged Cat ID or rescue order locally.",
    path: "examples/mooncat-profile/README.md",
  },
  {
    label: "Supplied event decoder",
    description: "Decode an already-supplied log against reviewed registries.",
    path: "examples/mooncat-event-decoder/README.md",
  },
];
