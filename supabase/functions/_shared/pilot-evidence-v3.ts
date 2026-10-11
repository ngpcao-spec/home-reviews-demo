import type { ThemeKey } from "./jev-themes.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
export const V3_VERSION = "pilot-evidence-semantic-v3";
export const V3_VERIFIER = "structured-english-predicate-binding-v1";
export type EntityKind =
  | "food"
  | "drink"
  | "staff"
  | "service"
  | "customer"
  | "atmosphere"
  | "decor"
  | "comfort"
  | "cleanliness"
  | "noise"
  | "location"
  | "price"
  | "bill"
  | "portion"
  | "menu";
export interface Token {
  word: string;
  start: number;
  end: number;
}
export interface Entity {
  kind: EntityKind;
  name: string;
  start: number;
  end: number;
  token: number;
  inherited: boolean;
}
export interface Clause {
  id: number;
  start: number;
  end: number;
  text: string;
  tokens: Token[];
  entities: Entity[];
  time: "current" | "past" | "unspecified";
  hypothetical: boolean;
}
export interface Statement {
  id: string;
  theme: ThemeKey;
  polarity: "positive" | "negative";
  claim: string;
  entity: EntityKind;
  entity_name: string;
  start: number;
  end: number;
  quote: string;
  clause: number;
  time: Clause["time"];
  negation: boolean;
  relation: string;
  actionable: boolean;
}
export interface ReviewGraph {
  clauses: Clause[];
  statements: Statement[];
  flags: string[];
}
const LEXICON: Record<EntityKind, string[]> = {
  food: [
    "food",
    "meal",
    "dish",
    "breakfast",
    "lunch",
    "dinner",
    "pancake",
    "burger",
    "steak",
    "cake",
    "shakshuka",
    "shakshouka",
    "pastry",
    "croissant",
    "bun",
    "toast",
    "granola",
    "salad",
    "pizza",
    "pasta",
    "lasagna",
    "sandwich",
    "omelet",
    "omelette",
    "egg",
    "dessert",
    "chicken",
    "beef",
    "meat",
    "fish",
    "potato",
    "wrap",
    "yogurt",
    "yoghurt",
    "bread",
    "cuisine",
  ],
  drink: [
    "coffee",
    "espresso",
    "tea",
    "matcha",
    "kombucha",
    "latte",
    "cappuccino",
    "juice",
    "drink",
    "smoothie",
    "beverage",
    "cocktail",
    "beer",
    "wine",
    "soda",
  ],
  staff: [
    "staff",
    "waiter",
    "waitress",
    "server",
    "employee",
    "personnel",
    "manager",
    "team",
    "owner",
  ],
  service: ["service", "serving"],
  customer: [
    "customer",
    "guest",
    "doctor",
    "wife",
    "son",
    "daughter",
    "family",
    "friend",
    "visitor",
  ],
  atmosphere: ["atmosphere", "ambiance", "ambience", "vibe", "mood", "feel"],
  decor: ["decor", "decoration", "interior", "design", "architecture"],
  comfort: [
    "chair",
    "seat",
    "seating",
    "room",
    "temperature",
    "space",
    "area",
    "lounge",
  ],
  cleanliness: [
    "toilet",
    "restroom",
    "bathroom",
    "loo",
    "hygiene",
    "cleanliness",
    "kitchen",
    "mold",
    "mould",
    "soap",
  ],
  noise: ["noise", "music", "sound"],
  location: [
    "location",
    "entrance",
    "access",
    "distance",
    "drive",
    "journey",
    "trip",
    "downtown",
    "centre",
    "center",
  ],
  price: ["price", "cost", "money", "expensive", "affordable", "cheap"],
  bill: ["bill", "billing", "fee", "charge", "tax", "vat", "surcharge"],
  portion: ["portion", "quantity", "amount"],
  menu: ["menu", "selection", "variety", "option", "ingredient"],
};
const POS = [
  "best",
  "delicious",
  "tasty",
  "fantastic",
  "excellent",
  "amazing",
  "wonderful",
  "great",
  "good",
  "outstanding",
  "scrumptious",
  "authentic",
  "nice",
  "lovely",
  "beautiful",
  "stylish",
  "stunning",
  "impressive",
  "fresh",
  "clean",
  "spotless",
  "quiet",
  "peaceful",
  "comfortable",
  "spacious",
  "friendly",
  "kind",
  "polite",
  "welcoming",
  "professional",
  "competent",
  "knowledgeable",
  "skilled",
  "expert",
  "capable",
  "attentive",
  "responsive",
  "generous",
  "large",
  "affordable",
  "reasonable",
  "cheap",
  "inexpensive",
  "quick",
  "fast",
  "prompt",
];
const NEG = [
  "bad",
  "terrible",
  "awful",
  "horrible",
  "gross",
  "bland",
  "tasteless",
  "flavorless",
  "flavourless",
  "chewy",
  "disappointing",
  "unpleasant",
  "ugly",
  "dirty",
  "filthy",
  "unclean",
  "stale",
  "spoiled",
  "noisy",
  "loud",
  "uncomfortable",
  "cramped",
  "stuffy",
  "rude",
  "unfriendly",
  "impolite",
  "unprofessional",
  "incompetent",
  "slow",
  "tiny",
  "small",
  "insufficient",
  "expensive",
  "overpriced",
  "burnt",
  "overcooked",
  "undercooked",
  "raw",
  "lukewarm",
  "inconsistent",
];
const EVENT_RULES: {
  id: string;
  theme: ThemeKey;
  polarity: "positive" | "negative";
  claim: string;
  entity: EntityKind;
  pattern: string;
  needs?: string;
}[] = [
  {
    id: "care.check",
    theme: "attentiveness",
    polarity: "positive",
    claim: "customer_follow_up",
    entity: "staff",
    pattern:
      "check(?:ed|ing)?(?: on| if| whether)|inquir(?:e|ed) about (?:your|our|my|the) needs|noticed.{0,45}(?:left|needed|needs)",
    needs: "staff|waiter|waitress|server|they|employee",
  },
  {
    id: "care.request",
    theme: "attentiveness",
    polarity: "positive",
    claim: "request_response",
    entity: "staff",
    pattern:
      "(?:brought|bring|provided|responded|adjusted|made).{0,70}(?:request|preference|liking)|(?:asked|requested).{0,80}(?:brought|provided|responded)|brought.{0,30}(?:right away|immediately)|(?:as soon as|on arrival).{0,70}(?:water|door)",
  },
  {
    id: "care.absent",
    theme: "attentiveness",
    polarity: "negative",
    claim: "customer_care_missing",
    entity: "staff",
    pattern:
      "(?:staff|waiter|server|they).{0,35}(?:ignored|neglected) (?:us|me|our)|(?:no waiter|no server|nobody).{0,40}(?:came|helped|took)|(?:never|did not|didn.t).{0,20}(?:check on|respond to|help) (?:us|me|our)",
  },
  {
    id: "professional.knowledge",
    theme: "professionalism",
    polarity: "positive",
    claim: "staff_knowledge",
    entity: "staff",
    pattern:
      "(?:staff|waiter|server|they).{0,35}(?:knew|knows|know|understood).{0,25}(?:menu|ingredient|allerg|dietary)|(?:staff|waiter|server).{0,40}answered.{0,30}accurately",
  },
  {
    id: "professional.handling",
    theme: "professionalism",
    polarity: "positive",
    claim: "competent_handling",
    entity: "staff",
    pattern:
      "(?:handled|acted|behaved).{0,30}(?:professionally|competently|expertly)|(?:staff|manager|owner).{0,60}(?:resolved|fixed|addressed).{0,40}(?:problem|complaint|issue)|took.{0,30}(?:comments|feedback|request).{0,30}(?:seriously|into consideration)",
  },
  {
    id: "professional.training",
    theme: "professionalism",
    polarity: "negative",
    claim: "explicit_competence_gap",
    entity: "staff",
    pattern:
      "(?:untrained|incompetent|unprofessional) staff|staff.{0,30}(?:untrained|incompetent|unprofessional)",
  },
  {
    id: "communication.problem",
    theme: "communication",
    polarity: "negative",
    claim: "communication_difficulty",
    entity: "staff",
    pattern:
      "(?:difficult|hard|impossible) to understand|(?:could not|couldn.t|did not|didn.t) understand.{0,30}(?:order|request|explanation)|language barrier|difficulties? in (?:understanding|communication)",
  },
  {
    id: "communication.explanation",
    theme: "communication",
    polarity: "positive",
    claim: "customer_explanation",
    entity: "staff",
    pattern:
      "(?:clearly|patiently|well) explained|explained.{0,35}(?:menu|how|options|ingredients)|(?:understood|listened to) (?:our|my) (?:order|request)|menu.{0,40}(?:languages|translated).{0,40}(?:easy to order|understand)",
  },
  {
    id: "coordination.positive",
    theme: "coordination",
    polarity: "positive",
    claim: "service_organization",
    entity: "service",
    pattern:
      "well organized|well coordinated|staff.{0,35}(?:worked smoothly together|coordinated)",
  },
  {
    id: "coordination.negative",
    theme: "coordination",
    polarity: "negative",
    claim: "service_organization_problem",
    entity: "service",
    pattern:
      "disorganized|uncoordinated|orders.{0,25}(?:different times|out of sync)",
  },
  {
    id: "order.missing",
    theme: "order_accuracy",
    polarity: "negative",
    claim: "order_error",
    entity: "service",
    pattern:
      "(?:wrong|incorrect|missing|forgotten).{0,30}(?:order|dish|item)|(?:did not|didn.t).{0,15}bring.{0,20}(?:one of|ordered|dish)|instead of.{0,40}(?:served|brought)|promised.{0,40}(?:instead|served)",
  },
  {
    id: "order.correct",
    theme: "order_accuracy",
    polarity: "positive",
    claim: "correct_order",
    entity: "service",
    pattern:
      "(?:order|ordered).{0,25}(?:correct|accurate|exactly right)|everything we ordered arrived",
  },
  {
    id: "wait.long",
    theme: "wait_time",
    polarity: "negative",
    claim: "service_delays",
    entity: "service",
    pattern:
      "long wait|(?:service|serving).{0,20}slow|slow service|waited.{0,20}(?:long|hours?|(?:[3-9]\\d) minutes)",
  },
  {
    id: "wait.fast",
    theme: "wait_time",
    polarity: "positive",
    claim: "prompt_service",
    entity: "service",
    pattern:
      "(?:food|order).{0,20}(?:served|arrived|brought) quickly|(?:fast|quick|prompt) service|did not have to wait|no wait",
  },
  {
    id: "value.positive",
    theme: "value",
    polarity: "positive",
    claim: "value_appraisal",
    entity: "price",
    pattern:
      "(?:good|great|excellent) value|worth (?:the )?(?:price|money|cost)|prices?.{0,20}(?:justify|justified).{0,20}quality|(?:quality|meal|food|service).{0,35}(?:worth|justif).{0,20}(?:price|cost)|deserve(?:s)? to be paid for",
  },
  {
    id: "value.negative",
    theme: "value",
    polarity: "negative",
    claim: "value_mismatch",
    entity: "price",
    pattern:
      "poor value|bad value|not worth (?:the )?(?:price|money|cost)|(?:expensive|pricey).{0,20}for (?:what|the portion|such quality)|(?:portions?.{0,20}small|small portions?).{0,20}for (?:the )?price|prices? and (?:quality|service).{0,20}not in line",
  },
  {
    id: "billing.extra",
    theme: "billing",
    polarity: "negative",
    claim: "bill_charge",
    entity: "bill",
    pattern:
      "(?:extra|unexpected|hidden|additional) (?:fee|charge)|overcharged|(?:bill|charged).{0,30}(?:error|wrong|extra|twice)|(?:tax|vat|service charge).{0,65}(?:added|included)|include.{0,45}bill.{0,60}(?:no note|haven.t seen)",
  },
  {
    id: "billing.clear",
    theme: "billing",
    polarity: "positive",
    claim: "clear_billing",
    entity: "bill",
    pattern:
      "(?:correct|accurate|clear) (?:bill|billing)|no hidden (?:charges|fees)",
  },
  {
    id: "wayfinding",
    theme: "location",
    polarity: "negative",
    claim: "wayfinding_problem",
    entity: "location",
    pattern:
      "(?:hard|difficult|impossible) to find|could not find|couldn.t find|entrance.{0,25}hidden|no signs",
  },
  {
    id: "distance",
    theme: "location",
    polarity: "negative",
    claim: "distance_problem",
    entity: "location",
    pattern:
      "too far|long (?:drive|journey|trip)|far away|remote location|(?:downside|problem).{0,40}(?:distance|drive)|take a taxi from downtown",
  },
  {
    id: "access",
    theme: "location",
    polarity: "negative",
    claim: "physical_access_problem",
    entity: "location",
    pattern:
      "(?:hard|difficult|impossible) to (?:access|reach|get to)|inaccessible|wheelchair.{0,30}(?:impossible|stairs|blocked)|accessibility.{0,20}(?:not|poor)",
  },
  {
    id: "freshness",
    theme: "freshness",
    polarity: "negative",
    claim: "food_freshness",
    entity: "food",
    pattern: "not fresh|stale|spoiled",
    needs: "food|meal|dish|ingredient|meat|bread",
  },
  {
    id: "cooking",
    theme: "cooking",
    polarity: "negative",
    claim: "cooking_defect",
    entity: "food",
    pattern: "overcooked|undercooked|burnt|raw (?:chicken|meat)|badly prepared",
  },
  {
    id: "temperature",
    theme: "temperature",
    polarity: "negative",
    claim: "served_temperature",
    entity: "food",
    pattern: "(?:served|arrived) cold|lukewarm",
    needs: "food|dish|meal|steak|pasta|egg",
  },
  {
    id: "temperature.good",
    theme: "temperature",
    polarity: "positive",
    claim: "served_temperature",
    entity: "food",
    pattern: "(?:served hot|served warm|right temperature)",
    needs: "food|dish|meal",
  },
  {
    id: "cooking.good",
    theme: "cooking",
    polarity: "positive",
    claim: "cooking_execution",
    entity: "food",
    pattern: "(?:well|perfectly) (?:cooked|prepared)",
    needs: "food|dish|meal|chef|steak",
  },
  {
    id: "presentation",
    theme: "presentation",
    polarity: "positive",
    claim: "food_presentation",
    entity: "food",
    pattern:
      "beautifully (?:presented|plated)|(?:beautiful|great) (?:presentation|plating)|looked as good as.{0,10}tasted|neatly presented",
  },
  {
    id: "presentation.bad",
    theme: "presentation",
    polarity: "negative",
    claim: "food_presentation",
    entity: "food",
    pattern: "(?:poor|bad|messy) (?:presentation|plating)",
  },
  {
    id: "variety.good",
    theme: "variety",
    polarity: "positive",
    claim: "menu_variety",
    entity: "menu",
    pattern:
      "(?:wide|large|great) (?:selection|variety)|many (?:menu )?options",
  },
  {
    id: "variety.bad",
    theme: "variety",
    polarity: "negative",
    claim: "menu_unavailability",
    entity: "menu",
    pattern:
      "(?:menu items|dishes|options|burgers).{0,35}(?:out of stock|unavailable|not available)|(?:limited|poor) (?:menu|selection|variety)",
  },
  {
    id: "consistency.good",
    theme: "consistency",
    polarity: "positive",
    claim: "consistent_quality",
    entity: "food",
    pattern: "consistently good|consistent quality|same good quality every",
  },
  {
    id: "consistency.bad",
    theme: "consistency",
    polarity: "negative",
    claim: "quality_variation",
    entity: "food",
    pattern:
      "inconsistent quality|quality varies|worse than (?:last|previous) (?:time|visit)|some dishes.{0,30}good.{0,30}others.{0,20}bad",
  },
  {
    id: "hygiene.problem",
    theme: "cleanliness",
    polarity: "negative",
    claim: "reported_hygiene",
    entity: "cleanliness",
    pattern:
      "(?:dirty|filthy|poor).{0,15}(?:toilet|restroom|loo|bathroom|hygiene)|black mold|black mould|(?:cockroaches|rats|pests).{0,25}(?:inside|restaurant)|soap.{0,25}diluted|staff.{0,25}touch(?:ed|ing).{0,15}served food",
  },
  {
    id: "hygiene.clean",
    theme: "cleanliness",
    polarity: "positive",
    claim: "reported_cleanliness",
    entity: "cleanliness",
    pattern:
      "(?:toilet|restroom|loo|bathroom).{0,20}clean|(?:clean|spotless).{0,15}(?:toilet|restroom|bathroom)|immaculately clean",
  },
];
const ATTRIBUTE_DOMAINS: Partial<Record<EntityKind, string[]>> = {
  price: [
    "expensive",
    "overpriced",
    "affordable",
    "reasonable",
    "cheap",
    "inexpensive",
  ],
  portion: ["tiny", "small", "insufficient", "generous", "large"],
  comfort: ["comfortable", "spacious", "uncomfortable", "cramped", "stuffy"],
  cleanliness: ["clean", "spotless", "dirty", "filthy", "unclean"],
  noise: ["quiet", "peaceful", "noisy", "loud"],
  location: [
    "nice",
    "beautiful",
    "impressive",
    "good",
    "bad",
    "disappointing",
    "unpleasant",
  ],
  decor: [
    "nice",
    "beautiful",
    "stylish",
    "stunning",
    "impressive",
    "ugly",
    "good",
    "bad",
  ],
  food: [
    "best",
    "delicious",
    "tasty",
    "fantastic",
    "excellent",
    "amazing",
    "wonderful",
    "great",
    "good",
    "outstanding",
    "scrumptious",
    "authentic",
    "bad",
    "terrible",
    "awful",
    "horrible",
    "gross",
    "bland",
    "tasteless",
    "flavorless",
    "flavourless",
    "chewy",
    "disappointing",
    "unpleasant",
    "fresh",
    "stale",
    "spoiled",
    "overcooked",
    "undercooked",
    "burnt",
    "raw",
  ],
  drink: [
    "best",
    "delicious",
    "tasty",
    "fantastic",
    "excellent",
    "amazing",
    "wonderful",
    "great",
    "good",
    "outstanding",
    "scrumptious",
    "bad",
    "terrible",
    "awful",
    "horrible",
    "gross",
    "bland",
    "tasteless",
    "flavorless",
    "flavourless",
    "disappointing",
    "unpleasant",
  ],
};
const lemma = (w: string) => {
  const x = w.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  return x === "pastries"
    ? "pastry"
    : x === "dishes"
    ? "dish"
    : x.endsWith("ies")
    ? x.slice(0, -3) + "y"
    : x.endsWith("s") && !x.endsWith("ss")
    ? x.slice(0, -1)
    : x;
};
const kinds = (word: string) =>
  Object.entries(LEXICON).filter(([, words]) => words.includes(lemma(word)))
    .map(([k]) => k as EntityKind);
