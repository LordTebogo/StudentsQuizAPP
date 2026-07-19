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
from typing import Optional

import cloudinary
import cloudinary.uploader
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
