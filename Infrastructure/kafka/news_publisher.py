"""
news_publisher.py — optional Kafka publish step for fetched news + social rows.

ADDITIVE BY DESIGN
------------------
Importing this module does nothing on its own and pulls in NO heavy dependency
(confluent-kafka) until publish_articles()/publish_social() is actually called.
The existing MongoDB write path in the fetchers is never affected: if Kafka or
confluent-kafka is unavailable, publishing is a best-effort no-op.

Flow this enables (matches the project's note C — Kafka as the RAM/stream layer
that persists to disk every few minutes, minimizing I/O):

    fetched row  ->  Kafka (RAM / stream)  ->  consumer  ->  Redis  (hot, in RAM)
                                                         ->  MongoDB (resting, on disk)

Each row is published once per ticker it mentions, so the existing consumer
builds a rolling, time-ordered, capped, auto-expiring hot feed per ticker in
Redis under the key "feed:{TICKER}" — i.e. the RAM-based ROLLING MESSAGE WINDOW,
ready for fast reads without hitting Mongo.
"""

from __future__ import annotations

import hashlib
import os
import sys
from datetime import datetime, timezone

# Make sibling Kafka modules (config / models / producer) importable no matter
# which directory the caller runs from.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Safety cap so a pathological row that lists dozens of tickers cannot explode
# into dozens of Kafka messages (keeps I/O minimal, per note C).
_MAX_TICKERS_PER_ARTICLE = int(os.getenv("KAFKA_NEWS_MAX_TICKERS", "12"))


def _to_iso(value) -> str:
    """
    Return an ISO-8601 UTC string the consumer can parse with
    datetime.fromisoformat(). Accepts unix seconds, unix milliseconds, an
    existing ISO string, or None.
    """
    if value is None or value == "":
        return datetime.now(timezone.utc).isoformat()
    try:
        n = float(value)
        if n > 1e12:  # milliseconds -> seconds
            n /= 1000.0
        return datetime.fromtimestamp(n, tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        pass
    s = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).astimezone(timezone.utc).isoformat()
    except ValueError:
        return datetime.now(timezone.utc).isoformat()


def _sentiment_score(doc: dict) -> float:
    """Signed score in [-1, 1] from the row's label + ml_confidence."""
    label = str(doc.get("sentiment", "")).lower()
    if "bull" in label or "positive" in label:
        direction = 1.0
    elif "bear" in label or "negative" in label:
        direction = -1.0
    else:
        direction = 0.0
    try:
        conf = float(doc.get("ml_confidence", 0) or 0)
    except (TypeError, ValueError):
        conf = 0.0
    return round(direction * conf, 4) if conf else direction


def _tickers(doc: dict) -> list[str]:
    """Split the comma-separated ticker field into a clean, de-duped list."""
    raw = str(doc.get("ticker", "") or "")
    seen: set[str] = set()
    out: list[str] = []
    for part in raw.split(","):
        t = part.strip().upper()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
        if len(out) >= _MAX_TICKERS_PER_ARTICLE:
            break
    return out


# ── News articles ────────────────────────────────────────────────────────────

def article_to_event_dict(doc: dict, ticker: str) -> dict:
    """Pure mapping (no deps): news-article dict + ticker -> FeedEvent-shaped dict."""
    url = str(doc.get("url", "") or "")
    event_id = "news:" + hashlib.sha1(f"{url}:{ticker}".encode()).hexdigest()[:16]
    return {
        "event_id": event_id,
        "user_id": ticker,                 # Kafka partition key + Redis "feed:{TICKER}" bucket
        "event_type": "news",
        "timestamp": _to_iso(doc.get("publish_date") or doc.get("fetched_date")),
        "payload": {
            "ticker": ticker,
            "title": doc.get("title", ""),
            "source": doc.get("source", ""),
            "url": url,
            "sentiment": doc.get("sentiment", "neutral"),
            "sentiment_score": _sentiment_score(doc),
            "event_type": doc.get("event_type", "general_news"),
            "company": doc.get("company", ""),
            "category": doc.get("category", ""),
            "publish_date": doc.get("publish_date"),
            "detected_at": doc.get("detected_at"),
        },
    }


def iter_events(docs):
    """Yield a FeedEvent per (article, ticker). Imports FeedEvent lazily."""
    from models import FeedEvent
    for doc in docs:
        for ticker in _tickers(doc):
            yield FeedEvent(**article_to_event_dict(doc, ticker))


