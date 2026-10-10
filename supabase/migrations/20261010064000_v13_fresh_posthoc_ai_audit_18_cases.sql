-- PREPARED AUDIT, NOT APPLIED TO SUPABASE.
-- HOME Reviews V13 / 3rd holdout: 18 negative-polarity post-prediction AI judgments.
-- Does not change the 800 sealed labels, previous results, JEV configurations or production.
-- Review every precondition; execute once through a trusted, authorized Supabase migration.

CREATE TABLE IF NOT EXISTS public.analysis_jev_v13_fresh_posthoc_ai_audits (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references public.analysis_jev_v13_runs(id) on delete restrict,
    source_id uuid not null references public.analysis_jev_v13_sealed_inputs(id) on delete restrict,
    review_id uuid not null references public.reviews(id) on delete restrict,
    review_position integer not null check(review_position between 1 and 32),
    theme_key text not null,
    polarity text not null default 'negative' check(polarity='negative'),
    error_kind text not null check(error_kind in ('false_positive','false_negative')),
    initial_ai_choice text not null,
    v12_choice text not null,
    v13_choice text not null,
    reviewed_ai_choice text not null check(reviewed_ai_choice in ('absent','negative','positive','both','uncertain')),
    verdict text not null check(verdict in ('confirmed_v13_error','ai_reference_correction','ambiguous')),
    confidence text not null check(confidence in ('high','medium','low')),
    evidence_excerpt text not null,
    rationale_fr text not null,
    analysis_text_sha256 text not null check(analysis_text_sha256 ~ '^[a-f0-9]{64}$'),
    sealed_reference_sha256 text not null check(sealed_reference_sha256 ~ '^[a-f0-9]{64}$'),
    provenance text not null default 'chatgpt_gpt6_post_prediction_not_human_gold',
    scope text not null default 'diagnostic_only_no_historical_rewrite',
    created_at timestamptz not null default now(),
    unique (run_id,review_id,theme_key,error_kind)
);
COMMENT ON TABLE public.analysis_jev_v13_fresh_posthoc_ai_audits IS 'Post-hoc ChatGPT-GPT6 AI diagnostic. Never human Gold or blinded validation.';
ALTER TABLE public.analysis_jev_v13_fresh_posthoc_ai_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analysis_jev_v13_fresh_posthoc_ai_audits FROM public,anon,authenticated;
GRANT SELECT,INSERT ON public.analysis_jev_v13_fresh_posthoc_ai_audits TO service_role;

CREATE OR REPLACE FUNCTION public.guard_jev_v13_posthoc_audit_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'V13_POSTHOC_AUDIT_IMMUTABLE'; END; $$;
DROP TRIGGER IF EXISTS guard_jev_v13_posthoc_ai_audit ON public.analysis_jev_v13_fresh_posthoc_ai_audits;
CREATE TRIGGER guard_jev_v13_posthoc_ai_audit BEFORE UPDATE OR DELETE ON public.analysis_jev_v13_fresh_posthoc_ai_audits
FOR EACH ROW EXECUTE FUNCTION public.guard_jev_v13_posthoc_audit_immutability();

