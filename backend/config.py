import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

APP_NAME = os.getenv("COSMIC_NAME", "COSMIC AI")
APP_VERSION = os.getenv("COSMIC_VERSION", "2.5.0")
HOST = os.getenv("COSMIC_HOST", "127.0.0.1")
PORT = int(os.getenv("COSMIC_PORT", "8059"))
DATABASE_PATH = os.getenv("COSMIC_DATABASE", "data/local/cosmic.db")
