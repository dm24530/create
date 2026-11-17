# Canvas Cloud Storage

The Create stores project metadata in PostgreSQL and media objects in
the configured image storage backend (R2 in production).

## Object Layout

The final object key is the configured storage prefix plus the following
user-scoped path:

```text
canvas/users/{user_id}/projects/{project_id}/assets/{asset_id}{ext}
canvas/users/{user_id}/projects/{project_id}/thumbs/{asset_id}{ext}
```

For example, with the storage prefix `images/`, a source image is stored as:

```text
images/canvas/users/42/projects/project-a/assets/9f7c...png
```

The user ID always comes from the authenticated request. It is never accepted
from a client field. Project and asset reads, versions, uploads, and deletes are
also filtered by the authenticated user ID.

## Database Records

`canvas_projects` is the authoritative project index and uses a version column
for optimistic concurrency.

`canvas_assets` records the user, project, node, final object key, thumbnail
key, MIME type, byte size, dimensions, and SHA-256 digest. The object key in
this table includes the configured storage prefix and is the key used for
presigning and deletion.

## Recovery

To recover one user's canvas media, list only that user's prefix in R2:

```text
canvas/users/{user_id}/
```

Then correlate the object paths with:

```sql
SELECT id, project_id, node_id, kind, object_key, thumb_object_key
FROM canvas_assets
WHERE user_id = $1
ORDER BY project_id, created_at;
```

Deleting an asset or project removes the object before deleting its database
record. If object deletion fails, the database record is kept so the operation
can be retried without losing the key.
