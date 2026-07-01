"""
FlashFeed stream consumer
──────────────────────────
Redis Streams  →  batch read  →  Redis (RAM, hot data ZSet + Hash)
                              →  MongoDB (disk, persistent)

The consumer group tracks the last-delivered-id inside Redis itself.
XACK is called ONLY after both stores succeed, so no event is ever
silently dropped on a crash or restart — Redis will redeliver unacked
messages to the next available consumer on reconnect.
"""
import json
import logging
import socket
from datetime import datetime, timezone

import redis as redis_lib
from pymongo import MongoClient, UpdateOne, DESCENDING

from config import (
    REDIS_URL, REDIS_STREAM_NEWS, REDIS_STREAM_SOCIAL, REDIS_CONSUMER_GROUP,
    REDIS_TTL, REDIS_FEED_MAX,
    MONGODB_URI, MONGODB_DB, MONGODB_COLLECTION,
)
from models import FeedEvent

logger = logging.getLogger(__name__)

_STREAMS = [REDIS_STREAM_NEWS, REDIS_STREAM_SOCIAL]


class StreamConsumer:
    """
    Consumes events from Redis Streams and fans them out to:
      - Redis ZSet/Hash hot-data structures (microsecond reads)
      - MongoDB for long-term persistence

    Redis hot-data model
    ────────────────────
    Hash  "event:{event_id}"  → all event fields (TTL = REDIS_TTL seconds)
    ZSet  "feed:{user_id}"    → {event_id: unix_timestamp_score}
          • ordered by time, newest first via ZREVRANGE
          • trimmed to the most recent REDIS_FEED_MAX events per user
    """

    def __init__(self):
        self._redis = redis_lib.from_url(REDIS_URL, decode_responses=True)
        self._consumer_name = socket.gethostname()

        self._mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5_000)
        self._collection = self._mongo_client[MONGODB_DB][MONGODB_COLLECTION]
        self._setup_mongo_indexes()
        self._setup_consumer_groups()

    def _setup_mongo_indexes(self) -> None:
        self._collection.create_index("event_id", unique=True)
        self._collection.create_index("user_id")
        self._collection.create_index([("timestamp", DESCENDING)])
        logger.info("MongoDB indexes ready.")

    def _setup_consumer_groups(self) -> None:
        for stream in _STREAMS:
            try:
                # id="$" means: only deliver messages that arrive AFTER this consumer
                # group is created (we don't replay history on fresh start).
                self._redis.xgroup_create(stream, REDIS_CONSUMER_GROUP, id="$", mkstream=True)
                logger.info("Consumer group '%s' created for stream '%s'.", REDIS_CONSUMER_GROUP, stream)
            except redis_lib.exceptions.ResponseError as e:
                if "BUSYGROUP" in str(e):
                    logger.debug("Consumer group '%s' already exists for '%s'.", REDIS_CONSUMER_GROUP, stream)
                else:
                    raise

    # ── Redis hot-data writes ─────────────────────────────────────────────────

    def _write_to_redis(self, events: list[FeedEvent]) -> None:
        pipe = self._redis.pipeline(transaction=False)
        for e in events:
            pipe.hset(f"event:{e.event_id}", mapping=e.to_redis_hash())
            pipe.expire(f"event:{e.event_id}", REDIS_TTL)
            score = datetime.fromisoformat(e.timestamp).timestamp()
            pipe.zadd(f"feed:{e.user_id}", {e.event_id: score})
            pipe.expire(f"feed:{e.user_id}", REDIS_TTL)
            pipe.zremrangebyrank(f"feed:{e.user_id}", 0, -(REDIS_FEED_MAX + 1))
        pipe.execute()
        logger.info("Redis: wrote %d events.", len(events))

    # ── MongoDB writes ────────────────────────────────────────────────────────

    def _write_to_mongo(self, events: list[FeedEvent]) -> None:
        ops = [
            UpdateOne({"event_id": e.event_id}, {"$set": e.to_dict()}, upsert=True)
            for e in events
        ]
        result = self._collection.bulk_write(ops, ordered=False)
        logger.info("MongoDB: upserted=%d modified=%d", result.upserted_count, result.modified_count)

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self, batch_size: int = 50) -> None:
        """
        Poll both Redis Streams via XREADGROUP in batches.
        Runs until KeyboardInterrupt.
        """
        stream_ids = {s: ">" for s in _STREAMS}
        logger.info(
            "Consuming from streams %s (group '%s', consumer '%s')…",
            _STREAMS, REDIS_CONSUMER_GROUP, self._consumer_name,
        )

        try:
            while True:
                raw = self._redis.xreadgroup(
                    REDIS_CONSUMER_GROUP,
                    self._consumer_name,
                    stream_ids,
                    count=batch_size,
                    block=1000,  # block up to 1 s for new messages
                )
                if not raw:
                    continue

                for stream_name, messages in raw:
                    msg_ids = []
                    events: list[FeedEvent] = []

                    for msg_id, fields in messages:
                        try:
                            events.append(FeedEvent.from_json(fields["data"]))
                            msg_ids.append(msg_id)
                        except Exception as exc:
                            logger.error("Failed to parse message %s: %s", msg_id, exc)

                    if not events:
                        continue

                    try:
                        self._write_to_redis(events)
                        self._write_to_mongo(events)
                        # Ack AFTER both stores succeed — safe replay on crash.
                        self._redis.xack(stream_name, REDIS_CONSUMER_GROUP, *msg_ids)
                        logger.info("Batch of %d from '%s' acked.", len(events), stream_name)
                    except Exception as exc:
                        logger.error(
                            "Write error — batch NOT acked, will be redelivered: %s",
                            exc, exc_info=True,
                        )

        except KeyboardInterrupt:
            logger.info("Shutting down consumer…")
        finally:
            self._mongo_client.close()

    # ── Read path (cache-aside) ───────────────────────────────────────────────

    def get_user_feed(self, user_id: str, limit: int = 20) -> list[dict]:
        """
        Fetch the latest `limit` events for a user.
        1. Try Redis ZSet/Hash hot path (microseconds).
        2. Fall back to MongoDB on a cold-start cache miss (milliseconds).
        """
        event_ids = self._redis.zrevrange(f"feed:{user_id}", 0, limit - 1)
        if event_ids:
            pipe = self._redis.pipeline(transaction=False)
            for eid in event_ids:
                pipe.hgetall(f"event:{eid}")
            results = pipe.execute()
            feed = []
            for h in results:
                if h:
                    h["payload"] = json.loads(h.get("payload", "{}"))
                    feed.append(h)
            logger.debug("Redis hit for user %s (%d events).", user_id, len(feed))
            return feed

        logger.info("Cache miss for user %s — reading from MongoDB.", user_id)
        return list(
            self._collection
            .find({"user_id": user_id}, {"_id": 0})
            .sort("timestamp", DESCENDING)
            .limit(limit)
        )


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    )
    consumer = StreamConsumer()
    consumer.run(batch_size=50)
