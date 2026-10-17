# Chill Thái — compte rendu technique du 17 octobre 2026

Protocole `52964d84-f0a0-411c-8c64-8fbc69e00913` ; run `3294262e-8946-41c0-b9c4-463a4fe27e74` ; opération Sol `6e9bd72c-108d-4275-bea6-c5ee3c45ea19`.

Périmètre historique exact : 100 avis, dont 80 avec texte anglais et 20 sans texte pour les statistiques. Aucun import ni changement de traduction. Aucun ancien classement utilisé comme résultat JEV.

| Étape | Appels | Tokens entrée | Tokens sortie | Latences fournisseur cumulées |
|---|---:|---:|---:|---:|
| JEV V12 économique, jev-1.13.0 | 80 | 676 184 | 90 126 | 24 168 ms |
| Luna, gpt-6-luna | 28 | 21 851 | 0 | 39 982 ms |
| Sol, gpt-6.1-sol | 1 | 18 003 | 5 353 | 76 847 ms |

Les latences cumulées ne représentent pas la durée totale du pipeline : réservations, files et préparations gratuites sont séparées. Période JEV : 04:58:13–05:01:55 UTC ; Luna : 05:03:04–05:03:45 UTC. Aucun retry fournisseur. Aucun appel Apify. Zéro analyse JEV préexistante réutilisée ; les 80 nouveaux caches ont ensuite été utilisés pour l'agrégation. Le champ statistique `reused_analyses:80` décrit cette lecture après analyse, pas 80 économies d'appels pendant cette exécution.

Sélection réelle : 32 preuves / 28 avis distincts. Luna : 26 ACCEPTED, 6 UNCERTAIN, 0 REJECTED. Aucune preuve incertaine transmise à Sol comme preuve acceptée. Contrôle de suffisance passé. Requête Sol finale : 69 745 octets, 21 236 tokens locaux avec marge, plafond 32 768, sortie réservée 9 500. Ce comptage local est distinct de l'usage effectivement rapporté.

## Blocage de sauvegarde

Sol a répondu HTTP 200. La réception brute a été sauvegardée avant validation. La garde `jls_restaurant_state_guard` n'autorise la transition d'une tâche Sol `received` vers son statut final que pour `jls-restaurant-sol-ready-vi-v1`, pas pour `jls-historical-snapshot-v2-vi-v1`. La sauvegarde finale a donc levé `JLS_NO_RETRY`, exposé par le worker sous `JLS_READY_RPC_FINISH_JLS_SOL_READY_P0001`.

Cette transition SQL n'avait pas été couverte par le transport simulé de la préparation. Le run et l'opération restent `blocked`. Ils ne sont pas réouverts ; leur réponse et leur autorisation ne sont pas réutilisées pour un appel.

## Revalidation séparée, sans réseau fournisseur

La réponse native inchangée a été rejouée localement avec le plan figé, les décisions Luna réelles et le validateur V2 existant. Aucun texte Sol ni verdict Luna n'a été corrigé.

- Réponse Sol : `resp_0d37621aaf627b17016ad30228709487d081e5fe8f30076742`.
- SHA256 du reçu : `8e7addb2e4fc20a535269d3c4875a4eb0e3677b30633ddb972a7b65e27cfa557`.
- Revalidation immuable : `fd8da97a-4cb8-4146-aab3-1b2cc9127a72`.
- SHA256 de la revalidation : `9a8f11b2809a3dafba39471a9044a00ed90f4f435ab125a978bf13d45a5de6b8`.
- SHA256 du résultat revalidé : `a0c4504190b1f75f06c6a82e9ca77a950958d7546125518b321b6d381bd11469`.
- Validateur : `jls-observation-action-statistics-validation-v2`, code `8aa5079`.

Résultat technique : `needs_review`. Les quatre axes, aspects et conclusion passent. Quatre recommandations proposées ; deux admissibles à l'affichage, deux masquées avec `PRECISE_ACTION_REQUIRES_REVIEW`. Ces contrôles ne constituent pas un audit qualitatif ou une validation humaine.

Une lecture expérimentale séparée permet de consulter la revalidation dans HOME Reviews, en conservant le blocage du run d'origine visible. L'API vérifie les empreintes du reçu, de la réponse native, du résultat revalidé et de la requête source, ainsi que l'organisation, le protocole et le run. Les écritures et lectures restent sous les protections existantes. Aucun worker, seuil, prompt, plafond ou consentement n'est modifié pour cette restitution.

L'export d'audit comprend l'ancien rapport, le nouveau texte Sol, les caches et réponses intermédiaires, les preuves et décisions Luna, la revalidation, les recommandations masquées et leurs motifs. L'audit qualitatif est réservé au chat d'analyse. La garde SQL devra être corrigée et testée pour une future exécution ; cette livraison ne force pas la réussite du run bloqué.
