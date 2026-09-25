/**
 * Scheduled inquiry jobs, stored in a Redis sorted set scored by due time.
 * Members look like "analyze|inbound:key", "holding|inbound:key", "reply|inbound:key".
 */
const { redis } = require("./kv");

const QUEUE = "inquiry_queue";
const ESCALATIONS = "inquiry_escalations";

async function enqueue(type, inboundKey, dueAt) {
  await redis(["ZADD", QUEUE, new Date(dueAt).getTime(), type + "|" + inboundKey]);
}

async function cancel(type, inboundKey) {
  await redis(["ZREM", QUEUE, type + "|" + inboundKey]);
}

async function due(now) {
  return (await redis(["ZRANGEBYSCORE", QUEUE, "-inf", now.getTime(), "LIMIT", 0, 25])) || [];
}

// Removing the member claims the job, so overlapping runs never double-send.
async function claim(member) {
  return (await redis(["ZREM", QUEUE, member])) === 1;
}

module.exports = { QUEUE, ESCALATIONS, enqueue, cancel, due, claim };
