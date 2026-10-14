"""
Cloudinary configuration and upload helpers.

Render's disk is ephemeral: anything written to local disk at runtime (quiz
images, lesson videos) disappears the next time the service restarts or
redeploys. Cloudinary is used instead as permanent, always-on storage for
anything uploaded while the app is running.

Credentials come from environment variables — NEVER hardcode them here.
Set these in your local .env file and in Render's Environment Variables:

    CLOUDINARY_CLOUD_NAME=...
    CLOUDINARY_API_KEY=...
    CLOUDINARY_API_SECRET=...

If you previously hardcoded a Cloudinary API secret in a test script (or
committed one anywhere, even briefly), treat it as compromised and rotate
it from the Cloudinary dashboard (Settings -> Security -> API Keys), then
update the environment variable with the new secret.
"""

import os
import json
import time
from typing import Optional
from urllib.parse import unquote, urlsplit

import cloudinary
import cloudinary.uploader
import cloudinary.utils
from dotenv import load_dotenv

load_dotenv()

CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET")

if not (CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET):
    raise RuntimeError(
        "Cloudinary credentials are not fully set. Add CLOUDINARY_CLOUD_NAME, "
        "CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to your .env file "
        "locally, or to the Environment Variables section of your Render service."
    )

cloudinary.config(
    cloud_name=CLOUDINARY_CLOUD_NAME,
    api_key=CLOUDINARY_API_KEY,
    api_secret=CLOUDINARY_API_SECRET,
    secure=True,
)


def upload_image_bytes(data: bytes, folder: str, public_id: Optional[str] = None) -> str:
    """Upload image bytes to Cloudinary and return the secure (https) URL."""
    result = cloudinary.uploader.upload(
        data,
        folder=folder,
        public_id=public_id,
        resource_type="image",
        overwrite=True,
    )
    return result["secure_url"]


def upload_video_bytes(data: bytes, folder: str, public_id: Optional[str] = None) -> str:
    """Upload video bytes to Cloudinary and return the secure (https) URL.

    Cloudinary's video upload has a lower size ceiling on free/basic plans
    than raw storage would — check your plan's video upload limit if large
    lecture recordings fail to upload.
    """
    result = cloudinary.uploader.upload(
        data,
        folder=folder,
        public_id=public_id,
        resource_type="video",
        overwrite=True,
    )
    return result["secure_url"]


def upload_video_variants(data: bytes, folder: str) -> tuple[str, Optional[str]]:
    """Save a public 480p copy and protect the higher-resolution original."""
    original = cloudinary.uploader.upload(
        data, folder=f"{folder}/premium", resource_type="video", type="authenticated"
    )
    try:
        free = cloudinary.uploader.upload(
            data, folder=f"{folder}/free", resource_type="video",
            transformation={"height": 480, "crop": "limit", "quality": "auto"},
        )
    except Exception:
        cloudinary.uploader.destroy(original["public_id"], resource_type="video", type="authenticated")
        raise
    if int(original.get("height") or 0) <= 480:
        cloudinary.uploader.destroy(original["public_id"], resource_type="video", type="authenticated")
        return free["secure_url"], None
    asset = json.dumps({"public_id": original["public_id"], "format": original.get("format") or "mp4"})
    return free["secure_url"], asset


def premium_video_url(asset_json: str) -> str:
    """Provide a short-lived URL only after the caller's account is checked."""
    asset = json.loads(asset_json)
    return cloudinary.utils.private_download_url(
        asset["public_id"], asset["format"], resource_type="video",
        type="authenticated", expires_at=int(time.time()) + 900,
    )


def delete_lesson_video_variants(free_url: str, premium_asset: Optional[str]) -> bool:
    """Remove managed lesson uploads without touching external video URLs."""
    targets = []
    parsed = urlsplit(free_url or "")
    prefix = f"/{CLOUDINARY_CLOUD_NAME}/video/upload/"
    if parsed.hostname == "res.cloudinary.com" and parsed.path.startswith(prefix):
        path = unquote(parsed.path[len(prefix):])
        if path.split("/", 1)[0].startswith("v") and path.split("/", 1)[0][1:].isdigit():
            path = path.split("/", 1)[1]
        public_id = path.rsplit(".", 1)[0]
        if public_id.startswith("lesson_videos/") and "/free/" in public_id:
            targets.append((public_id, "upload"))
    if premium_asset:
        asset = json.loads(premium_asset)
        public_id = asset.get("public_id", "")
        if public_id.startswith("lesson_videos/") and "/premium/" in public_id:
            targets.append((public_id, "authenticated"))
    if not targets:
        return False
    results = []
    for public_id, delivery_type in targets:
        try:
            result = cloudinary.uploader.destroy(public_id, resource_type="video", type=delivery_type, invalidate=True)
            results.append(result.get("result") in ("ok", "not found"))
        except Exception:
            results.append(False)
    return len(targets) == 1 + bool(premium_asset) and all(results)
