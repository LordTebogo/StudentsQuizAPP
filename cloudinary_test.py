#!/usr/bin/env python3

import cloudinary
import cloudinary.uploader
import cloudinary.api
from cloudinary.utils import cloudinary_url

# Configure Cloudinary
cloudinary.config(
    cloud_name="cx4q2lhl",
    api_key="324948972712297",
    api_secret="Lc3Y9bQk9vv90TweHHmucRb760Y",
    secure=True
)

# Upload a sample image from Cloudinary's demo repository
result = cloudinary.uploader.upload(
    "https://res.cloudinary.com/demo/image/upload/sample.jpg"
)

print("Upload successful!")
print("Secure URL:", result["secure_url"])
print("Public ID:", result["public_id"])

# Get image details
details = cloudinary.api.resource(result["public_id"])

print("\nImage Details")
print("Width:", details["width"])
print("Height:", details["height"])
print("Format:", details["format"])
print("File Size (bytes):", details["bytes"])

# Generate optimized image URL
# f_auto = automatically selects the best image format
# q_auto = automatically selects the best compression quality
optimized_url, _ = cloudinary_url(
    result["public_id"],
    fetch_format="auto",
    quality="auto",
    secure=True
)

print("\nDone! Click link below to see optimized version of the image. Check the size and the format.")
print(optimized_url)