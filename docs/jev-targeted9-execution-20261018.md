# Exécution unique du diagnostic JEV Chill Thái (9 avis)

Protocole immuable : `3f6ab86c-7557-431b-9389-4fa85054a00e`.
Configuration figée : `v12_economy_audit_boundaries_v2_1pass_v1`.
Les sources, les 225 critères et les instructions restent ceux de la préparation.

## Adaptation minimale de l'exécuteur

`process-jls-restaurant` reçoit un mode explicite `jev_targeted9`, protégé par
le jeton serveur existant. Aucun scan automatique ne lance ce benchmark.
Le module partagé `jev-targeted9-worker` réutilise le client TypeSafe natif
(`maxAttempts: 1`), la résolution des 25 réponses et les seuils économiques.
Il ne charge aucun client OpenAI et n'appelle jamais la vérification des modèles.

La délégation administrative passe par `authorize_jev_targeted9`, sous rôle
serveur authentifié. Le texte exact du GO, son SHA256, son périmètre, la provenance
du code et une expiration de 24 heures sont enregistrés séparément du protocole.
La présence d'une exécution existante interdit une seconde exécution.

`reserve_jev_targeted9` verrouille l'exécution et insère une réservation unique
avant chaque envoi. Un conflit retourne NULL, jamais l'ancienne réservation.
Les avis sont traités dans l'ordre. Un réveil concurrent ou une interruption
ne peut pas remettre une tentative consommée en attente. Un réveil serveur
suivant ne concerne que l'avis suivant, après sauvegarde du résultat précédent.
Une réservation sans réponse confirmée arrête la progression sans réenvoi.

## Archives et lecture

Tous les nouveaux objets sont dans `public.analysis_jls_snapshot_preparations`,
avec les mêmes protections d'immuabilité et RLS par organisation que les sources.
Le `protocol_id` SQL est le parent historique de stockage, et ne désigne pas
une autorisation de rouvrir ce parent ou son run. Le véritable protocole ciblé
figure dans `body.targeted_protocol_id`.

| kind | contenu |
|---|---|
| `jev_targeted9_execution_v1` | identité de l'exécution et consentement limité |
| `jev_targeted9_attempt_01` … `_09` | réservation durable consommée, empreintes de requête |
| `jev_targeted9_receipt_01` … `_09` | réponse HTTP brute complète avant parsing, SHA256, durée, erreur |
| `jev_targeted9_result_01` … `_09` | résultats natifs et probabilités des 25 thèmes, décisions après seuils distinctes, modèle servi, usage |
| `jev_targeted9_summary_v1` | identifiants des résultats et compteurs techniques, sans score qualitatif |

Les réponses invalides restent conservées. Les résultats de ce diagnostic ne
remplacent aucun cache ni résultat historique. Aucun rapport n'est généré.
L'audit qualitatif et l'interprétation des critères restent au chat d'analyse.

```sql
select id, kind, sha256, created_at, body
from public.analysis_jls_snapshot_preparations
where body->>'targeted_protocol_id' = '3f6ab86c-7557-431b-9389-4fa85054a00e'
order by kind;
```

## Vérifications sans fournisseur

- Tests Vitest : neuf requêtes synthétiques, 225 classifications conservées,
  concurrence, consentement invalide/expiré, erreurs HTTP/réseau, réponse invalide,
  usage manquant et échec de stockage, sans retry.
- Deno : parcours complet sur les neuf textes figés, transport injecté et réseau interdit.
- SQL : transaction annulée, réservation unique, ordre, plafond neuf, absence de
  reprise après issue incertaine, immuabilité, privilèges serveur et isolation RLS.
- Aucun test, migration, build ou déploiement ne déclenche le fournisseur.

L'exécution payante doit être une opération explicite distincte après ces contrôles.
