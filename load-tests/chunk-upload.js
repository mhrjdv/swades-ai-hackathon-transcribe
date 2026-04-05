import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const uploadErrors = new Counter("upload_errors");
const uploadSuccess = new Rate("upload_success_rate");
const uploadDuration = new Trend("upload_duration_ms");

export const options = {
  scenarios: {
    chunk_uploads: {
      executor: "constant-arrival-rate",
      rate: 5000,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 500,
      maxVUs: 1000,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(99)<500"],
    upload_success_rate: ["rate>0.99"],
  },
};

const SERVER_URL = __ENV.SERVER_URL || "http://localhost:3000";

// Generate a dummy WAV chunk (1KB)
function generateDummyChunk() {
  // Minimal WAV header + silence
  return new Uint8Array(1024).buffer;
}

export default function () {
  const sessionId = `load-test-${__VU}-${Date.now()}`;
  const chunkIndex = __ITER;
  const payload = {
    sessionId: sessionId,
    chunkIndex: String(chunkIndex),
    checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // SHA-256 of empty
    file: http.file(generateDummyChunk(), "chunk.wav", "audio/wav"),
  };

  const startTime = Date.now();
  const res = http.post(`${SERVER_URL}/upload/chunk`, payload);
  const duration = Date.now() - startTime;

  uploadDuration.add(duration);

  const success = check(res, {
    "status 200": (r) => r.status === 200,
    "has success field": (r) => {
      try {
        return JSON.parse(r.body).success === true;
      } catch {
        return false;
      }
    },
  });

  if (success) {
    uploadSuccess.add(1);
  } else {
    uploadSuccess.add(0);
    uploadErrors.add(1);
  }
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs.values.count;
  const successRate = data.metrics.upload_success_rate ? data.metrics.upload_success_rate.values.rate : 0;
  const p99 = data.metrics.http_req_duration.values["p(99)"];

  return {
    stdout: `
=== LOAD TEST RESULTS ===
Total Requests: ${totalRequests}
Success Rate: ${(successRate * 100).toFixed(2)}%
p99 Latency: ${p99.toFixed(0)}ms
Target: 300,000 requests at 5K req/s
Status: ${totalRequests >= 290000 && successRate > 0.99 ? "PASS" : "FAIL"}
========================
`,
  };
}
