# Frontend Builder
FROM node:24-alpine AS frontend
WORKDIR /app

# Pin pnpm to the version package.json declares, and turn OFF pnpm 10's
# self-management. Left on, `pnpm install` tries to install its own
# @pnpm/exe.<platform> binary and then rejects it because that package is
# not in pnpm-lock.yaml, which broke the build once the unpinned
# `npm install -g pnpm` drifted onto pnpm 10.
RUN npm install -g pnpm@10.28.0 \
    && pnpm config set manage-package-manager-versions false \
    && pnpm config set store-dir /pnpm-store

# Dependencies BEFORE source. This layer is keyed on the manifests alone, so
# editing a component no longer re-runs the install - which it did on every
# build when the Dockerfile copied the whole tree first (92s per source-only
# rebuild, all of it re-installing unchanged dependencies).
# .npmrc carries engine-strict=true and must be present for the install.
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile

COPY . .
# SvelteKit's build needs more than Node's default ~2GB old-space; without
# this it dies with "Ineffective mark-compacts near heap limit" (exit 134).
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm run build && pnpm prune --prod

# Final Image
FROM node:24-alpine
LABEL name="Riven" \
    description="Riven Media Server: Frontend" \
    url="https://github.com/rivenmedia/riven-frontend"

# Set working directory
WORKDIR /riven

# Copy frontend build from the previous stage
COPY --from=frontend  /app/build /riven/build
COPY --from=frontend  /app/node_modules /riven/node_modules
COPY --from=frontend  /app/package.json /riven/package.json
COPY drizzle /riven/drizzle

# Add the entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "/riven/build"]
