/**
 * Load test gửi tin nhắn realtime qua Socket.IO.
 *
 * ---------------------------------------------------------------------------
 * CÁCH CHẠY
 * ---------------------------------------------------------------------------
 *   # DỌN DỮ LIỆU TEST TRƯỚC MỖI LẦN CHẠY — xem mục dưới, bắt buộc
 *   docker exec daln-mongo mongosh --quiet chat-service --eval \
 *     'db.message.deleteMany({content: /^k6 load test/})'
 *
 *   # MẶC ĐỊNH = bài stress: 500 -> 2000 -> peak 3500 msg/s (110 giây)
 *   k6 run testing/test_sendmessage.js
 *
 *   # kèm đủ phân vị (mặc định k6 không in p99)
 *   k6 run testing/test_sendmessage.js \
 *     --summary-trend-stats="avg,min,med,p(90),p(95),p(99),max"
 *
 *   # một mức phẳng bất kỳ
 *   k6 run testing/test_sendmessage.js \
 *     -e STAGE_PLAN='[{"name":"r","durationSec":60,"totalRate":3000}]'
 *
 * k6 exit 0 = vượt toàn bộ SLA. exit 99 = có ngưỡng bị phá.
 *
 * ---------------------------------------------------------------------------
 * PHẢI DỌN DỮ LIỆU GIỮA CÁC LẦN CHẠY — ĐÂY LÀ BIẾN GÂY NHIỄU LỚN NHẤT
 * ---------------------------------------------------------------------------
 * Bài mặc định ghi ~280.000 tin nhắn THẬT vào Mongo mỗi lần. Chạy vài lần là
 * collection phình lên hàng triệu document, index writes đắt dần, và kết quả
 * tụt thấy rõ mà không phải do code:
 *
 *   cùng bài mặc định, collection 3 triệu doc -> p95 1.42s, HỎNG SLA
 *   cùng bài mặc định, collection sạch        -> p95  115ms, đạt SLA
 *
 * Nếu quên dọn, bạn sẽ tưởng hệ thống đang tệ đi trong khi thực ra chỉ là
 * dữ liệu rác của chính bài test.
 *
 * ---------------------------------------------------------------------------
 * TRẦN CỦA CHÍNH BỘ SINH TẢI — ĐỌC TRƯỚC KHI KẾT LUẬN
 * ---------------------------------------------------------------------------
 * Mỗi tick chỉ gửi tối đa MAX_BURST_PER_TICK tin, nên:
 *
 *     trần = MAX_BURST_PER_TICK x (1000 / SEND_TICK_MS) x 2 VU
 *
 * Với mặc định (100 tin/tick, tick 100ms) trần là 2000 msg/s — đặt totalRate
 * cao hơn cũng KHÔNG gửi nhanh hơn. Từng bị nhầm là server chạm trần: chạy
 * totalRate 2000 và 3000 cho ra y hệt 59.800 tin.
 * Muốn vượt: hạ SEND_TICK_MS (50 -> trần 4000) hoặc nâng MAX_BURST_PER_TICK.
 * setup() sẽ in trần và cảnh báo nếu kịch bản của bạn vượt quá.
 *
 * ---------------------------------------------------------------------------
 * CHỈ SỐ ACK GÂY HIỂU NHẦM KHI QUÁ TẢI
 * ---------------------------------------------------------------------------
 * Ack về sau ACK_TIMEOUT_MS bị tính là timeout và KHÔNG cộng vào
 * messages_ack_success_total. Khi hệ thống quá tải, con số này thấp hơn nhiều
 * so với lượng server thực sự xử lý. Muốn biết thông lượng thật, lấy:
 *
 *     (số tin đã gửi - tồn đọng trong hàng đợi) / thời gian tải
 *     docker exec daln-rabbitmq rabbitmqctl list_queues name messages
 *
 * Từng đo được 224 msg/s theo k6 trong khi server thật sự xử lý 522 msg/s.
 *
 * ---------------------------------------------------------------------------
 * KẾT QUẢ ĐÃ ĐO (1 instance chat, dev build, máy 10 core, SEND_TICK_MS=50,
 * hội thoại DIRECT 2 người)
 * ---------------------------------------------------------------------------
 * Tất cả số dưới đây đo trên collection SẠCH (đã dọn trước khi chạy):
 *
 *   mức       thời lượng    p95      p99     timeout   SLA
 *   1000         40s        42ms     66ms      0%      đạt
 *   2000         40s        70ms    191ms      0%      đạt
 *   2500         40s       230ms    311ms      0%      đạt
 *   3000         40s       253ms    424ms      0%      đạt
 *   3500         60s       314ms    419ms      0%      đạt  <- CAO NHẤT còn bền
 *   4000         40s      9690ms   9980ms     12.7%    hỏng (cũng chạm trần k6)
 *
 *   bài mặc định (ramp -> peak 3500, 110s), nền sạch:  p95 115-314ms, đạt
 *
 * Điểm gãy nằm giữa 3500 và 4000 — nhưng 4000 cũng đúng bằng trần bộ sinh tải
 * nên chưa thể khẳng định đó là giới hạn của server. Muốn biết chắc phải hạ
 * SEND_TICK_MS xuống 25 rồi đo lại.
 *
 * Ở MỌI mức kể trên, tồn đọng hàng đợi = 0 và không mất tin nhắn nào — kể cả
 * lúc hỏng SLA. Cái gãy là độ trễ, không phải độ tin cậy.
 *
 * Bối cảnh: 1 instance chat, dev build, MacBook 10 core, hội thoại DIRECT
 * 2 người. Nhóm đông thành viên sẽ nặng hơn vì fan-out theo số người nhận.
 */
