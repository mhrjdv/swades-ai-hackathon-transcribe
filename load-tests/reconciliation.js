import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 1,
  iterations: 1,
};

const SERVER_URL = __ENV.SERVER_URL || "http://localhost:3000";

export default function () {
  // Call server-side reconciliation to verify data integrity
  const res = http.post(
    `${SERVER_URL}/trpc/reconciliation.runServerSide`,
    JSON.stringify({ json: { sessionId: "load-test-verification" } }),
    { headers: { "Content-Type": "application/json" } }
  );

  check(res, {
    "reconciliation endpoint responds": (r) => r.status === 200,
  });

  // Check health endpoint
  const healthRes = http.get(`${SERVER_URL}/`);
  check(healthRes, {
    "server healthy after load": (r) => r.status === 200,
  });
}