function descriptorTheme(entity: EntityKind, word: string): ThemeKey | null {
  if (entity === "food") {
    return ["fresh", "stale", "spoiled"].includes(word)
      ? "freshness"
      : ["overcooked", "undercooked", "burnt", "raw"].includes(word)
      ? "cooking"
      : "food_quality";
  }
  if (entity === "drink") return "drinks";
  if (entity === "staff" || entity === "service") {
    return [
        "professional",
        "competent",
        "knowledgeable",
        "skilled",
        "expert",
        "capable",
        "unprofessional",
        "incompetent",
      ].includes(word)
      ? "professionalism"
      : ["attentive", "responsive"].includes(word)
      ? "attentiveness"
      : [
          "friendly",
          "kind",
          "polite",
          "welcoming",
          "rude",
          "unfriendly",
          "impolite",
          "nice",
        ].includes(word)
      ? "friendly_staff"
      : ["slow", "fast", "quick", "prompt"].includes(word) &&
          entity === "service"
      ? "wait_time"
      : null;
  }
  return ({
    atmosphere: "atmosphere",
    decor: "decor",
    comfort: "comfort",
    cleanliness: "cleanliness",
    noise: "noise",
    location: "location",
    price: "price_level",
    portion: "portions",
  } as Partial<Record<EntityKind, ThemeKey>>)[entity] ?? null;
}
export const v3RuleHash = () =>
  negativeHash(canonicalJson({
    version: V3_VERSION,
    verifier: V3_VERIFIER,
    lexicon: LEXICON,
    positive: POS,
    negative: NEG,
    attribute_domains: ATTRIBUTE_DOMAINS,
    event_rules: EVENT_RULES,
    parser_policy:
      "clause_tokens_entity_binding_scoped_negation_antecedent_two_clauses_contrast_temporal_visual_not_taste_resolved_events_v2",
    paid_semantic_enabled: false,
  }));
