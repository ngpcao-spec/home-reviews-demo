// Preparation only. No API client, credentials or fetch dependency.
import { ECONOMY_CONFIG } from "./jev-economy-config.ts";
import {
  THEME_CHOICES,
  THEME_KEYS,
  type ThemeChoice,
  type ThemeKey,
} from "./jev-themes.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
export const DECISIONS_VERSION = "openai-decisions-exploratory-v1";
export const DECISIONS_MODEL = "gpt-6-luna";
export const DECISIONS_ENDPOINT = "/v1/decisions";
export const DECISIONS_RATE = .10;
export const DECISIONS_PAID_ENABLED = false;
export const LUNA_THRESHOLDS = Object.freeze({
  version: "luna-decisions-thresholds-v1",
  choice_min_confidence: .60,
  predicate_positive_threshold: .50,
  predicate_negative_threshold: .50,
  predicate_uncertainty_margin: .05,
  experimental_not_calibrated: true,
});
export type LunaVariant = "choice" | "predicate";
export type LunaChoice = ThemeChoice | "uncertain";
export const decisionsHash = (v: unknown) => negativeHash(canonicalJson(v));
interface V12Question {
  instructions: string;
  criteria: Record<ThemeChoice, string>;
}
export const v12Question = (theme: ThemeKey) =>
  ECONOMY_CONFIG.questions[theme] as unknown as V12Question;
