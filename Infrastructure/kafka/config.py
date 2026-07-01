import os
from dotenv import load_dotenv

load_dotenv()

# ── Redis connection ──────────────────────────────────────────────────────────
REDIS_URL          = os.getenv("REDIS_URL", "redis://localhost:6379")
REDIS_HOST         = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT         = int(os.getenv("REDIS_PORT", 6379))
REDIS_TTL          = int(os.getenv("REDIS_TTL", 3600))   # hot-data TTL in seconds
REDIS_FEED_MAX     = int(os.getenv("REDIS_FEED_MAX", 100))

# ── Redis Streams (replaces Kafka) ────────────────────────────────────────────
REDIS_STREAM_NEWS    = os.getenv("REDIS_STREAM_NEWS",    "flashfeed:news")
REDIS_STREAM_SOCIAL  = os.getenv("REDIS_STREAM_SOCIAL",  "flashfeed:social")
REDIS_CONSUMER_GROUP = os.getenv("REDIS_CONSUMER_GROUP", "flashfeed-consumer-group")
REDIS_STREAM_MAXLEN  = int(os.getenv("REDIS_STREAM_MAXLEN", 50000))  # cap stream length

# ── MongoDB (persistent / disk layer) ─────────────────────────────────────────
MONGODB_URI        = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB         = os.getenv("MONGODB_DB", "flashfeed")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "events")
