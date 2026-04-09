# Releasing

## CLI (`orchid-code` on npm)

### Install / Update

```bash
npm install -g orchid-code
```

### How to release a new version

1. Make sure you are on `main` with a clean working tree.

2. Bump the version from inside the `cli/` directory:

   ```bash
   cd cli
   npm version patch   # or minor / major
   ```

   `npm version` reads the `tag-version-prefix` setting from `cli/.npmrc`,
   so it will:
   - update `cli/package.json` with the new version
   - create a git commit (`vX.Y.Z` message)
   - create a git tag with the `cli-v` prefix (e.g. `cli-v0.1.1`)

3. Push the commit **and** the tag:

   ```bash
   git push && git push --tags
   ```

4. CI takes it from here. The `publish-cli.yml` workflow triggers on any
   tag matching `cli-v*` and will:
   - install dependencies
   - run CLI tests
   - build the TypeScript source
   - verify package contents
   - publish to npm with provenance

### Tag format

All CLI release tags use the `cli-v` prefix (e.g. `cli-v0.1.0`,
`cli-v1.0.0`). This keeps CLI releases separate from any future tags for
other packages in the monorepo.

### Authentication: npm Trusted Publishers

CI uses [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers)
(OIDC) — no static NPM_TOKEN needed. GitHub Actions authenticates directly
with npm via short-lived tokens.

**First-time setup** (already done):
1. Publish the package once manually to create it on npm
2. Go to npmjs.com → `orchid-code` → Settings → Trusted Publishers
3. Add: repo `andressrg/orchid`, workflow `publish-cli.yml`

After that, all future publishes go through CI automatically.

### Troubleshooting

- **CI publish failed?** Check the Actions tab. If trusted publishers isn't
  configured, the OIDC auth will fail — follow the setup above.
- **Tag already exists?** Delete the tag locally and remotely, then re-tag
  and push.