export function parseReviewV3(text: string): ReviewGraph {
  const clauses: Clause[] = [],
    statements: Statement[] = [],
    flags: string[] = [];
  let prior: Entity[] = [];
  for (const sentence of text.matchAll(/[^.!?\n;]+(?:[.!?;]+|$)/g)) {
    const parts: { a: number; b: number }[] = [];
    let from = 0;
    for (
      const m of sentence[0].matchAll(/\b(?:but|however|whereas|although)\b/gi)
    ) {
      parts.push({ a: from, b: m.index });
      from = m.index + m[0].length;
    }
    parts.push({ a: from, b: sentence[0].length });
    for (const part of parts) {
      const raw = sentence[0].slice(part.a, part.b),
        left = raw.length - raw.trimStart().length,
        right = raw.trimEnd().length;
      if (right <= left) continue;
      const start = sentence.index + part.a + left,
        end = sentence.index + part.a + right,
        value = text.slice(start, end),
        tokens = [...value.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)].map(
          (m) => ({
            word: m[0].toLowerCase(),
            start: start + m.index,
            end: start + m.index + m[0].length,
          }),
        ),
        entities = tokens.flatMap((t, i) =>
          kinds(t.word).map((kind) => ({
            kind,
            name: t.word,
            start: t.start,
            end: t.end,
            token: i,
            inherited: false,
          }))
        ),
        past =
          /\b(?:used to|previous|formerly|before|yesterday|last visit|last time)\b/i
            .test(value),
        current = /\b(?:now|today|this time|currently|no longer)\b/i.test(
          value,
        ),
        c: Clause = {
          id: clauses.length,
          start,
          end,
          text: value,
          tokens,
          entities,
          time: current ? "current" : past ? "past" : "unspecified",
          hypothetical: /\b(?:if|wish|should|might|maybe|perhaps|may)\b/i.test(
            value,
          ),
        };
      clauses.push(c);
      const actors = [...new Map(prior.map((e) => [e.kind, e])).values()];
      if (
        !entities.length && /\b(?:it|they|them|ones)\b/i.test(value) &&
        actors.length === 1
      ) c.entities = [{ ...actors[0], inherited: true, token: 0 }];
      else if (
        !entities.length && /\b(?:it|they)\b/i.test(value) && actors.length > 1
      ) flags.push("AMBIGUOUS_ANTECEDENT");
      const add = (
        theme: ThemeKey,
        polarity: "positive" | "negative",
        claim: string,
        entity: EntityKind,
        entity_name: string,
        relation: string,
        negation = false,
        quoteStart = c.start,
      ) => {
        if (c.hypothetical) return;
        const qstart = Math.max(0, quoteStart),
          quote = text.slice(qstart, c.end);
        if (quote.length > 1200) return;
        statements.push({
          id: `c${c.id}:${theme}:${polarity}:${claim}:${statements.length}`,
          theme,
          polarity,
          claim,
          entity,
          entity_name,
          start: qstart,
          end: c.end,
          quote,
          clause: c.id,
          time: c.time,
          negation,
          relation,
          actionable: c.time !== "past",
        });
      };
      for (let i = 0; i < tokens.length; i++) {
        const word = tokens[i].word;
        if (!POS.includes(word) && !NEG.includes(word)) continue;
        const before = tokens.slice(Math.max(0, i - 4), i).map((t) => t.word),
          hasNeg = before.some((w) =>
            /^(?:not|never|no|isn't|isn’t|wasn't|wasn’t|weren't|weren’t|didn't|didn’t)$/
              .test(w)
          ) && !before.includes("only"),
          original = POS.includes(word) ? "positive" : "negative",
          polarity = hasNeg
            ? (original === "positive" ? "negative" : "positive")
            : original;
        const prev = c.entities.filter((e) =>
            e.token < i && i - e.token <= 7
          ).sort((a, b) => b.token - a.token),
          next = c.entities.filter((e) => e.token > i && e.token - i <= 4).sort(
            (a, b) => a.token - b.token,
          ),
          copula = before.some((w) =>
            /^(?:is|are|was|were|tastes|tasted|seems|seemed)$/.test(w)
          );
        const self = c.entities.find((e) =>
          e.token === i && e.kind === "price"
        );
        const e = self ?? (copula ? prev[0] : next[0] ?? prev[0]);
        if (!e) continue;
        if (
          !self && prev[0] && next[0] && !copula &&
          next[0].token - i === i - prev[0].token &&
          prev[0].kind !== next[0].kind
        ) {
          flags.push("AMBIGUOUS_ATTRIBUTE_BINDING");
          continue;
        }
        if (e.kind === "customer") continue;
        if (
          (e.kind === "food" || e.kind === "drink") &&
          before.some((w) => ["look", "looks", "looked"].includes(w))
        ) {
          flags.push("VISUAL_ATTRIBUTE_NOT_TASTE");
          continue;
        }
        if (
          ATTRIBUTE_DOMAINS[e.kind] &&
          !ATTRIBUTE_DOMAINS[e.kind]!.includes(word)
        ) continue;
        const theme = descriptorTheme(e.kind, word);
        if (!theme) continue;
        if (
          theme === "professionalism" && e.kind === "service" &&
          ["excellent", "great"].includes(word)
        ) continue;
        if (
          theme === "location" &&
          ["nice", "beautiful", "good", "bad", "disappointing", "unpleasant"]
            .includes(word)
        ) {
          add(
            theme,
            polarity,
            "location_appeal",
            e.kind,
            e.name,
            "attribute_attached_to_entity",
            hasNeg,
          );
        } else if (theme === "price_level") {
          add(
            theme,
            polarity,
            polarity === "negative" ? "high_price" : "low_price",
            e.kind,
            e.name,
            "price_descriptor_not_value",
            hasNeg,
          );
        } else {add(
            theme,
            polarity,
            theme,
            e.kind,
            e.name,
            e.inherited
              ? "resolved_unique_antecedent"
              : "attribute_attached_to_entity",
            hasNeg,
            e.inherited ? e.start : c.start,
          );}
      }
      for (const r of EVENT_RULES) {
        if (r.needs && !new RegExp(r.needs, "i").test(value)) continue;
        const m = new RegExp(r.pattern, "i").exec(value);
        if (!m) continue;
        if (
          r.theme === "cleanliness" && r.polarity === "negative" &&
          /(?:mold|mould|dirt).{0,80}(?:removed|cleaned|cleared|gone)|(?:free of|no longer any).{0,25}(?:mold|mould|dirt)/i
            .test(value)
        ) {
          flags.push("EXPLICITLY_RESOLVED_HYGIENE_SIGNAL");
          continue;
        }
        if (c.hypothetical && !/check(?:ed|ing)? (?:if|whether)/i.test(value)) {
          continue;
        }
        const prefix = value.slice(Math.max(0, m.index - 16), m.index);
        if (/\b(?:not|never|no|didn.t|wasn.t)\s*$/i.test(prefix)) {
          flags.push("NEGATED_EVENT:" + r.theme);
          continue;
        }
        if (r.id === "value.positive" && /\bnot worth\b/i.test(value)) continue;
        const temporary = c.hypothetical;
        if (/check(?:ed|ing)? (?:if|whether)/i.test(value)) {
          c.hypothetical = false;
        }
        add(
          r.theme,
          r.polarity,
          r.claim,
          r.entity,
          r.entity,
          "predicate_argument_event",
          false,
        );
        c.hypothetical = temporary;
      }
      // 'Worth it' inherits monetary comparison only from an explicit adjacent price clause.
      if (/\bworth it\b/i.test(value)) {
        const previous = clauses.at(-2),
          monetary = previous &&
            /expensive|cheap|price|cost|money|paid/i.test(previous.text);
        if (monetary || /price|cost|money|paid/i.test(value)) {
          add(
            "value",
            /\bnot worth/i.test(value) ? "negative" : "positive",
            /\bnot worth/i.test(value) ? "value_mismatch" : "value_appraisal",
            "price",
            "price/value",
            "contrast_reference_to_price",
            false,
            previous?.start ?? c.start,
          );
        } else flags.push("IMPLICIT_VALUE_WITHOUT_MONETARY_ANTECEDENT");
      }
      if (
        /\b(?:professional|competent|knowledgeable|expert)\b/i.test(value) &&
        !c.entities.some((e) => e.kind === "staff" || e.kind === "service")
      ) flags.push("PROFESSIONAL_DESCRIPTOR_WITHOUT_STAFF_ENTITY");
      if (/\b(?:cough|sick|poisoning|vomit|symptoms)\b/i.test(value)) {
        flags.push("CUSTOMER_REPORTED_HEALTH_SIGNAL_NO_CAUSALITY");
      }
      if (entities.length) prior = entities;
    }
  }
  const unique = [
    ...new Map(
      statements.map(
        (s) => [`${s.start}:${s.end}:${s.theme}:${s.polarity}:${s.claim}`, s],
      ),
    ).values(),
  ];
  for (const theme of [...new Set(unique.map((s) => s.theme))]) {
    const own = unique.filter((s) => s.theme === theme),
      pos = own.filter((s) => s.polarity === "positive"),
      neg = own.filter((s) => s.polarity === "negative");
    if (pos.length && neg.length) {
      flags.push("MIXED_THEME:" + theme);
      if (
        pos.some((s) => s.time === "past") &&
          neg.some((s) => s.time === "current") ||
        neg.some((s) => s.time === "past") &&
          pos.some((s) => s.time === "current")
      ) flags.push("TEMPORAL_REVERSAL:" + theme);
      else if (
        pos.some((p) =>
          neg.some((n) =>
            n.entity_name === p.entity_name && n.clause !== p.clause
          )
        ) && !/\b(?:but|however|different|some|others|visit|time)\b/i.test(text)
      ) flags.push("UNRESOLVED_CONTRADICTION:" + theme);
    }
  }
  return { clauses, statements: unique, flags: [...new Set(flags)] };
}
export interface V3Decision {
  status: "supported_by_rule" | "unsupported_by_rule" | "review_needed";
  reason: string;
  statement: Statement | null;
  flags: string[];
  verification_type: "structured_deterministic_check";
  human_validated: false;
  ai_verified: false;
}
export function verifyGraphV3(
  graph: ReviewGraph,
  theme: ThemeKey,
  polarity: "positive" | "negative",
): V3Decision {
  const relevant = graph.statements.filter((s) => s.theme === theme),
    same = relevant.filter((s) => s.polarity === polarity),
    base = {
      flags: graph.flags,
      verification_type: "structured_deterministic_check" as const,
      human_validated: false as const,
      ai_verified: false as const,
    };
  if (graph.flags.includes("UNRESOLVED_CONTRADICTION:" + theme)) {
    return {
      ...base,
      status: "review_needed",
      reason: "UNRESOLVED_CONTRADICTION",
      statement: null,
    };
  }
  const current = same.filter((s) => s.time !== "past");
  if (
    same.length && !current.length &&
    relevant.some((s) => s.time === "current" && s.polarity !== polarity)
  ) {
    return {
      ...base,
      status: "review_needed",
      reason: "HISTORICAL_SIGNAL_REVERSED_NOW",
      statement: null,
    };
  }
  if (same.length) {
    return {
      ...base,
      status: "supported_by_rule",
      reason: "EXPLICIT_BOUND_ENTITY_POLARITY",
      statement: (current.length ? current : same).sort((a, b) =>
        Number(b.relation === "predicate_argument_event") -
          Number(a.relation === "predicate_argument_event") ||
        a.quote.length - b.quote.length
      )[0],
    };
  }
  const text = graph.clauses.map((c) => c.text).join(" ");
  let reason = "MEANING_NOT_ESTABLISHED";
  if (
    theme === "professionalism" &&
    /excellent service|great service|top-notch|superb service|friendly staff/i
      .test(text) &&
    !graph.flags.includes("PROFESSIONAL_DESCRIPTOR_WITHOUT_STAFF_ENTITY")
  ) reason = "GENERIC_SERVICE_NOT_PROFESSIONAL_COMPETENCE";
  else if (
    theme === "attentiveness" &&
    graph.statements.some((s) =>
      s.theme === "communication" || s.theme === "friendly_staff"
    )
  ) reason = "OTHER_SERVICE_DIMENSION_NOT_CUSTOMER_CARE";
  else if (
    theme === "food_quality" &&
    graph.statements.some((s) => s.theme === "drinks") &&
    !graph.clauses.some((c) => c.entities.some((e) => e.kind === "food"))
  ) reason = "DRINK_ENTITY_NOT_FOOD";
  else if (
    theme === "value" &&
    graph.statements.some((s) => s.theme === "price_level") &&
    !/worth|value|justify|for what|in line/i.test(text)
  ) reason = "PRICE_LEVEL_NOT_VALUE";
  else if (theme === "location" && /unassuming|nondescript/i.test(text)) {
    reason = "DESCRIPTIVE_LOCATION_NOT_ACCESS";
  }
  return {
    ...base,
    status: reason === "MEANING_NOT_ESTABLISHED"
      ? "review_needed"
      : "unsupported_by_rule",
    reason,
    statement: null,
  };
}
export const semanticV3Port = {
  enabled: false as const,
  request: (): Promise<never> =>
    Promise.reject(new Error("SEMANTIC_PAID_VERIFICATION_DISABLED")),
};
