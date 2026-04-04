"""Stable prompt fingerprint for grouping images by generation combo."""
import hashlib


def prompt_fingerprint(positive: str, negative: str, model: str) -> str:
    """8-byte blake2b hash of whitespace-normalised pos+neg+model.

    \\x00 separator prevents ("ab","c") from colliding with ("a","bc").
    """
    def norm(s: str) -> str:
        return " ".join(s.lower().split())

    combined = "\x00".join([norm(positive), norm(negative), norm(model)])
    return hashlib.blake2b(combined.encode(), digest_size=8).hexdigest()
