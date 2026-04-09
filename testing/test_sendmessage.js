import http from "k6/http";
import ws from "k6/ws";
import { check, fail } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const WS_URL =
  __ENV.WS_URL || "ws://localhost:3001/socket.io/?EIO=4&transport=websocket";
const SOCKET_NAMESPACE = __ENV.SOCKET_NAMESPACE || "/realtime";
const GROUP_ID = __ENV.GROUP_ID || "69ce7c7b671c694490014ab3";

const USER_1_EMAIL = __ENV.USER_1_EMAIL || "23010310@st.phenikaa-uni.edu.vn";
const USER_1_PASSWORD = __ENV.USER_1_PASSWORD || "heheheee";
const USER_2_EMAIL = __ENV.USER_2_EMAIL || "nguyen2202794@gmail.com";
const USER_2_PASSWORD = __ENV.USER_2_PASSWORD || "heheheee";

const SEND_TICK_MS = Number(__ENV.SEND_TICK_MS || 100);
const ACK_TIMEOUT_MS = Number(__ENV.ACK_TIMEOUT_MS || 10000);
const CLOSE_GRACE_MS = Number(__ENV.CLOSE_GRACE_MS || 10000);
const LOG_EVERY_SENT = Number(__ENV.LOG_EVERY_SENT || 50);
const LOG_EVERY_ACK = Number(__ENV.LOG_EVERY_ACK || 100);
const VERBOSE_ACKS = __ENV.VERBOSE_ACKS === "1";

const DEFAULT_STAGE_PLAN = [
  { name: "warmup-10", durationSec: 60, totalRate: 10 },
  { name: "ramp-100", durationSec: 60, totalRate: 100 },
  { name: "ramp-500", durationSec: 90, totalRate: 500 },
  { name: "peak-1000", durationSec: 90, totalRate: 1000 },
];

function parseStagePlan(rawValue) {
  if (!rawValue) {
    return DEFAULT_STAGE_PLAN;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_STAGE_PLAN;
    }

    return parsed
      .map((stage, index) => ({
        name: String(stage.name || `stage-${index + 1}`),
        durationSec: Number(stage.durationSec || stage.duration || 0),
        totalRate: Number(stage.totalRate || stage.rate || 0),
      }))
      .filter((stage) => stage.durationSec > 0 && stage.totalRate > 0);
  } catch {
    return DEFAULT_STAGE_PLAN;
  }
}

const STAGE_PLAN = parseStagePlan(__ENV.STAGE_PLAN);
const LOAD_WINDOW_MS = STAGE_PLAN.reduce(
  (total, stage) => total + stage.durationSec * 1000,
  0,
);
const TOTAL_DURATION_MS = Number(__ENV.TEST_DURATION_MS || LOAD_WINDOW_MS);
const TOTAL_RUN_MS = TOTAL_DURATION_MS + CLOSE_GRACE_MS;

const messagesSent = new Counter("messages_sent_success_total");
const messagesAcked = new Counter("messages_ack_success_total");
const messageAckLatency = new Trend("message_ack_latency_ms", true);
const messageAckTimeoutRate = new Rate("message_ack_timeout_rate");
const messageAckTimeouts = new Counter("message_ack_timeouts_total");
const socketDisconnectRate = new Rate("socket_disconnect_rate");
const socketDisconnects = new Counter("socket_disconnects_total");

export const options = {
  scenarios: {
    chat_realtime_stress: {
      executor: "constant-vus",
      vus: 2,
      duration: `${Math.ceil(TOTAL_RUN_MS / 1000)}s`,
      gracefulStop: "10s",
    },
  },
  thresholds: {
    message_ack_latency_ms: ["p(95)<500", "p(99)<1000"],
    message_ack_timeout_rate: ["rate<0.01"],
    socket_disconnect_rate: ["rate<0.01"],
  },
};