export type DecisionQuestion = {
  name: string;
  type: "choice";
  instructions: string;
  choices: { value: string; description: string }[];
} | { name: string; type: "predicate"; instructions: string };
export function lunaQuestions(variant: LunaVariant): DecisionQuestion[] {
  return THEME_KEYS.flatMap<DecisionQuestion>((theme) => {
    const q = v12Question(theme);
    return variant === "choice"
      ? [{
        name: theme,
        type: "choice" as const,
        instructions: q.instructions,
        choices: THEME_CHOICES.map((value) => ({
          value,
          description: q.criteria[value],
        })),
      }]
      : (["positive", "negative"] as const).map((polarity) => ({
        name: `${theme}__${polarity}`,
        type: "predicate" as const,
        instructions: q.instructions +
          ` Evaluate only whether an explicitly ${polarity} opinion about this same theme is present. The other polarity may also be present. Return true even when BOTH polarities of this theme are expressed. Do not infer absence/presence of one polarity from the other.`,
      }));
  });
}
export const LUNA_CONFIGS = Object.freeze(
  Object.fromEntries(
    (["choice", "predicate"] as const).map(
      (variant) => [
        variant,
        Object.freeze({
          id: `luna-decisions-${variant}-v1`,
          version: DECISIONS_VERSION,
          model: DECISIONS_MODEL,
          endpoint: DECISIONS_ENDPOINT,
          repeat_count: 1,
          questions: lunaQuestions(variant),
          thresholds: LUNA_THRESHOLDS,
          source_configuration: ECONOMY_CONFIG.id,
          source_question_set: ECONOMY_CONFIG.question_set,
          paid_enabled: false,
          production_enabled: false,
        }),
      ],
    ),
  ),
);
export function lunaPayload(variant: LunaVariant, alias: string, text: string) {
  if (!text.trim() || !alias.trim()) {
    throw new Error("DECISIONS_ENGLISH_REQUIRED");
  }
  return {
    model: DECISIONS_MODEL,
    input: JSON.stringify({ review_alias: alias, analysis_text: text }),
    questions: lunaQuestions(variant),
  };
}
export function evidencePayload(
  alias: string,
  text: string,
  theme: ThemeKey,
  polarity: "positive" | "negative",
) {
  return {
    model: DECISIONS_MODEL,
    input: JSON.stringify({ review_alias: alias, analysis_text: text }),
    questions: [{
      name: "evidence_support",
      type: "choice" as const,
      instructions: v12Question(theme).instructions +
        ` Judge whether the English text supports the proposed ${polarity} association for theme ${theme}. A positive and negative opinion about this SAME theme supports either corresponding association. Use uncertain for unresolved ambiguity, unclear entity, negation, irony or temporal reversal. Reported symptoms never establish medical causality.`,
      choices: [{
        value: "supported",
        description:
          "The proposed theme and polarity are supported by the text.",
      }, {
        value: "unsupported",
        description: "The text does not support this theme and polarity.",
      }, {
        value: "uncertain",
        description: "The available text leaves a substantive ambiguity.",
      }],
    }],
  };
}
export const EVIDENCE_CONFIG = Object.freeze({
  id: "luna-decisions-evidence-choice-v1",
  model: DECISIONS_MODEL,
  endpoint: DECISIONS_ENDPOINT,
  confidence_min: .60,
  repeat_count: 1,
  paid_enabled: false,
  production_enabled: false,
  source_configuration: ECONOMY_CONFIG.id,
  source_question_set: ECONOMY_CONFIG.question_set,
  source_questions: ECONOMY_CONFIG.questions,
});
export interface LunaPrediction {
  positive_present?: boolean | null;
  negative_present?: boolean | null;
  theme_key: ThemeKey;
  choice: LunaChoice | null;
  native_choice: ThemeChoice | null;
  positive: number | null;
  negative: number | null;
  confidence: number | null;
  status: "answered" | "abstained" | "refused";
  reason: string | null;
}
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("DECISIONS_INVALID_RESPONSE");
  }
  return v as Record<string, unknown>;
};
const probability = (v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error("DECISIONS_INVALID_PROBABILITY");
  }
  return v;
};
export function choiceDistribution(
  a: Record<string, unknown>,
  allowed: readonly string[],
) {
  if (
    !Array.isArray(a.probabilities) ||
    a.probabilities.length !== allowed.length || typeof a.choice !== "string" ||
    !allowed.includes(a.choice)
  ) throw new Error("DECISIONS_INVALID_CHOICE");
  const values: Record<string, number> = {};
  for (const raw of a.probabilities) {
    const p = obj(raw);
    if (
      typeof p.value !== "string" || !allowed.includes(p.value) ||
      p.value in values
    ) throw new Error("DECISIONS_INVALID_DISTRIBUTION");
    values[p.value] = probability(p.probability);
  }
  if (
    Math.abs(Object.values(values).reduce((n, p) => n + p, 0) - 1) >
      .01 + Number.EPSILON * 8
  ) throw new Error("DECISIONS_INVALID_DISTRIBUTION");
  return { values, confidence: probability(a.confidence) };
}
export function parseDecisionEnvelope(raw: unknown, names: string[]) {
  const r = obj(raw);
  if (
    typeof r.model !== "string" || !r.model.startsWith(DECISIONS_MODEL) ||
    !Array.isArray(r.answers) || r.answers.length !== names.length
  ) throw new Error("DECISIONS_INCOMPLETE_RESPONSE");
  const answers = new Map<string, Record<string, unknown>>();
  for (const v of r.answers) {
    const a = obj(v);
    if (
      typeof a.name !== "string" || !names.includes(a.name) ||
      answers.has(a.name)
    ) throw new Error("DECISIONS_INVALID_ANSWER_ID");
    answers.set(a.name, a);
  }
  const usage = obj(r.usage);
  for (const k of ["input_tokens", "output_tokens", "total_tokens"]) {
    if (!Number.isSafeInteger(usage[k]) || (usage[k] as number) < 0) {
      throw new Error("DECISIONS_INVALID_USAGE");
    }
  }
  if (
    usage.total_tokens !==
      Number(usage.input_tokens) + Number(usage.output_tokens)
  ) throw new Error("DECISIONS_INVALID_USAGE");
  return {
    model: r.model,
    answers,
    usage: {
      input_tokens: usage.input_tokens as number,
      output_tokens: usage.output_tokens as number,
      total_tokens: usage.total_tokens as number,
    },
    input_only_estimated_cost_usd: Number(usage.input_tokens) * DECISIONS_RATE /
      1e6,
    rate_premiums_not_verified: true,
  };
}
export function parseLuna(raw: unknown, variant: LunaVariant) {
  const e = parseDecisionEnvelope(
    raw,
    lunaQuestions(variant).map((q) => q.name),
  );
  const predictions = THEME_KEYS.map((theme): LunaPrediction => {
    const names = variant === "choice"
        ? [theme]
        : [`${theme}__positive`, `${theme}__negative`],
      answers = names.map((n) => e.answers.get(n)!);
    if (answers.some((a) => a.type === "refusal")) {
      return {
        theme_key: theme,
        choice: null,
        native_choice: null,
        positive: null,
        negative: null,
        confidence: null,
        status: "refused",
        positive_present: null,
        negative_present: null,
        reason: "PROVIDER_REFUSAL",
      };
    }
    if (variant === "choice") {
      const a = answers[0];
      if (a.type !== "choice") throw new Error("DECISIONS_WRONG_TYPE");
      const d = choiceDistribution(a, THEME_CHOICES),
        uncertain = d.confidence < LUNA_THRESHOLDS.choice_min_confidence;
      return {
        theme_key: theme,
        choice: uncertain ? "uncertain" : a.choice as ThemeChoice,
        native_choice: a.choice as ThemeChoice,
        positive: d.values.positive + d.values.both,
        negative: d.values.negative + d.values.both,
        confidence: d.confidence,
        status: uncertain ? "abstained" : "answered",
        positive_present: uncertain
          ? null
          : a.choice === "positive" || a.choice === "both",
        negative_present: uncertain
          ? null
          : a.choice === "negative" || a.choice === "both",
        reason: uncertain ? "EXPERIMENTAL_CONFIDENCE_ABSTENTION" : null,
      };
    }
    if (answers.some((a) => a.type !== "predicate")) {
      throw new Error("DECISIONS_WRONG_TYPE");
    }
    const positive = probability(answers[0].probability),
      negative = probability(answers[1].probability),
      margin = LUNA_THRESHOLDS.predicate_uncertainty_margin;
    const uncertain = Math.abs(positive - .5) <= margin + 8 * Number.EPSILON ||
        Math.abs(negative - .5) <= margin + 8 * Number.EPSILON,
      p = positive >= LUNA_THRESHOLDS.predicate_positive_threshold,
      n = negative >= LUNA_THRESHOLDS.predicate_negative_threshold;
    return {
      theme_key: theme,
      choice: uncertain
        ? "uncertain"
        : p
        ? n ? "both" : "positive"
        : n
        ? "negative"
        : "absent",
      native_choice: null,
      positive,
      negative,
      confidence: null,
      status: uncertain ? "abstained" : "answered",
      positive_present: Math.abs(positive - .5) <= margin + 8 * Number.EPSILON
        ? null
        : p,
      negative_present: Math.abs(negative - .5) <= margin + 8 * Number.EPSILON
        ? null
        : n,
      reason: uncertain ? "EXPERIMENTAL_PROBABILITY_MARGIN_ABSTENTION" : null,
    };
  });
  return { ...e, answers: undefined, predictions, single_pass_stability: null };
}
export function parseEvidenceDecision(raw: unknown) {
  const e = parseDecisionEnvelope(raw, ["evidence_support"]),
    a = e.answers.get("evidence_support")!;
  if (a.type === "refusal") {
    return {
      ...e,
      answers: undefined,
      status: "uncertain",
      confidence: null,
      refused: true,
    };
  }
  if (a.type !== "choice") throw new Error("DECISIONS_WRONG_TYPE");
  const d = choiceDistribution(a, ["supported", "unsupported", "uncertain"]);
  return {
    ...e,
    answers: undefined,
    status: d.confidence < EVIDENCE_CONFIG.confidence_min
      ? "uncertain"
      : String(a.choice),
    confidence: d.confidence,
    probabilities: d.values,
    refused: false,
  };
}
export function dispatchDecisions(): Promise<never> {
  return Promise.reject(new Error("DECISIONS_PAID_EXECUTION_DISABLED"));
}
