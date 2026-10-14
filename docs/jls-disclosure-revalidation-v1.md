# Revalidation de l’annonce des frais

Validateur : `jls-prioritized-disclosure-v1.1`.
Revalidation : `jls-fee-disclosure-revalidation-v1`.
Format Sol inchangé : `jls-prioritized-recommendations-v1`.

La règle précédente reconnaissait `didn't see`, mais pas `haven't seen a note`.
Les apostrophes typographiques sont normalisées uniquement dans le contrôle ;
les citations originales et leurs SHA256 restent inchangés.
La règle reconnaît des plaintes explicites de non-annonce liées aux frais,
avec abstention pour questions, hypothèses, incertitudes et annonces contradictoires.
Elle ne constitue ni une compréhension sémantique complète ni une preuve juridique.
Un défaut d’annonce ne prouve toujours pas une erreur de calcul.

Le validateur ancien reste disponible sous `jls-prioritized-disclosure-v1` pour
vérifier le résultat historique. Le getter contrôle séparément l’original puis
la revalidation avant d’afficher cette dernière. L’original reste consultable.
Les futurs résultats portent explicitement la version du validateur utilisé.

`scripts/revalidate-jls-disclosure.ts` fonctionne avec les données exportées,
sans permission réseau Deno et avec `fetch` bloqué. Il contrôle la réponse source,
reproduit la validation ancienne, rejoue tous les contrôles et garantit que seuls
les statuts, motifs et visibilité des recommandations peuvent changer.
La provenance comprend le commit et les SHA256 des trois modules de contrôle.

Le stockage réutilise `analysis_jls_prioritized_events` (append-only, RLS par
organisation, écritures serveur), avec l’action versionnée
`prioritized_fee_disclosure_revalidated_v1` et unicité par run/action.
`save_jls_pri_revalidation` vérifie les sources, les hashes et l’absence de
modification du contenu. Une répétition identique retourne le même événement ;
un contenu différent est refusé. Aucun run, consentement, tâche ou wake n’est créé.

Run concerné : `ba97b7d7-504a-4ebe-bc8f-94dca95f5f7e`.
Le statut historique `needs_review`, la réponse Sol et le coût enregistré
`0,085492 USD` restent immuables. La revalidation est une conformité technique
expérimentale ; elle n’est pas une validation humaine indépendante.
