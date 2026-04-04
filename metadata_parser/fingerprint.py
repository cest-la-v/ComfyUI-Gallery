"""Stable prompt fingerprint for grouping images by generation combo."""
import hashlib


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


def prompt_fingerprint(positive: str, negative: str, model: str) -> str:
    """8-byte blake2b hash of whitespace-normalised pos+neg+model.

    \\x00 separator prevents ("ab","c") from colliding with ("a","bc").
    """
    combined = "\x00".join([_norm(positive), _norm(negative), _norm(model)])
    return hashlib.blake2b(combined.encode(), digest_size=8).hexdigest()


def prompt_only_fingerprint(positive: str, negative: str) -> str:
    """8-byte blake2b hash of whitespace-normalised pos+neg (no model).

    Used for grouping images by prompt regardless of which model was used,
    allowing easy cross-model comparison with the same prompt.
    """
    combined = "\x00".join([_norm(positive), _norm(negative)])
    return hashlib.blake2b(combined.encode(), digest_size=8).hexdigest()
