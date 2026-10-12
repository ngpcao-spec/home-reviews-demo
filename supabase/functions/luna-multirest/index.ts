import { assertMembership, requireUser } from "../_shared/auth.ts";
import { assertEvidence40ActiveUser } from "../_shared/decisions-evidence40-auth.ts";
import {
  multirestHandler,
  type MultiView,
} from "../_shared/luna-multirest-api.ts";
import {
  blindMultiExport,
  MULTI_CONFIG,
  MULTI_ORG,
  MULTI_SOURCE_ID,
  MULTI_SOURCE_SHA,
  type MultiControl,
  type MultiIdentity,
  type MultiObservation,
  type MultiSet,
  prepareMultiSet,
  scoreMultirest,
  verifyMultiReferences,
} from "../_shared/luna-multirest.ts";
import { decisionsHash } from "../_shared/decisions-config.ts";
Deno.serve(multirestHandler(async (r) => {
  const ctx = await requireUser(r);
  await assertMembership(ctx.client, ctx.user.id, MULTI_ORG, [
    "owner",
    "admin",
    "manager",
  ]);
  await assertEvidence40ActiveUser(ctx.admin, ctx.user.id);
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const { data, error } = await ctx.admin.rpc(name, args);
    if (error) {
      console.error("MULTIREST_RPC_FAILED", {
        operation: name,
        code: error.code,
      });
      throw new Error(
        error.message.match(/(?:MULTIREST|FORBIDDEN)[A-Z_0-9]*/)?.[0] ??
          "MULTIREST_DATABASE_FAILED",
      );
    }
    return data;
  }
  async function read(): Promise<MultiView> {
    const { data: source, error: ce } = await ctx.admin.from(
      "analysis_jev_hybrid_controls",
    ).select("body,result_sha256").eq("id", MULTI_SOURCE_ID).single();
    if (
      ce || !source || source.result_sha256 !== MULTI_SOURCE_SHA ||
      await decisionsHash(source.body) !== MULTI_SOURCE_SHA
    ) throw new Error("MULTIREST_SOURCE_CHANGED");
    const { data: record, error } = await ctx.admin.from(
      "analysis_luna_multirest_sets",
    ).select("id,body,body_sha256,sealed_at").eq(
      "source_control_id",
      MULTI_SOURCE_ID,
    ).maybeSingle();
    if (error) throw new Error("MULTIREST_READ_FAILED");
    if (
      record &&
      (await decisionsHash(record.body) !== record.body_sha256 ||
        record.body.config_sha256 !== await decisionsHash(MULTI_CONFIG) ||
        record.body.source_sha256 !== MULTI_SOURCE_SHA ||
        await decisionsHash(record.body.cases) !== record.body.cases_sha256)
    ) throw new Error("MULTIREST_SET_CHANGED");
    const { data: seal, error: se } = record
      ? await ctx.admin.from("analysis_luna_multirest_reference_seals").select(
        "id,reference_sha256,sealed_at,body",
      ).eq("set_id", record.id).maybeSingle()
      : { data: null, error: null };
    if (se) throw new Error("MULTIREST_READ_FAILED");
    if (seal) {
      const verified = await verifyMultiReferences(
        record!.body,
        record!.body_sha256,
        seal.body,
      );
      if (verified.reference_sha256 !== seal.reference_sha256) {
        throw new Error("MULTIREST_REFERENCE_CHANGED");
      }
    }
    const { data: results, error: re } = record
      ? await ctx.admin.from("analysis_luna_multirest_results").select("*").eq(
        "set_id",
        record.id,
      )
      : { data: [], error: null };
    if (re) throw new Error("MULTIREST_READ_FAILED");
    const observations = (results ?? []).map((o) => ({
      ...o,
      theme_key: (record!.body as MultiSet).cases.find((c) =>
        c.review_id === o.review_id
      )!.candidate.theme_key,
    })) as MultiObservation[];
    return {
      record,
      reference_seal: seal,
      blind_export: record
        ? blindMultiExport(record.body, record.body_sha256)
        : null,
      result: seal && observations.length
        ? scoreMultirest(record!.body, seal.body.items, observations)
        : null,
      paid_enabled: false,
      can_launch: false,
      new_paid_calls: 0,
      production_enabled: false,
    };
  }
  return {
    read,
    freeze: async () => {
      const source = await rpc("luna_multirest_source_check") as {
        control: MultiControl;
        identities: MultiIdentity[];
        establishments: { id: string; organization_id: string; name: string }[];
        historical_ids: string[];
        cache_ids: string[];
      };
      const p = await prepareMultiSet(
        source.control,
        source.identities,
        source.establishments,
        source.historical_ids,
        source.cache_ids,
      );
      await rpc("save_luna_multirest_set", {
        p_user: ctx.user.id,
        p_body: p.body,
        p_sha: p.body_sha256,
      });
      return read();
    },
    seal: async (input) => {
      const v = await read();
      if (!v.record) {
        throw new Error("MULTIREST_SET_REQUIRED");
      }
      const p = await verifyMultiReferences(
        v.record.body,
        v.record.body_sha256,
        input,
      );
      await rpc("seal_luna_multirest_references", {
        p_user: ctx.user.id,
        p_set: v.record.id,
        p_body: p.body,
        p_sha: p.reference_sha256,
      });
      return read();
    },
  };
}));