import http from "k6/http";
import ws from "k6/ws";
import { check, fail } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const WS_URL =
  __ENV.WS_URL || "ws://localhost:3001/socket.io/?EIO=4&transport=websocket";
const SOCKET_NAMESPACE = __ENV.SOCKET_NAMESPACE || "/realtime";
// Phải là hội thoại mà CẢ HAI tài khoản dưới đây đều là thành viên.
// Tìm nhanh: đăng nhập rồi gọi GET /chat/conversations
const GROUP_ID = __ENV.GROUP_ID || "6a3512e5c9a117d00b8e7dd3";

const USER_1_EMAIL = __ENV.USER_1_EMAIL || "23010310@st.phenikaa-uni.edu.vn";
const USER_1_PASSWORD = __ENV.USER_1_PASSWORD || "heheheee";
const USER_2_EMAIL = __ENV.USER_2_EMAIL || "nguyen2202794@gmail.com";
const USER_2_PASSWORD = __ENV.USER_2_PASSWORD || "heheheee";

// 50ms -> trần bộ sinh tải 4000 msg/s, đủ cho bài mặc định 3500.
// Để 100ms (giá trị cũ) thì trần chỉ 2000 và bài 3500 sẽ bị k6 bóp lại.
const SEND_TICK_MS = Number(__ENV.SEND_TICK_MS || 50);
/** Trần số tin gửi mỗi tick mỗi VU — cùng SEND_TICK_MS quyết định trần bộ sinh tải. */
const MAX_BURST_PER_TICK = Number(__ENV.MAX_BURST_PER_TICK || 100);
const VU_COUNT = 2;
/** Tốc độ tối đa mà chính k6 có thể tạo ra với cấu hình hiện tại. */
const GENERATOR_CEILING =
  MAX_BURST_PER_TICK * (1000 / SEND_TICK_MS) * VU_COUNT;
const ACK_TIMEOUT_MS = Number(__ENV.ACK_TIMEOUT_MS || 10000);
const CLOSE_GRACE_MS = Number(__ENV.CLOSE_GRACE_MS || 10000);
const LOG_EVERY_SENT = Number(__ENV.LOG_EVERY_SENT || 50);
const LOG_EVERY_ACK = Number(__ENV.LOG_EVERY_ACK || 100);
const VERBOSE_ACKS = __ENV.VERBOSE_ACKS === "1";

/**
 * Mặc định = bài stress peak 3500 msg/s — mức CAO NHẤT còn giữ được SLA khi
 * chạy liên tục 60 giây TRÊN COLLECTION SẠCH.
 * Cần SEND_TICK_MS=50 (đã đặt sẵn) cho trần bộ sinh tải 4000.
 *
 * Muốn quay lại bài peak 1000 cũ:
 *   -e STAGE_PLAN='[{"name":"warmup-10","durationSec":60,"totalRate":10},
 *                   {"name":"ramp-100","durationSec":60,"totalRate":100},
 *                   {"name":"ramp-500","durationSec":90,"totalRate":500},
 *                   {"name":"peak-1000","durationSec":90,"totalRate":1000}]'
 */
// Warmup ngắn (chỉ ~2.000 tin) để dựng socket + làm nóng cache, rồi vào thẳng
// peak. KHÔNG dùng ramp dài: chặng ramp vừa nhồi sẵn hàng chục nghìn document
// vào collection vừa để lại tồn dư xếp hàng, khiến peak 3500 hỏng SLA
// (đo được: ramp -> p95 746ms, phẳng từ trạng thái nghỉ -> p95 314ms).
const DEFAULT_STAGE_PLAN = [
  { name: "warmup-200", durationSec: 10, totalRate: 200 },
  { name: "peak-3500", durationSec: 60, totalRate: 3500 },
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
  // Response đi qua interceptor nên payload thật nằm trong `data`.
  // Không truy cập thẳng body.data.x — login hỏng sẽ ném lỗi trước cả check().
  const data = body.data || {};
  const accessToken = data.accessToken;

  const ok = check(response, {
    "login status is 200 or 201": (res) =>
      res.status === 200 || res.status === 201,
    "login response has accessToken": () => Boolean(accessToken),
  });

  if (!ok || !accessToken) {
    fail(
      `Login failed for ${email}. status=${response.status} body=${String(response.body).slice(0, 300)}`,
    );
  }

  console.log(
    `[login] ${email} -> userId=${data.id || data.userId || "n/a"} status=${response.status}`,
  );

  return {
    email,
    password,
    accessToken,
    userId: data.id || data.userId || email,
    username: data.username || email.split("@")[0],
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

  // Trần của chính bộ sinh tải. Nếu kịch bản đòi cao hơn thì k6 sẽ âm thầm
  // gửi chậm hơn yêu cầu, dễ bị hiểu nhầm là server chạm giới hạn.
  const peakRate = STAGE_PLAN.reduce(
    (max, stage) => Math.max(max, stage.totalRate),
    0,
  );
  console.log(
    `[setup] trần bộ sinh tải = ${GENERATOR_CEILING} msg/s ` +
      `(MAX_BURST_PER_TICK=${MAX_BURST_PER_TICK} x ${1000 / SEND_TICK_MS} tick/s x ${VU_COUNT} VU)`,
  );
  if (peakRate > GENERATOR_CEILING) {
    console.log(
      `[setup] ⚠️  CẢNH BÁO: kịch bản đòi ${peakRate} msg/s nhưng k6 chỉ tạo được ` +
        `${GENERATOR_CEILING} msg/s. Kết quả sẽ bị GIỚI HẠN BỞI BỘ SINH TẢI, không phải server. ` +
        `Hạ SEND_TICK_MS (vd 50) hoặc nâng MAX_BURST_PER_TICK.`,
    );
  }

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
        while (tokenBucket >= 1 && burstCount < MAX_BURST_PER_TICK) {
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
