#!/usr/bin/env python3
"""Explicit, optional Cloudinary upload check using environment credentials.

Run manually with `python cloudinary_test.py`; importing this module does not
upload anything. Never embed API credentials in this file.
"""
from cloudinary_utils import _configure
import cloudinary.uploader


def main():
    _configure()
    result = cloudinary.uploader.upload(
        "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        folder="arounus-connection-check",
    )
    print("Upload successful:", result["secure_url"])


if __name__ == "__main__":
    main()