function safeJsonParse(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function getStageByElapsedMs(elapsedMs) {
  let accumulatedMs = 0;

  for (let index = 0; index < STAGE_PLAN.length; index += 1) {
    const stage = STAGE_PLAN[index];
    accumulatedMs += stage.durationSec * 1000;
    if (elapsedMs < accumulatedMs) {
      return { ...stage, index };
    }
  }

  const lastStage = STAGE_PLAN[STAGE_PLAN.length - 1];
  return { ...lastStage, index: STAGE_PLAN.length - 1 };
}

function buildCookieHeader(accessToken) {
  return `accessToken=${accessToken}`;
}

function createClientMessageId(userTag, sequence) {
  return `${userTag}-${Date.now()}-${sequence}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function loginUser(email, password) {
  const response = http.post(
    `${BASE_URL}/user/login`,
    JSON.stringify({ email, password }),
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );

  const body = safeJsonParse(response.body) || {};
  const accessToken = body.data.accessToken;

  const ok = check(response, {
    "login status is 200 or 201": (res) =>
      res.status === 200 || res.status === 201,
    "login response has accessToken": () => Boolean(accessToken),
  });

  if (!ok || !accessToken) {
    fail(
      `Login failed for ${email}. status=${response.status} body=${response.body}`,
    );
  }

  console.log(
    `[login] ${email} -> userId=${body.id || body.userId || "n/a"} status=${response.status}`,
  );

  return {
    email,
    password,
    accessToken,
    userId: body.id || body.userId || email,
    username: body.username || email.split("@")[0],
    cookieHeader: buildCookieHeader(accessToken),
  };
}

function getUserContext(vuNumber, authData) {
  if (vuNumber === 1) {
    return {
      tag: "user1",
      email: authData.user1.email,
      password: authData.user1.password,
      accessToken: authData.user1.accessToken,
      cookieHeader: authData.user1.cookieHeader,
      userId: authData.user1.userId,
      username: authData.user1.username,
    };
  }

  if (vuNumber === 2) {
    return {
      tag: "user2",
      email: authData.user2.email,
      password: authData.user2.password,
      accessToken: authData.user2.accessToken,
      cookieHeader: authData.user2.cookieHeader,
      userId: authData.user2.userId,
      username: authData.user2.username,
    };
  }

  fail(`This script expects exactly 2 VUs. Current VU=${vuNumber}`);
}

export function setup() {
  if (!GROUP_ID || GROUP_ID === "REPLACE_WITH_GROUP_ID") {
    fail("Please provide GROUP_ID via environment variable.");
  }

  console.log(
    `[setup] BASE_URL=${BASE_URL} WS_URL=${WS_URL} GROUP_ID=${GROUP_ID} LOAD_WINDOW_MS=${LOAD_WINDOW_MS}`,
  );

  const user1 = loginUser(USER_1_EMAIL, USER_1_PASSWORD);
  const user2 = loginUser(USER_2_EMAIL, USER_2_PASSWORD);

  return {
    groupId: GROUP_ID,
    user1,
    user2,
  };
}

export default function (authData) {
  const user = getUserContext(__VU, authData);
  const pendingMessages = new Map();

  let socketReady = false;
  let plannedClose = false;
  let unexpectedClose = false;
  let stageIndex = -1;
  let sequence = 0;
  let tokenBucket = 0;
  let totalSent = 0;
  let totalAcked = 0;
  let totalTimeouts = 0;
  let totalErrors = 0;

  const startedAt = Date.now();

  function logStageIfNeeded(elapsedMs, stage) {
    if (stage.index === stageIndex) {
      return;
    }

    stageIndex = stage.index;
    console.log(
      `[${user.tag}] stage=${stage.name} rate=${stage.totalRate} msg/s total elapsed=${Math.floor(elapsedMs / 1000)}s`,
    );
  }

  function cleanupTimedOutMessages(nowMs) {
    for (const [clientMessageId, entry] of pendingMessages) {
      if (nowMs <= entry.expiresAt) {
        continue;
      }

      pendingMessages.delete(clientMessageId);
      totalTimeouts += 1;
      messageAckTimeouts.add(1);
      messageAckTimeoutRate.add(1);

      if (totalTimeouts <= 5 || totalTimeouts % 50 === 0) {
        console.log(
          `[${user.tag}] ACK timeout for clientMessageId=${clientMessageId} wait=${nowMs - entry.sentAt}ms`,
        );
      }
    }
  }

  function handleAckMessage(eventData) {
    const clientMessageId = eventData?.clientMessageId;
    if (!clientMessageId) {
      return;
    }

    const pending = pendingMessages.get(clientMessageId);
    if (!pending) {
      return;
    }

    pendingMessages.delete(clientMessageId);
    const latencyMs = Date.now() - pending.sentAt;

    totalAcked += 1;
    messagesAcked.add(1);
    messageAckLatency.add(latencyMs);
    messageAckTimeoutRate.add(0);

    if (VERBOSE_ACKS || totalAcked <= 5 || totalAcked % LOG_EVERY_ACK === 0) {
      console.log(
        `[${user.tag}] ACK clientMessageId=${clientMessageId} latency=${latencyMs}ms status=${eventData?.status || "n/a"}`,
      );
    }
  }

  function handleMessageError(eventData) {
    const clientMessageId = eventData?.clientMessageId;
    if (clientMessageId && pendingMessages.has(clientMessageId)) {
      pendingMessages.delete(clientMessageId);
      totalErrors += 1;
      totalTimeouts += 1;
      messageAckTimeouts.add(1);
      messageAckTimeoutRate.add(1);
    }

    console.log(
      `[${user.tag}] message:error clientMessageId=${clientMessageId || "n/a"} code=${eventData?.code || "n/a"} message=${eventData?.message || "n/a"}`,
    );
  }

  const res = ws.connect(
    WS_URL,
    {
      headers: {
        Cookie: user.cookieHeader,
      },
    },
    (socket) => {
      socket.on("open", () => {
        console.log(`[${user.tag}] websocket transport open`);
      });

      socket.on("message", (rawMessage) => {
        const message = String(rawMessage);

        if (message === "2") {
          socket.send("3");
          return;
        }

        if (message.startsWith("0")) {
          socket.send(`40${SOCKET_NAMESPACE},`);
          return;
        }

        if (
          message === `40${SOCKET_NAMESPACE}` ||
          message.startsWith(`40${SOCKET_NAMESPACE},`)
        ) {
          socketReady = true;
          console.log(
            `[${user.tag}] socket namespace connected ${SOCKET_NAMESPACE}`,
          );
          return;
        }

        const eventPrefix = `42${SOCKET_NAMESPACE},`;
        if (!message.startsWith(eventPrefix)) {
          return;
        }

        const payload = safeJsonParse(message.slice(eventPrefix.length));
        if (!Array.isArray(payload) || payload.length < 1) {
          return;
        }

        const eventName = payload[0];
        const eventData = payload[1] || {};

        if (eventName === "message:ack") {
          handleAckMessage(eventData);
          return;
        }

        if (eventName === "message:error") {
          handleMessageError(eventData);
          return;
        }
      });

      socket.on("close", () => {
        const disconnectedUnexpectedly = !plannedClose || unexpectedClose;
        socketDisconnectRate.add(disconnectedUnexpectedly ? 1 : 0);

        if (disconnectedUnexpectedly) {
          socketDisconnects.add(1);
          console.log(`[${user.tag}] socket closed unexpectedly`);
        } else {
          console.log(`[${user.tag}] socket closed by plan`);
        }
      });

      socket.on("error", (error) => {
        unexpectedClose = true;
        console.log(`[${user.tag}] socket error: ${String(error)}`);
      });

      socket.setInterval(() => {
        if (!socketReady) {
          return;
        }

        const nowMs = Date.now();
        const elapsedMs = nowMs - startedAt;
        const stage = getStageByElapsedMs(elapsedMs);

        logStageIfNeeded(elapsedMs, stage);
        cleanupTimedOutMessages(nowMs);

        if (elapsedMs >= LOAD_WINDOW_MS) {
          return;
        }

        const perUserRate = stage.totalRate / 2;
        tokenBucket += (perUserRate * SEND_TICK_MS) / 1000;

        let burstCount = 0;
        while (tokenBucket >= 1 && burstCount < 100) {
          sequence += 1;
          burstCount += 1;
          tokenBucket -= 1;

          const clientMessageId = createClientMessageId(user.tag, sequence);
          const payload = {
            conversationId: authData.groupId,
            clientMessageId,
            content: `k6 load test from ${user.tag}`,
            type: "TEXT",
          };

          pendingMessages.set(clientMessageId, {
            sentAt: nowMs,
            expiresAt: nowMs + ACK_TIMEOUT_MS,
          });

          socket.send(
            `42${SOCKET_NAMESPACE},${JSON.stringify(["message:create", payload])}`,
          );

          totalSent += 1;
          messagesSent.add(1);

          if (totalSent <= 5 || totalSent % LOG_EVERY_SENT === 0) {
            console.log(
              `[${user.tag}] sent clientMessageId=${clientMessageId} conversationId=${authData.groupId} totalSent=${totalSent}`,
            );
          }
        }
      }, SEND_TICK_MS);

      socket.setTimeout(() => {
        plannedClose = true;
        cleanupTimedOutMessages(Date.now());
        socket.close();
      }, TOTAL_RUN_MS);
    },
  );

  check(res, {
    "websocket upgrade succeeded": (r) => r && r.status === 101,
  });
}