_PRODUCER = None


def _get_producer():
    """Reuse one Kafka producer across calls (avoids repeated connect + metadata fetch)."""
    global _PRODUCER
    if _PRODUCER is None:
        _PRODUCER = FlashFeedProducer()
    return _PRODUCER


def publish_articles(docs) -> int:
    """Best-effort publish of news docs to Kafka. Returns the number of events sent."""
    docs = [d for d in (docs or []) if str(d.get("ticker", "")).strip()]
    if not docs:
        return 0
    from producer import FlashFeedProducer  # lazy import (pulls in confluent-kafka)
    producer = _get_producer()
    sent = 0
    for event in iter_events(docs):
        producer.send(event)
        sent += 1
    producer.flush(5)
    return sent


# ── Social posts (StockTwits / Reddit / Bluesky / X) ─────────────────────────

def social_to_event_dict(doc: dict, ticker: str) -> dict:
    """Pure mapping: a social-post dict + one ticker -> a FeedEvent-shaped dict."""
    sid = str(doc.get("id") or doc.get("url") or "")
    event_id = "social:" + hashlib.sha1(f"{sid}:{ticker}".encode()).hexdigest()[:16]
    text = doc.get("text") or doc.get("content") or doc.get("title") or ""
    try:
        score = float(doc.get("sentiment_score"))
    except (TypeError, ValueError):
        score = _sentiment_score(doc)  # fall back to label direction
    return {
        "event_id": event_id,
        "user_id": ticker,
        "event_type": "social",
        "timestamp": _to_iso(doc.get("created_at") or doc.get("timestamp") or doc.get("fetched_at")),
        "payload": {
            "ticker": ticker,
            "platform": doc.get("platform", "Social"),
            "author": doc.get("author", ""),
            "text": str(text)[:1000],
            "url": doc.get("url", ""),
            "sentiment": doc.get("sentiment", "neutral"),
            "sentiment_score": round(score, 4),
            "message_density": doc.get("message_density"),
            "source": doc.get("source", doc.get("platform", "")),
        },
    }


def iter_social_events(docs):
    """Yield a FeedEvent per (social post, ticker). Imports FeedEvent lazily."""
    from models import FeedEvent
    for doc in docs:
        for ticker in _tickers(doc):
            yield FeedEvent(**social_to_event_dict(doc, ticker))


def publish_social(docs) -> int:
    """Best-effort publish of social posts to Kafka. Returns events sent."""
    docs = [d for d in (docs or []) if str(d.get("ticker", "")).strip()]
    if not docs:
        return 0
    from producer import FlashFeedProducer  # lazy import (pulls in confluent-kafka)
    producer = _get_producer()
    sent = 0
    for event in iter_social_events(docs):
        producer.send(event)
        sent += 1
    producer.flush(5)
    return sent


if __name__ == "__main__":
    # Dry-run: prove the row -> FeedEvent mapping without a broker.
    import json

    sample = {
        "url": "https://example.com/agilent-q2-beat",
        "ticker": "A,MSFT",
        "title": "Agilent tops Q2 estimates, raises guidance",
        "source": "Business Wire",
        "sentiment": "bullish",
        "ml_confidence": 0.82,
        "event_type": "earnings_beat",
        "publish_date": 1749900000,
        "detected_at": 1749900060,
        "company": "Agilent Technologies",
        "category": "earnings",
    }
    print("Dry-run — article -> FeedEvent dict(s) (no Kafka broker needed):\n")
    for _t in _tickers(sample):
        print(json.dumps(article_to_event_dict(sample, _t), indent=2))
        print()

    social_sample = {
        "id": "stocktwits:A:889012",
        "platform": "StockTwits",
        "ticker": "A",
        "text": "$A breaking out on huge volume after the beat",
        "url": "https://stocktwits.com/symbol/A",
        "author": "traderjane",
        "sentiment": "bullish",
        "sentiment_score": 0.61,
        "message_density": 3.2,
        "created_at": 1749900300,
    }
    print("Dry-run — social post -> FeedEvent dict (no Kafka broker needed):\n")
    for _t in _tickers(social_sample):
        print(json.dumps(social_to_event_dict(social_sample, _t), indent=2))
        print()
