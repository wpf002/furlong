"""Ensure the ml service root is importable so `import app...` resolves in tests
regardless of the pytest invocation directory."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
