// Runbooks and past incidents loaded into Vectorize by POST /admin/seed.

export interface SeedDoc {
  slug: string;
  kind: "runbook" | "incident";
  service: string;
  title: string;
  text: string;
}

export const SEED_DOCS: SeedDoc[] = [
  {
    slug: "high-5xx-rate",
    kind: "runbook",
    service: "api-gateway",
    title: "Runbook: elevated HTTP 5xx error rate",
    text: [
      "Symptoms: 5xx ratio above 2% for 5 minutes on any public route.",
      "1. Check the deploy log: if a release went out in the last 30 minutes, roll it back first and investigate after.",
      "2. Break down errors by upstream in the gateway dashboard to find the failing service.",
      "3. Check upstream health checks and pod readiness; look for CrashLoopBackOff or OOMKilled.",
      "4. If one upstream is failing, shed its traffic or enable the static degraded-mode page.",
    ].join("\n"),
  },
  {
    slug: "crashloopbackoff",
    kind: "runbook",
    service: "checkout-api",
    title: "Runbook: pod in CrashLoopBackOff",
    text: [
      "1. kubectl describe pod <pod> and kubectl logs <pod> --previous to see the last crash.",
      "2. Exit code 137 means OOMKilled: raise memory limits or find the leak; see the OOM runbook.",
      "3. Config or secret errors at startup usually follow a config change: diff the ConfigMap and revert.",
      "4. If the new image is bad, roll back the Deployment: kubectl rollout undo deploy/<name>.",
    ].join("\n"),
  },
  {
    slug: "db-pool-exhaustion",
    kind: "runbook",
    service: "payments",
    title: "Runbook: database connection pool exhausted",
    text: [
      "Symptoms: 'timeout acquiring connection', rising p99, request queueing.",
      "1. Check active vs max connections on the primary and look for long-running queries (pg_stat_activity).",
      "2. Kill queries running longer than 5 minutes that are not migrations.",
      "3. Look for a recent traffic spike or a retry storm from a client multiplying load.",
      "4. Temporarily scale replicas down if total connections exceed the database limit; do not raise pool size blindly.",
    ].join("\n"),
  },
  {
    slug: "high-p99-latency",
    kind: "runbook",
    service: "search",
    title: "Runbook: high p99 latency",
    text: [
      "1. Compare p50 vs p99: if only p99 moved, suspect a slow dependency or GC pauses; if both moved, suspect saturation.",
      "2. Check CPU throttling and pod count; scale out if CPU is pinned.",
      "3. Check cache hit ratio (Redis) and downstream latency panels.",
      "4. Correlate with deploys and batch jobs started in the same window.",
    ].join("\n"),
  },
  {
    slug: "disk-full",
    kind: "runbook",
    service: "inventory",
    title: "Runbook: disk usage above 90%",
    text: [
      "1. Identify the volume and largest directories (du -sh /var/* | sort -h).",
      "2. Common culprits: unrotated logs, core dumps, WAL or Kafka segments not being cleaned.",
      "3. Free space safely (rotate/compress logs) before expanding the volume.",
      "4. If the volume is a database, expand the PVC rather than deleting data files.",
    ].join("\n"),
  },
  {
    slug: "cert-expiry",
    kind: "runbook",
    service: "api-gateway",
    title: "Runbook: TLS certificate expiring",
    text: [
      "Alert fires 14 days before expiry.",
      "1. Check cert-manager Certificate status and recent challenge failures.",
      "2. DNS-01 failures usually mean the DNS API token expired or lost permissions.",
      "3. Force renewal with cmctl renew <cert> once the cause is fixed and confirm the new notAfter date.",
    ].join("\n"),
  },
  {
    slug: "kafka-consumer-lag",
    kind: "runbook",
    service: "inventory",
    title: "Runbook: Kafka consumer lag growing",
    text: [
      "1. Check whether lag is on all partitions (throughput problem) or a few (stuck consumer or poison message).",
      "2. For a stuck partition, find the offset in consumer logs; skip or dead-letter the poison message.",
      "3. For general lag, scale consumers up to the partition count and check downstream write latency.",
      "4. Confirm no rebalance loop: frequent 'rebalancing' log lines indicate session timeouts.",
    ].join("\n"),
  },
  {
    slug: "auth-signing-key-rotation",
    kind: "runbook",
    service: "auth",
    title: "Runbook: auth token signing key rotation failures",
    text: [
      "Symptoms: spike in 401s across services, 'kid not found' or signature verification errors.",
      "1. Check that the JWKS endpoint serves both the old and new key during rotation.",
      "2. If clients cache JWKS, confirm the new key was published before the signer switched.",
      "3. Roll the signer back to the previous key if verification errors exceed 1% of requests.",
    ].join("\n"),
  },
  {
    slug: "inc-checkout-bad-deploy",
    kind: "incident",
    service: "checkout-api",
    title: "Past incident: checkout 5xx after bad deploy",
    text: [
      "Checkout error rate jumped to 35% two minutes after release 2024.31.2.",
      "Cause: a null-handling bug in the new promo-code path threw on carts without a promo.",
      "Fix: rolled back the deployment; errors cleared within 3 minutes.",
      "Follow-up: canary releases for checkout, contract test for empty promo field.",
    ].join("\n"),
  },
  {
    slug: "inc-payments-provider-timeout",
    kind: "incident",
    service: "payments",
    title: "Past incident: payment provider timeouts",
    text: [
      "Payments p99 latency rose to 9s and authorisations failed intermittently.",
      "Cause: upstream card processor degraded in one region; our client had no timeout so threads piled up.",
      "Fix: enabled the circuit breaker and failed over to the secondary provider.",
      "Follow-up: 3s client timeout, breaker opens at 20% errors over 30s.",
    ].join("\n"),
  },
  {
    slug: "inc-search-redis-eviction",
    kind: "incident",
    service: "search",
    title: "Past incident: search Redis eviction storm",
    text: [
      "Search latency tripled and DB CPU hit 100%.",
      "Cause: Redis hit maxmemory after a new facet cache was added; LRU evictions caused a cache miss stampede.",
      "Fix: increased Redis memory, added request coalescing for cache misses.",
      "Follow-up: alert on evicted_keys rate, TTLs on facet keys.",
    ].join("\n"),
  },
  {
    slug: "inc-inventory-oom-batch",
    kind: "incident",
    service: "inventory",
    title: "Past incident: inventory OOMKilled after nightly batch",
    text: [
      "Inventory pods restarted repeatedly around 02:00 UTC with exit code 137.",
      "Cause: the nightly reconciliation job loaded the full SKU table into memory.",
      "Fix: paginated the job and moved it to a dedicated worker deployment.",
      "Follow-up: memory limit alerts at 85%, batch jobs isolated from serving pods.",
    ].join("\n"),
  },
  {
    slug: "inc-gateway-ratelimit-misconfig",
    kind: "incident",
    service: "api-gateway",
    title: "Past incident: gateway rate limit misconfiguration",
    text: [
      "Mobile clients received 429s at 10% of normal traffic.",
      "Cause: a config change set the per-IP limit in requests per hour instead of per minute; carrier NAT concentrated users behind few IPs.",
      "Fix: reverted the config; limits keyed on API token instead of IP.",
      "Follow-up: config validation for rate-limit units, 429 ratio alert.",
    ].join("\n"),
  },
];
