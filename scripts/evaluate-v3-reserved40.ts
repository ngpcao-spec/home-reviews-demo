// Run locally with Deno --deny-net. No database writes and no provider calls.
import {
  buildReservedEvaluation,
  evaluationHash,
  type EvaluationManifest,
  FROZEN_ENGINE_COMMIT,
  FROZEN_REFERENCE_COMMIT,
  type ReservedReference,
  type ReservedSource,
  runFrozenV3,
} from "../supabase/functions/_shared/pilot-evidence-v3-reserved-evaluation.ts";
import { negativeHash } from "../supabase/functions/_shared/negative-validation-core.ts";
const [sourcePath, outputPath] = Deno.args;
if (!sourcePath || !outputPath) throw new Error("USAGE_SOURCE_OUTPUT_REQUIRED");
const gitFile = async (commit: string, path: string) => {
  const result = await new Deno.Command("git", {
    args: ["show", commit + ":" + path],
  }).output();
  if (!result.success) throw new Error("FROZEN_GIT_ARTIFACT_MISSING");
  return new TextDecoder().decode(result.stdout);
};
const paths = new Set<string>(), files: EvaluationManifest["engine_files"] = [];
async function pin(path: string) {
  if (paths.has(path)) return;
  paths.add(path);
  const frozen = await gitFile(FROZEN_ENGINE_COMMIT, path),
    current = await Deno.readTextFile(path);
  if (frozen.replaceAll("\r\n", "\n") !== current.replaceAll("\r\n", "\n")) {
    throw new Error("FROZEN_ENGINE_FILE_CHANGED:" + path);
  }
  files.push({ path, git_blob_sha256: await negativeHash(frozen) });
  for (
    const match of frozen.matchAll(
      /(?:from\s*|import\s*)['"](\.[^'"]+\.ts)['"]/g,
    )
  ) {
    const url = new URL(match[1], new URL(path, "file:///"));
    await pin(decodeURIComponent(url.pathname.slice(1)));
  }
}
for (
  const path of [
    "supabase/functions/_shared/pilot-evidence-v3.ts",
    "supabase/functions/_shared/pilot-evidence-v3-audit.ts",
    "supabase/functions/_shared/jev-economy-cache.ts",
  ]
) await pin(path);
files.sort((a, b) => a.path.localeCompare(b.path));
const source = JSON.parse(
    await Deno.readTextFile(sourcePath),
  ) as ReservedSource,
  outputs = runFrozenV3(source);
await Deno.writeTextFile(
  outputPath + ".verifier.json",
  JSON.stringify(
    {
      engine_commit: FROZEN_ENGINE_COMMIT,
      outputs,
      sha256: await evaluationHash(outputs),
    },
    null,
    2,
  ) + "\n",
);
// The frozen verifier output artifact is written before loading the GPT-6 annotations.
const refPath =
    "docs/pilot-evidence-v3-gpt6-reserved40-reference-20261011.json",
  refFile = await gitFile(FROZEN_REFERENCE_COMMIT, refPath),
  refWorking = await Deno.readTextFile(refPath);
if (refWorking.replaceAll("\r\n", "\n") !== refFile.replaceAll("\r\n", "\n")) {
  throw new Error("FROZEN_REFERENCE_FILE_CHANGED");
}
const reference = JSON.parse(refFile) as ReservedReference,
  posthocPath = "docs/jev-economic-pilot-gpt6-posthoc-audit-20261011.json",
  posthocFile = await gitFile(FROZEN_ENGINE_COMMIT, posthocPath);
if (
  (await Deno.readTextFile(posthocPath)).replaceAll("\r\n", "\n") !==
    posthocFile.replaceAll("\r\n", "\n")
) throw new Error("FROZEN_POSTHOC_CHANGED");
const manifest: EvaluationManifest = {
  engine_commit: FROZEN_ENGINE_COMMIT,
  reference_commit: FROZEN_REFERENCE_COMMIT,
  engine_files: files,
  engine_files_sha256: await evaluationHash(files),
  reference_file_sha256: await negativeHash(refFile),
  reference_canonical_sha256: await evaluationHash(reference),
  posthoc_file_sha256: await negativeHash(posthocFile),
  runtime: "Deno " + Deno.version.deno + "; offline --deny-net",
};
const result = await buildReservedEvaluation(
    source,
    outputs,
    reference,
    JSON.parse(posthocFile),
    manifest,
  ),
  sha256 = await evaluationHash(result);
await Deno.writeTextFile(
  outputPath,
  JSON.stringify({ result, result_sha256: sha256 }, null, 2) + "\n",
);
console.log(JSON.stringify(
  {
    result_sha256: sha256,
    engine_files_verified: files.length,
    reference_file_sha256: manifest.reference_file_sha256,
    metrics: result.metrics,
    by_axis: result.by_axis,
    jev_exact: result.jev_exact_choice_agreement,
    case_summary: result.cases.map((c) => ({
      position: c.position,
      theme: c.theme_key,
      polarity: c.polarity,
      choice: c.reference_choice,
      status: c.status,
      category: c.category,
    })),
  },
  null,
  2,
));
