# Benchmark ciblé des frontières JEV — 9 avis

Protocole scellé : `3f6ab86c-7557-431b-9389-4fa85054a00e`.
Version : `jev-audit-boundaries-targeted9-v1`.
Table : `public.analysis_jls_snapshot_preparations`.
Kind : `jev_audit_boundaries_targeted9_v1`.
Le champ protocol_id de cette table est uniquement le lien vers le protocole source historique ; l’identifiant ci-dessus désigne le nouveau paquet préparé. Il ne rouvre aucun run.

- Code de classification figé : `13cff76ef38fedaf964ca96515710e72a8b874d2`, PR #20.
- Configuration : `v12_economy_audit_boundaries_v2_1pass_v1`.
- SHA256 configuration : `292384806354e610ab60588f803516e99ae5a0db6b7a47fd2cd1f7832a9305da`.
- SHA256 instructions : `d1bf606df9a53c0b8ad2afcec223e68b081310f1305e552ed9656f40ff7646d1`.
- SHA256 seuils : `e0c177cb371f523caeaad6add147b94cb318c7ec08df8961f864cb487a549de6` (valeurs V12 inchangées).
- SHA256 protocole : `8fc0d34ca7bd79c2fa0fa2306c03cc0d2607bb4da61b22d17d7ebc17835528b4`.
- SHA256 critères : `81e84e49621166e0b0aa54be9671cca1b598b549ac44ec3e2b1bc4949009e814`.
- SHA256 sources sélectionnées : `383cdc55869bc17dd05daf273660df4c4ae18bc224ce6888f5aea95d18b9309a`.
- SHA256 manifeste des requêtes : `e8c766cdfcca3aef22b9e87e4ce20fd20794e731557040c2377f915660719382`.

## Périmètre figé

Tous les avis proviennent du snapshot de 100 avis du rapport historique `39556285-21ee-4962-9892-da3b4f0e8ca3`, organisation `93228bbb-6397-41e3-b8be-21ee7060eda7`, établissement `a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8`.
Les textes originaux, anglais, provenances et empreintes sont conservés sans nouvelle traduction.
La requête JEV ne reçoit que review_alias, analysis_text anglais et les 25 questions.
Les étoiles, textes originaux, attentes et anciens résultats ne sont pas ajoutés au payload.

| Cas | Review ID | Type |
|---|---|---|
| Bord de marmite | `a3acf747-e095-49b9-a49c-9b84f0bce7a2` | Correction ciblée |
| Trop de plats commandés | `4b5dae79-7eea-479a-b616-51904c71d939` | Correction ciblée |
| Demande de réduction du piment | `6fa38e77-27fa-43e5-8c46-68fe636071ce` | Correction ciblée |
| Publicité midi pendant dîner | `9ce752cf-40e0-41bd-8ef3-788f47973bc4` | Correction ciblée |
| Stationnement peu clair | `20b36393-0319-46b3-af90-057ce4e8b254` | Correction ciblée |
| Good service exact | `b11e77a1-6249-4ca8-b279-33832681d957` | Correction ciblée |
| Vraie petite portion | `a5864271-a7df-4c9e-8cb7-d374f98602ec` | Témoin inchangé |
| Attention concrète | `cb063ce7-d700-46ed-bdc8-89f5962e2135` | Témoin inchangé |
| Organisation décrite | `ef5fb3ab-785e-4971-b64a-30a671158598` | Témoin inchangé |

Le témoin de coordination décrit un problème d’organisation et de prise en charge ; il s’agit d’un témoin négatif, et non d’une preuve de coordination positive. L’expression anglaise « pushing each other » ne doit pas être transformée en agression physique ; son ambiguïté est figée avec la source vietnamienne.

## Critères et comparaison

Le fichier `jev-boundaries-targeted9-criteria-20261018.json` contient 225 cellules, soit 25 thèmes pour chacun des 9 avis, avec attentes fermes et lectures à réexaminer. Ces critères prospectifs ne sont ni un Gold humain, ni une nouvelle annotation GPT-6 indépendante.
Les lectures ambiguës (notamment transparence du stationnement, certaines appréciations très brèves du service et rattachements secondaires) sont isolées des attentes fermes. Une sortie différente nécessite l’examen du chat ; elle n’est ni masquée ni déclarée automatiquement correcte.
Les 9 anciens caches sont référencés par identifiant et SHA256, comme comparaison descriptive uniquement. Ils ne sont pas réétiquetés comme résultats de la nouvelle configuration.
Les contrôles imposent la présence des 25 réponses, les probabilités natives et les décisions après seuils conservées séparément, y compris pour les thèmes non ciblés.
L’audit qualitatif des futures réponses appartient au chat d’analyse. Aucun score de généralisation ne sera déduit de ces cas déjà connus.

## Limites d’exécution future

9 avis distincts, 225 questions, **9 requêtes JEV maximum**. Modèle demandé : jev-latest. Un passage par avis ; concurrence 1 ; client maxAttempts=1 ; aucune répétition, correction automatique ou API de secours.
Aucun appel de découverte du modèle : le modèle effectivement servi sera enregistré depuis la réponse et tout changement par rapport au modèle historique sera signalé.
Avant envoi : vérification du paquet, sources, organisation, configuration et empreintes, puis réservation durable et atomique sous une nouvelle autorisation authentifiée. Une tentative perdue ou incertaine est consommée et ne peut pas être renvoyée.
Réponse brute à conserver avant parsing ; sortie invalide/incomplète conservée, sans retry. Aucune écriture sur les résultats historiques ni recalcul de leurs fréquences.
**Luna 0, Sol 0, Apify 0, nouveau rapport 0.** Aucune estimation monétaire.

Cette préparation ne crée aucun consentement, run payant ou tâche fournisseur. Elle n’active pas la variante en production. Le paquet et les lectures historiques restent protégés par RLS ; écritures réservées au serveur, audit immuable et sauvegarde idempotente via le mécanisme existant.

## GO à donner ultérieurement

Ce texte est un modèle de future autorisation, pas un consentement d’exécution enregistré.

```text
GO — J’autorise Codex à exécuter une seule fois le benchmark ciblé Chill Thái selon le protocole 3f6ab86c-7557-431b-9389-4fa85054a00e.

Utiliser uniquement les 9 avis figés et la configuration v12_economy_audit_boundaries_v2_1pass_v1 issue du commit 13cff76.
Vérifier les 25 thèmes pour chaque avis : maximum 9 appels JEV, un passage par avis, sans retry ni appel de contrôle du modèle supplémentaire.

Aucun appel Luna, Sol ou Apify. Aucun nouveau rapport.
Conserver les sources, critères, ambiguïtés et résultats historiques inchangés.
Enregistrer les réponses natives, probabilités, modèles servis, tokens, durées et erreurs pour l’audit dans notre chat.
Une tentative incertaine ne doit jamais être renvoyée.
```

