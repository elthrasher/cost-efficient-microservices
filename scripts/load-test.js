import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

// Custom metrics
const orderDuration = new Trend("order_duration", true);

// Ramp from 0 to ~1000+ requests quickly to demonstrate cold-start scaling
export const options = {
  stages: [
    { duration: "5s", target: 50 }, // warm up
    { duration: "10s", target: 200 }, // ramp to 200 concurrent
    { duration: "15s", target: 200 }, // hold at 200 (generates ~1000+ requests)
    { duration: "5s", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<5000"], // 95th percentile under 5s
    http_req_failed: ["rate<0.01"], // less than 1% HTTP failures (5xx)
  },
};

const API_URL = __ENV.API_URL;
if (!API_URL) {
  throw new Error("API_URL environment variable is required");
}

// Load test products — high inventory, won't interfere with scenario tests
const PRODUCTS = ["load-1", "load-2", "load-3"];
const METHODS = ["stripe", "paypal", "applepay"];

export default function () {
  const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  const method = METHODS[Math.floor(Math.random() * METHODS.length)];
  const customerId = `load-test-${__VU}-${__ITER}`;

  const payload = JSON.stringify({
    customerId,
    paymentMethod: method,
    items: [{ productId: product, quantity: 1 }],
  });

  const res = http.post(`${API_URL}orders`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  const success = res.status === 200;
  check(res, {
    "status is 200": () => success,
  });

  if (success) {
    const body = JSON.parse(res.body);
    check(body, {
      "order succeeded": (b) => b.status === "success",
    });
  }

  orderDuration.add(res.timings.duration);
  sleep(0.1);
}

export function handleSummary(data) {
  const reqs = data.metrics.http_reqs?.values?.count ?? 0;
  const dur = data.metrics.http_req_duration?.values ?? {};
  const failed = data.metrics.http_req_failed?.values?.rate ?? 0;

  const summary = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Load Test Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total requests:  ${reqs}
  Failure rate:    ${(failed * 100).toFixed(1)}%
  Latency avg:     ${(dur["avg"] ?? 0).toFixed(0)}ms
  Latency med:     ${(dur["med"] ?? 0).toFixed(0)}ms
  Latency p90:     ${(dur["p(90)"] ?? 0).toFixed(0)}ms
  Latency p95:     ${(dur["p(95)"] ?? 0).toFixed(0)}ms
  Latency max:     ${(dur["max"] ?? 0).toFixed(0)}ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  return {
    stdout: summary,
  };
}
