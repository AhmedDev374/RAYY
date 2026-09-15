class ImageDecodeError(Exception):
    """Raised when the uploaded file cannot be decoded as an image."""


class ModelInferenceError(Exception):
    """Raised when the model itself fails to run (corrupt weights, OOM, etc.)."""
