# Livraison gratuite — Contrôle Luna V2

Jeu scellé : `c8b3eee7-2554-43d9-a16b-5e12413af793`.
Version : `luna-negative-focused-v2`.
SHA256 du snapshot : `6e464e2f0fa13ae1f83168b65a04e3de3e396fc0c1150d08ba71e8e30b008189`.
Configuration : `luna-negative-focused-v2-choice-v1`, SHA256 `beb203a8c28cd68be8e556807d9b51cd096083d69734ed0692732440398bef4f`.
Sélecteur/règles : SHA256 `a6e31fd67ddde18e17746cd6fc9ab7b5cb21658ef12099e9f225b9ce3c8008c2`.

## Inventaire réel

122 tables historiques examinées, y compris UUID dans tableaux et clés JSON ; 958 avis déjà référencés exclus. Recherche complémentaire dans 39 documents historiques : aucun candidat restant retrouvé. 2 743 avis avec original restent hors de ces historiques ; 524 disposent d'une source anglaise, dont 19 exclus par le contrôle conservateur de langue. 505 anglais admissibles. Parmi eux : 4 candidats 1–4 étoiles, 16 candidats 5 étoiles potentiellement mixtes et 278 contrôles positifs détectés par règles. Les autres n'ont pas de proposition thématique exploitable dans ce sélecteur.

La cible initiale de huit avis 1–4 étoiles n'est pas disponible après exclusion complète. Le jeu reste donc incomplet : **28 avis**, pas 32. Aucun avis ancien réutilisé pour combler le manque.

| Groupe | Disponibles | Retenus | Cible |
|---|---:|---:|---:|
| 1–4 étoiles | 4 | 4 | 8 |
| 5 étoiles potentiellement mixtes | 16 | 12 | 12 |
| 5 étoiles contrôles positifs | 278 | 12 | 12 |

Étoiles retenues : **1 / 0 / 2 / 1 / 24**, dans l'ordre 1★ à 5★.
Restaurants : 13. Xóm Mới Garden (4), The Home Pizza Phu Quoc (3), Green Home Restaurant (2), Artisan Cafe & Eatery (2), Làng Ngon Corner (2), Cilantro Restaurant 2 (2), The Home Pizza Nha Trang (2), Mai Hương (2), Green Home Dining (2), K.HOUSE (2), Luong Son Cang (2), Shabu Ssam (2), Nhà hàng Nha Trang xưa (1).

**32 associations : 21 négatives proposées et 11 positives proposées.** Ce ne sont ni des résultats JEV ni des références GPT-6. La qualification « potentiellement mixte » est un repérage lexical, pas un jugement validé.

| Thème | Positive proposée | Négative proposée |
|---|---:|---:|
| food_quality | 8 | 4 |
| price_level | 0 | 4 |
| portions | 1 | 2 |
| cooking | 0 | 2 |
| billing | 0 | 2 |
| attentiveness | 0 | 2 |
| comfort | 0 | 2 |
| value | 0 | 1 |
| atmosphere | 1 | 0 |
| professionalism | 1 | 0 |
| communication | 0 | 1 |
| cleanliness | 0 | 1 |

## Appels et coût futur

28 requêtes futures regroupées pour 32 questions. Les quatre avis 1–4 étoiles possèdent deux questions partageant le même texte ; les autres une. Aucun appel effectué.

19 000 tokens d'entrée **estimés**, soit **0,0019000 USD** au tarif standard enregistré de 0,10 USD / million. Sans regroupement : 20 268 tokens estimés, 0,0020268 USD. Différence estimative de 1 268 tokens et 0,0001268 USD ; ce n'est pas une économie facturée démontrée. Suppléments régionaux/long contexte non garantis. Usage et facture réels inconnus.

## Références et sécurité

Export aveugle de 32 entrées disponible dans l'écran, exactement quatre champs par association. **Zéro référence et zéro scellement de références** : à annoter séparément dans ChatGPT. Les références futures restent IA, jamais Gold humain.

Cinq tables nouvelles, RLS organisationnelle, droits owner/admin/manager, résultats de préparation immuables, sauvegarde transactionnelle/idempotente. Aucun worker, run payant, cron ni autorisation de dépense ajouté. Les actions de lancement/retry sont refusées par le nouvel endpoint. Les anciens tests Luna restent séparés.

Vérification après sauvegarde : empreinte correcte, 28 avis uniques, 32 associations, zéro chevauchement. Les empreintes de **124 tables historiques et sources existantes sont inchangées**, y compris reviews, traductions, analyses, audits, rapports, configurations et anciens runs.

## Tests

- 1 545 tests unitaires réussis sur 154 fichiers. Premier passage sous charge : un délai de lecture dans un test d'écran ancien ; test isolé puis deuxième suite complète réussis, sans modification du code historique.
- 2 tests Deno, `--deny-net`, et contrôles Deno check/lint.
- SQL réel avec rollback : RLS, accès hors organisation refusé, owner autorisé, ACL, immutabilité et idempotence.
- 8 tests mobiles FR/VI : 360/390/430 px et iPad 768×1024, export, reprise, zéro requête fournisseur, zéro débordement.
- ESLint et build réussis.
- Endpoint Supabase `luna-negative-v2` déployé ; accès sans authentification : HTTP 401.

Accès : Plus / Thêm → Test Jev → OpenAI Decisions → **Contrôle Luna V2 — Critiques**.
Luna reste désactivée. Aucun appel JEV, Luna, Sol, Responses, OpenAI API ou Apify. Aucun changement de production analytique.
