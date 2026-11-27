# Bibliothèque d’images de plats

HOME Reviews possède l’identité du plat et la file de génération. Helpeat lit l’illustration au prochain chargement normal de `helpeat_catalog()`. La lecture du catalogue et la recommandation ne déclenchent aucun travail d’image.

## Stockage et déclenchement

`private.dish_images` possède une ligne par `dish_id`. Elle conserve `image_status`, `image_url`, `image_storage_path`, `image_source`, `prompt_version`, `created_at`, `updated_at` et `last_error`. `generation_id`, `started_at` et `lease_until` identifient et protègent l’unique tentative courante. Une ligne absente ou `missing` indique une image à préparer. Le worker traite `pending`, puis enregistre `ready` ou `failed`.

Le point de déclenchement est la mise à jour de `published_id` ou `published_source_run` à la fin de `private.publish_menu_dish_ai`. L’inscription vérifie la classification publiée `street_food`, l’établissement actif et la spécialité active liée au `dish_id`. Un plat marqué comme variante (`parent_id` non nul) est exclu. Un échec de cette inscription laisse la publication du menu réussir et émet `DISH_IMAGE_ENQUEUE_FAILED`. L’installation n’inscrit aucun historique.

La clé primaire sur le plat déduplique les inscriptions. Le worker verrouille la configuration et consomme une autorisation avant de contacter le fournisseur. La liste des plats autorisés contient au plus trois identifiants et la file admet une seule tentative active à la fois. Une interruption après réservation n’autorise jamais un second appel. À la fin de la période de réservation, le worker vérifie si le fichier a été déposé sous le chemin prévu. S’il est absent, la tâche se termine avec une issue inconnue à examiner.

Le bucket `dish-images` diffuse uniquement les illustrations générées. Les écritures sont réservées au worker. Le fichier WebP est servi sous `<dish_id>/<generation_id>.webp` avec une URL immuable. La table et les RPC de travail ne sont pas accessibles aux comptes applicatifs.

Helpeat affiche « Illustration du plat (IA) » / « Ảnh minh họa món ăn (AI) ». Si l’image est absente ou échoue au chargement, Helpeat utilise la photo du restaurant étiquetée comme telle, puis l’icône de plat si la photo manque aussi. Le modèle, le classement et les données utilisés par le moteur de recommandation restent identiques.

## Préparer un pilote de trois plats

1. Appliquer `20261127130411_shared_main_dish_images.sql`, puis `20261127130412_helpeat_main_dish_images.sql` sur la base commune. La seconde migration complète le catalogue Helpeat `20261127005140_helpeat_live_home_catalog.sql` déjà en production. Déployer `process-dish-image-jobs` et le client Helpeat. Vérifier `launches_enabled=false`, la liste vide, le quota à zéro et le rendu de secours. À ce stade aucun appel fournisseur ne peut partir.
2. Après accord sur le pilote, vérifier la disponibilité du modèle avec la configuration serveur existante. Sélectionner trois identifiants distincts dans la requête ci-dessous. Des candidats observés en lecture seule sont Bánh căn, Bún bò et Cơm gà. Inspecter leur état avant l’inscription et retenir ceux dont l’image manque.
3. Inscrire chacun des identifiants retenus avec `select private.enqueue_dish_image('<UUID>'::uuid);`. Après vérification des lignes `pending`, renseigner `project_url = 'https://ihuztjkblywzjdruusdj.supabase.co'`, `allowed_dish_ids` avec les seuls UUID retenus, `remaining_launches` avec leur nombre et `launches_enabled = true` sur la ligne `singleton` de `private.dish_image_settings`. Le cron traite les demandes une à une.
4. Contrôler les états, la qualité visuelle et le chargement dans Helpeat. Remettre `launches_enabled = false` à la fin du pilote. Le compteur n’est jamais réapprovisionné automatiquement. Un appel déjà réservé peut finir. Les images publiées restent lisibles.

```sql
select d.id,d.name,i.image_status,i.last_error
from private.dish_names d
left join private.dish_images i on i.dish_id=d.id
where private.dish_image_eligible(d.id)
order by d.name;
```

Après examen d’une image existante, `private.regenerate_dish_image(dish_id, generation_id)` prépare une nouvelle version sur demande explicite. Le lancement utilise une nouvelle autorisation. L’ancienne URL reste publiée jusqu’au remplacement réussi. Les fichiers historiques ne sont pas supprimés pendant le pilote. Une issue inconnue doit être rapprochée avec le fournisseur et Storage avant toute nouvelle décision.

Pour revenir au catalogue précédent, arrêter les lancements, restaurer la définition de `private.helpeat_read_catalog()` sauvegardée au déploiement et republier si nécessaire le client Helpeat antérieur. Les menus, classifications et illustrations enregistrées demeurent en stockage.

## Coût estimé

`gpt-image-2.6-sunburst`, une image WebP de 1024 × 1024 par requête, qualité `low` et aucun fichier en entrée. Le calculateur OpenAI affiche environ 823 tokens image en sortie pour ce réglage, soit 0,02469 USD par image et 0,07407 USD pour trois. Prévoir **environ 0,08 USD** en incluant les courts prompts textuels, hors stockage et trafic. Le tarif observé n’est pas un coût mesuré. [Calculateur OpenAI](https://developers.openai.com/api/docs/guides/image-generation#calculating-costs) · [Tarification OpenAI](https://developers.openai.com/api/docs/pricing#images)
