# The Astro frontend, built once and served by the Node standalone adapter.
#
# Two stages, for one reason: `astro build` needs vitest, typescript and the
# Astro CLI, and none of them may end up in the image that faces the operator.
# The runtime stage therefore starts clean and installs production deps only.
#
# node:24 matches the Node this repository's builds and test runs are done on;
# pinning the major keeps a silent toolchain bump from becoming a build failure.

# --- build -----------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

# Copied before the sources so the dependency layer is reused whenever only
# application code changed. `npm ci` — not `install` — because the lockfile is
# committed and the build must be reproducible rather than merely satisfiable.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
# --omit=dev is what keeps vitest, typescript and the Astro CLI out of the
# shipped image; the build stage's node_modules is never copied across.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The Node adapter reads both. HOST especially: it binds 127.0.0.1 by default,
# which is unreachable from outside the container no matter what is published.
ENV HOST=0.0.0.0
ENV PORT=4321

# Astro's own default port, already written into frontend/README.md and the
# manual verification steps. Not renumbered to 8004 just to sit beside the
# Python services.
EXPOSE 4321

# `node` rather than root: an unprivileged user ships with the base image, and
# serving static assets needs nothing more.
USER node

CMD ["node", "dist/server/entry.mjs"]
