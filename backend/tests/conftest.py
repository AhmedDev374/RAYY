"""
Test configuration.

IMPORTANT: environment variables must be set *before* any `app.*` module is
imported, because `app/config.py`'s `get_settings()` is `lru_cache`d and
several modules (`app.deps`, `app.security`, `app.main`, ...) capture
`settings = get_settings()` once at import time.
"""
import os
import sys
import tempfile
from pathlib import Path
from types import ModuleType

_tmp_dir = Path(tempfile.mkdtemp(prefix="smart_plant_doctor_test_"))
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_dir / 'test_app.db'}"
os.environ["UPLOADS_DIR"] = str(_tmp_dir / "uploads")
os.environ.setdefault("AUTH_MODE", "supabase")
os.environ.setdefault("SUPABASE_URL", "https://test-project.supabase.co")


def _install_torch_stub_if_missing() -> None:
    """
    The app only needs `torch`/`torchvision` importable at module load time
    (app.ml.inference does `import torch` / `from torchvision import ...`);
    the ML model itself is lazy-loaded on first real /diagnose call. These
    auth tests never reach that point (they test the auth layer, which
    rejects unauthenticated/invalid requests before touching the model), so
    a real torch install isn't required to run them.

    If torch is genuinely installed (e.g. in CI with full requirements.txt),
    this is a no-op and the real library is used everywhere, including for
    any test that does exercise real inference.
    """
    try:
        import torch  # noqa: F401
        import torchvision  # noqa: F401
        return
    except ImportError:
        pass

    torch_mod = ModuleType("torch")
    torch_mod.nn = ModuleType("torch.nn")
    torch_mod.nn.Module = type("Module", (), {})
    torch_mod.nn.Sequential = lambda *a, **k: None
    torch_mod.nn.Dropout = lambda *a, **k: None
    torch_mod.nn.Linear = lambda *a, **k: None
    torch_mod.nn.ReLU = lambda *a, **k: None
    torch_mod.cuda = ModuleType("torch.cuda")
    torch_mod.cuda.is_available = lambda: False
    torch_mod.device = lambda *a, **k: "cpu"
    torch_mod.no_grad = lambda: (lambda fn: fn)
    torch_mod.load = lambda *a, **k: {}
    torch_mod.softmax = lambda *a, **k: None
    torch_mod.max = lambda *a, **k: None

    torchvision_mod = ModuleType("torchvision")
    torchvision_mod.models = ModuleType("torchvision.models")
    torchvision_mod.transforms = ModuleType("torchvision.transforms")
    torchvision_mod.transforms.Compose = lambda *a, **k: None
    torchvision_mod.transforms.Resize = lambda *a, **k: None
    torchvision_mod.transforms.ToTensor = lambda *a, **k: None
    torchvision_mod.transforms.Normalize = lambda *a, **k: None

    sys.modules["torch"] = torch_mod
    sys.modules["torch.nn"] = torch_mod.nn
    sys.modules["torchvision"] = torchvision_mod
    sys.modules["torchvision.models"] = torchvision_mod.models
    sys.modules["torchvision.transforms"] = torchvision_mod.transforms


_install_torch_stub_if_missing()

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    # TestClient as a context manager runs the app's lifespan (creates tables
    # against the temp sqlite DB configured above, seeds species profiles).
    with TestClient(app) as c:
        yield c
