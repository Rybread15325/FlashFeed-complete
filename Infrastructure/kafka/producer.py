import logging
import redis as redis_lib
from config import REDIS_URL, REDIS_STREAM_NEWS, REDIS_STREAM_SOCIAL, REDIS_STREAM_MAXLEN
from models import FeedEvent

logger = logging.getLogger(__name__)


class StreamProducer:
    """
    Publishes FeedEvents to Redis Streams via XADD.
    Replaces the old Kafka producer — same send/flush interface, no broker needed.
    Uses the existing Railway Redis instance (REDIS_URL env var).

    Fetch pipeline  →  StreamProducer.send()  →  Redis Stream (RAM)
                                               →  StreamConsumer  →  MongoDB (disk)
    """

    def __init__(self):
        self._redis = redis_lib.from_url(REDIS_URL, decode_responses=True)
        self._stream_news   = REDIS_STREAM_NEWS
        self._stream_social = REDIS_STREAM_SOCIAL
        self._maxlen = REDIS_STREAM_MAXLEN

    def send(self, event: FeedEvent) -> str:
        """
        Publish one event to the appropriate Redis Stream.
        Events with event_type='social' go to the social stream; everything else
        goes to the news stream.
        Returns the stream entry ID assigned by Redis.
        """
        stream = self._stream_social if event.event_type == "social" else self._stream_news
        msg_id = self._redis.xadd(
            stream,
            {"data": event.to_json()},
            maxlen=self._maxlen,
            approximate=True,
        )
        logger.debug("Streamed | stream=%s id=%s event_id=%s", stream, msg_id, event.event_id)
        return msg_id

    def flush(self, timeout: float = 10.0) -> None:
        """No-op: Redis XADD is synchronous — every send is already persisted in RAM."""
        pass


# ── Quick smoke-test ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import time
    logging.basicConfig(level=logging.INFO)

    producer = StreamProducer()

    for i in range(5):
        event = FeedEvent.create(
            user_id=f"user_{i % 3}",
            event_type="news",
            payload={"title": f"Post #{i}", "body": "Hello FlashFeed!"},
        )
        msg_id = producer.send(event)
        logger.info("Queued event_id=%s user_id=%s stream_id=%s", event.event_id, event.user_id, msg_id)
        time.sleep(0.1)

    logger.info("Done.")