WITH
supplied(review_position,theme_key,error_kind,reviewed_ai_choice,verdict,confidence,evidence_excerpt,rationale_fr) AS (VALUES
    (5,'communication','false_negative','negative','confirmed_v13_error','medium','over some miscommunication','Un problème de communication est explicitement évoqué; un dessert a été offert à la suite de ce malentendu. Le service reste globalement apprécié, mais le signal négatif de communication existe.'),
    (11,'value','false_negative','negative','confirmed_v13_error','high','is there anything worth visiting that requires a ticket?','Le client met expressément en doute que le droit d’entrée de 80 000 VND soit justifié par la visite. C’est une critique du rapport dépense/expérience, sans déduire une erreur de facturation.'),
    (13,'communication','false_negative','negative','confirmed_v13_error','high','Staff should not automatically think you speak russian','Le client critique la supposition linguistique du personnel dans une interaction; c’est une objection explicite concernant la communication.'),
    (14,'value','false_negative','negative','confirmed_v13_error','medium','The price is on the high side','L’avis juxtapose cuisine ordinaire moins convaincante que celle d’un stand de rue et prix élevés. Le rapprochement soutient un jugement de mauvaise valeur, quoique moins explicite que « not worth it ».'),
    (21,'variety','false_negative','both','confirmed_v13_error','high','Wine list is not extensive but decent for an island','La carte des vins est dite peu étendue, mais néanmoins convenable pour l’île. Les deux jugements portent sur la diversité et justifient la polarité « both » pour variety.'),
    (32,'price_level','false_negative','negative','confirmed_v13_error','high','It''s quite pricey by local standards','Le client juge explicitement les prix élevés selon les standards locaux. « Worth it » est un jugement de valeur positive et ne rend pas le niveau de prix intrinsèquement positif.'),
    (4,'atmosphere','false_positive','absent','confirmed_v13_error','medium','The music near our table was so loud we could barely talk','L’avis critique explicitement le bruit et le service, sans appréciation distincte de l’ambiance générale. Le thème noise est pertinent; atmosphere négative ne doit pas être inféré automatiquement.'),
    (4,'professionalism','false_positive','absent','confirmed_v13_error','medium','staff came over far too frequently','Le passage dénonce l’intrusion et la fréquence des passages, sans juger distinctement la compétence professionnelle. Le signal relève plus directement d’attentiveness.'),
    (6,'coordination','false_positive','negative','ai_reference_correction','medium','Does not confirm orders and makes mistakes','Le défaut de confirmation et les erreurs concrètes illustrent une exécution du service déficiente, compatible avec coordination au sens large. La référence IA initiale « absent » est probablement trop restrictive.'),
    (9,'communication','false_positive','uncertain','ambiguous','low','none of their pizzas can be made without garlic and onions','La restriction alimentaire a été communiquée clairement, mais le client se plaint de ne pas comprendre sa justification. Distinguer refus de modification et déficit d’explication demeure ambigu.'),
    (10,'order_accuracy','false_positive','absent','confirmed_v13_error','high','Served what they call tiramisu ...befor the main corse...','Le dessert est arrivé avant le plat principal: ordre de service critiqué, mais aucun plat différent de la commande ni composant oublié. Coordination plutôt que order_accuracy.'),
    (13,'attentiveness','false_positive','absent','confirmed_v13_error','high','Staff should not automatically think you speak russian','L’hypothèse linguistique ne prouve pas un défaut de disponibilité, de réactivité ou de soin envers le client; communication est le thème directement étayé.'),
    (13,'friendly_staff','false_positive','absent','confirmed_v13_error','high','Staff should not automatically think you speak russian','Aucune impolitesse, froideur ou absence de gentillesse explicite n’est décrite. Ne pas transformer automatiquement une supposition linguistique en manque d’amabilité.'),
    (17,'professionalism','false_positive','both','ai_reference_correction','medium','The sea crab was not serve even we finish the other food','Le client apprécie d’abord le service, puis décrit une exécution défaillante pour le crabe livré tardivement après relance. La polarité both sur la qualité d’exécution du service est défendable.'),
    (21,'drinks','false_positive','absent','confirmed_v13_error','high','Wine list is not extensive but decent for an island','Cette phrase évalue la variété des vins proposés; aucune qualité gustative ou expérience de consommation de vin n’est évaluée. Absence de thème drinks.'),
    (21,'value','false_positive','absent','confirmed_v13_error','high','A little bit on the pricy side for Vietnam','L’avis signale des prix élevés, mais apprécie les plats et le lieu sans juger la valeur négativement. Prix élevé seul ne suffit pas à value négatif.'),
    (29,'drinks','false_positive','absent','confirmed_v13_error','high','they only brought out one drink instead of the two ordered','Boisson oubliée et glaçons manquants: erreurs d’exactitude de commande. Aucune opinion sur le goût ou la qualité de la boisson.'),
    (29,'wait_time','false_positive','negative','ai_reference_correction','medium','everything felt rushed','Le client critique explicitement un rythme de service pressé. La définition attente/rapidité inclut un jugement sur le rythme, même sans durée d’attente chiffrée; la référence initiale « absent » est trop stricte.')
),
source_set AS (
  SELECT s.* FROM public.analysis_jev_v13_sealed_inputs s
  WHERE s.id='aa2f5826-3550-4220-b46d-0c767af33c8d'::uuid
    AND s.configuration_id='themes_v13_targeted_recall_v1'
    AND s.blind_to_predictions
    AND s.dataset_sha256=encode(extensions.digest(convert_to(s.items::text,'UTF8'),'sha256'),'hex')
    AND s.reference_sha256=encode(extensions.digest(convert_to(s.reference::text,'UTF8'),'sha256'),'hex')
),
validated AS (
  SELECT r.id run_id,s.id source_id,(it.item->>'review_id')::uuid review_id,
   p.review_position,p.theme_key,p.error_kind,e.val->>'ai_reference' initial_ai_choice,
   rv.val->'v12'->p.theme_key->>'choice' v12_choice,
   rv.val->'v13'->p.theme_key->>'choice' v13_choice,
   p.reviewed_ai_choice,p.verdict,p.confidence,p.evidence_excerpt,p.rationale_fr,
   it.item->>'analysis_text_sha256' analysis_text_sha256,
   s.reference_sha256 sealed_reference_sha256
  FROM supplied p
  JOIN public.analysis_jev_v13_runs r ON r.id='c4ab65e4-dda2-4bcc-9fdb-bf084f85fc1d'::uuid AND r.source_kind='fresh_blind_ai' AND r.status='completed'
  JOIN source_set s ON s.id=r.source_id
  JOIN public.analysis_jev_v13_results result ON result.run_id=r.id
  JOIN LATERAL jsonb_array_elements(s.items) AS it(item) ON (it.item->>'position')::integer=p.review_position
  JOIN LATERAL jsonb_array_elements(result.comparison->'v13'->'errors') AS e(val)
  ON e.val->>'review_id'=it.item->>'review_id' AND e.val->>'theme_key'=p.theme_key
   AND e.val->>'kind'=p.error_kind AND e.val->>'polarity'='negative'
  JOIN LATERAL jsonb_array_elements(result.comparison->'reviews') AS rv(val)
   ON rv.val->>'review_id'=it.item->>'review_id'
  WHERE result.comparison->>'source_kind'='fresh_blind_ai'
    AND result.comparison->>'source_id'=s.id::text
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.reference) AS ref(val)
        WHERE ref.val->>'review_id'=it.item->>'review_id' AND ref.val->>'theme_key'=p.theme_key
          AND ref.val->>'choice'=e.val->>'ai_reference')
    AND rv.val->'v13'->p.theme_key->>'choice'=e.val->>'predicted'
    AND rv.val->>'analysis_text_sha256'=it.item->>'analysis_text_sha256'
    AND rv.val->>'analysis_text'=it.item->>'analysis_text'
    AND it.item->>'analysis_text_sha256'=encode(extensions.digest(convert_to(it.item->>'analysis_text','UTF8'),'sha256'),'hex')
    AND strpos(lower(it.item->>'analysis_text'),lower(p.evidence_excerpt))>0
    AND ((p.error_kind='false_negative' AND e.val->>'ai_reference' IN('negative','both') AND e.val->>'predicted' IN('absent','positive'))
      OR (p.error_kind='false_positive' AND e.val->>'ai_reference' IN('absent','positive') AND e.val->>'predicted' IN('negative','both')))
),
inserted AS (
 INSERT INTO public.analysis_jev_v13_fresh_posthoc_ai_audits
 (run_id,source_id,review_id,review_position,theme_key,error_kind,initial_ai_choice,v12_choice,v13_choice,
 reviewed_ai_choice,verdict,confidence,evidence_excerpt,rationale_fr,analysis_text_sha256,sealed_reference_sha256)
 SELECT run_id,source_id,review_id,review_position,theme_key,error_kind,initial_ai_choice,v12_choice,v13_choice,
 reviewed_ai_choice,verdict,confidence,evidence_excerpt,rationale_fr,analysis_text_sha256,sealed_reference_sha256
 FROM validated
 WHERE (SELECT count(*) FROM validated)=18
 AND (SELECT count(distinct review_position::text||':'||theme_key||':'||error_kind) FROM validated)=18
 ON CONFLICT(run_id,review_id,theme_key,error_kind) DO NOTHING
 RETURNING id
)
SELECT count(*) AS inserted_count FROM inserted;

DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.analysis_jev_v13_fresh_posthoc_ai_audits WHERE run_id='c4ab65e4-dda2-4bcc-9fdb-bf084f85fc1d'::uuid;
 IF n<>18 THEN RAISE EXCEPTION 'V13_POSTHOC_AUDIT_INCOMPLETE: % OF 18',n; END IF;
END; $$;