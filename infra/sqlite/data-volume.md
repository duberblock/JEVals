# SQLite data volume

JEVals uses SQLite and defaults to `sqlite:///./jevals.db` in local API
development.

## Development

- Local development uses the API working-directory file `apps/api/jevals.db`.
- Docker Compose mounts `./data` into the API container at `/data` and points
  `DATABASE_URL` at `sqlite:////data/jevals.db`.

## Persistence invariant

Deployments MUST persist the SQLite database outside the container/image
lifecycle — the compose stack does it with the `./data` bind mount. Whatever
 fronts your deployment (a bind mount, a named volume, a managed disk):

- point `DATABASE_URL` at the persisted path, and
- never store the database in an image layer or any path lost on redeploy.

Execution history lives here; losing the volume means losing the history.
