FROM node:20-alpine AS base
# Opt out of Next.js's own anonymous usage telemetry (the "Next.js now collects
# completely anonymous telemetry" notice during `next build`). This is unrelated
# to the app's OpenTelemetry/Snowplow instrumentation, which is untouched.
# Set here so every stage that inherits from base (development, builder) has it.
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json* ./

FROM base AS development
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS builder
# NEXT_PUBLIC_* vars are baked into the client bundle at build time.
# Pass them as build args so the production image gets the right values.
ARG NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL=http://localhost:9090
ARG NEXT_PUBLIC_SNOWPLOW_APP_ID=clickshop
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG NEXT_PUBLIC_OTEL_COLLECTOR_URL=http://localhost:4318
ARG CADDY_DOMAIN=localhost
# Read by next.config.js at build time: rewrites are compiled into the routes
# manifest and are not evaluated again by the production server.
ARG CLOUDFRONT_DOMAIN=
ENV NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL=$NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL \
    NEXT_PUBLIC_SNOWPLOW_APP_ID=$NEXT_PUBLIC_SNOWPLOW_APP_ID \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_OTEL_COLLECTOR_URL=$NEXT_PUBLIC_OTEL_COLLECTOR_URL \
    CADDY_DOMAIN=$CADDY_DOMAIN \
    CLOUDFRONT_DOMAIN=$CLOUDFRONT_DOMAIN
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
# Not inherited from base (this stage starts from a fresh image), so repeat it.
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
